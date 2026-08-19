#!/usr/bin/env node
// Builds the abap2UI5 UI5 frontend, with the OpenUI5 runtime alongside it.
//
// The frontend is taken as-is from abap2UI5 (build/cloud/app/webapp, the tree
// that repository publishes for installation) and built with the UI5 tooling,
// which fetches the OpenUI5 libraries from npm and writes them next to the app
// under resources/. The result is a directory that needs nothing but a static
// file server.
//
// Serving UI5 ourselves rather than linking the CDN is the difference between a
// page that works and a page that usually works: the version is pinned, the
// playground is reproducible, it survives an outage at sdk.openui5.org, and the
// tests can actually render the app instead of asserting around it. The site is
// large (~70 MB) but a visitor never downloads it - UI5 fetches library preload
// bundles on demand, so a typical app pulls a few MB.
//
// The build is slow (a minute, plus the first framework download) and
// deterministic, so it is skipped when nothing that feeds it has changed.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPS = path.join(ROOT, "deps");
const BUILD = path.join(ROOT, "build");
const APP_SRC = path.join(DEPS, "abap2ui5", "build", "cloud", "app", "webapp");
const WORK = path.join(BUILD, "ui5app");
const UI5_DIST = path.join(BUILD, "ui5dist");
const OUT = path.join(ROOT, "dist", "app");

// One place decides which UI5 the playground runs. Bumping it is a deliberate
// commit: run the build, run the tests, look at the app.
export const UI5_VERSION = "1.151.0";

// What an abap2UI5 app can reach. A view names its controls at runtime, so
// there is no way to derive this from the code - a library that is not here is
// a control that will not render. sap.ui.core and sap.m are what the frontend's
// manifest declares; the rest are the libraries abap2UI5's own samples use.
const UI5_LIBRARIES = [
  "sap.ui.core",
  "sap.m",
  "sap.f",
  "sap.ui.layout",
  "sap.ui.table",
  "sap.ui.unified",
  "sap.tnt",
  "sap.uxap",
  "themelib_sap_horizon",
];

const log = (m) => console.log(`build-ui5: ${m}`);

function inputHash() {
  const h = crypto.createHash("sha256");
  const addTree = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) addTree(p);
      // The path relative to the tree, not the base name: a restructure that
      // moves files without renaming them changes what gets built and has to
      // change the hash with it.
      else h.update(path.relative(APP_SRC, p)).update(fs.readFileSync(p));
    }
  };
  addTree(APP_SRC);
  h.update(UI5_VERSION).update(UI5_LIBRARIES.join(","));
  h.update(fs.readFileSync(fileURLToPath(import.meta.url)));
  return h.digest("hex");
}

function build() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.rmSync(UI5_DIST, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  fs.cpSync(APP_SRC, path.join(WORK, "webapp"), { recursive: true });

  // The UI5 tooling walks up looking for the project it should build, and would
  // otherwise find the playground's own package.json and refuse.
  fs.writeFileSync(
    path.join(WORK, "package.json"),
    JSON.stringify({ name: "z2ui5-frontend", version: "1.0.0", private: true }, null, 2),
  );
  fs.writeFileSync(
    path.join(WORK, "ui5.yaml"),
    [
      'specVersion: "4.0"',
      "metadata:",
      "  name: z2ui5",
      "type: application",
      "framework:",
      "  name: OpenUI5",
      `  version: "${UI5_VERSION}"`,
      "  libraries:",
      ...UI5_LIBRARIES.map((l) => `    - name: ${l}`),
      "",
    ].join("\n"),
  );

  log(`building the frontend against OpenUI5 ${UI5_VERSION} (first run also downloads it)`);
  execFileSync("npx", ["--prefix", ROOT, "ui5", "build", "--all", "--dest", UI5_DIST], {
    cwd: WORK,
    stdio: ["ignore", "inherit", "inherit"],
  });
}

// What no browser will ever ask for. The UI5 build ships an unminified debug
// copy of every module, a source map beside it, and its own test framework -
// together more than half the tree, and none of it reachable from a page that
// only ever loads the minified modules.
//
// Deliberately conservative beyond that. Translations and right-to-left
// stylesheets look like easy wins and are not: UI5 requests them by locale, so
// dropping them trades a few megabytes of disk for a 404 in somebody's browser.
function trim() {
  fs.rmSync(path.join(UI5_DIST, "test-resources"), { recursive: true, force: true });
  fs.rmSync(path.join(UI5_DIST, "resources", "sap", "ui", "test"), { recursive: true, force: true });

  let removed = 0;
  const sweep = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        sweep(p);
        continue;
      }
      if (e.name.endsWith("-dbg.js") || e.name.endsWith(".js.map") || e.name.endsWith(".less")) {
        fs.rmSync(p);
        removed++;
      }
    }
  };
  sweep(UI5_DIST);
  log(`trimmed ${removed} debug and source-map files`);
}

// `ui5 build` writes one for a library project but not for an application, and
// the abap2UI5 frontend asks for it on every start (core/Server.js reads
// sap/ui/VersionInfo to report the UI5 version to the backend). Without it every
// page load logs a 404 and an error from the UI5 core.
//
// The timestamp is fixed on purpose: a real one would change the file on every
// build and make an otherwise identical deployment look different.
function writeVersionInfo() {
  const libraries = UI5_LIBRARIES.map((name) => ({ name, version: UI5_VERSION, buildTimestamp: "", scmRevision: "" }));
  fs.writeFileSync(
    path.join(UI5_DIST, "resources", "sap-ui-version.json"),
    JSON.stringify(
      { name: "openui5", version: UI5_VERSION, buildTimestamp: "", scmRevision: "", gav: "", libraries },
      null,
      2,
    ),
  );
}

// UI5's clickjacking guard, which the playground has to switch off in its own
// copy of the frontend.
//
// abap2UI5 ships `frameOptions="trusted"`, and it is right to: an app on a real
// system holds a session. "trusted" means "only in a frame whose TOP window is
// the same origin", and the app here is always in a frame - inside the
// playground, which a documentation page on another origin then frames again.
// UI5 then asks that top window for permission over postMessage, waits ten
// seconds for an answer no documentation site knows to give, and HIDES
// everything it rendered. The app is in the DOM, correct and invisible, and the
// status bar says "running" - which is the worst shape a failure can take.
//
// What is being unprotected is a demo compiled from code the embedding page
// supplied, with no session and no credentials of anybody's. Being framed is
// the point of it.
const FRAME_OPTIONS = ['data-sap-ui-frameOptions="trusted"', 'data-sap-ui-frameOptions="allow"'];

// The two changes the playground makes to the frontend it built: a script tag
// ahead of the UI5 bootstrap, so the roundtrip is already redirected by the
// time the component starts (see src/shell/frontend-bridge.js), and the
// frameOptions above.
function patchFrontend() {
  const indexPath = path.join(UI5_DIST, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  const tag = `    <script src="frontend-bridge.js"></script>\n`;
  const anchor = "    <script\n        id=\"sap-ui-bootstrap\"";
  if (!html.includes(anchor)) {
    throw new Error("build-ui5: could not find the UI5 bootstrap tag in the frontend index.html");
  }
  // The UI5 tree survives an incremental build, so this runs against a page
  // that may already carry the tag. Injecting again would load the bridge
  // twice, and the second load would wrap the fetch the first one installed.
  if (!html.includes(tag)) {
    html = html.replace(anchor, tag + anchor);
  }
  if (!html.includes(FRAME_OPTIONS[1]) && !html.includes(FRAME_OPTIONS[0])) {
    throw new Error("build-ui5: the frontend index.html no longer sets frameOptions - check what it does now");
  }
  html = html.replace(FRAME_OPTIONS[0], FRAME_OPTIONS[1]);
  fs.writeFileSync(indexPath, html);
  fs.copyFileSync(path.join(ROOT, "src", "shell", "frontend-bridge.js"), path.join(UI5_DIST, "frontend-bridge.js"));
}

const stampPath = path.join(BUILD, "ui5.stamp");
const hash = inputHash();
const force = process.argv.includes("--force");

if (!force && fs.existsSync(stampPath) && fs.readFileSync(stampPath, "utf8").trim() === hash && fs.existsSync(UI5_DIST)) {
  log("frontend up to date, reusing build/ui5dist");
} else {
  build();
  trim();
  writeVersionInfo();
  fs.writeFileSync(stampPath, hash);
}

// Both are playground changes to somebody else's build output and cost
// nothing, so they are re-applied on every run rather than being part of the
// cached tree.
patchFrontend();

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.cpSync(UI5_DIST, OUT, { recursive: true });

const size = execFileSync("du", ["-sh", OUT]).toString().split("\t")[0];
log(`dist/app ready (${size})`);
