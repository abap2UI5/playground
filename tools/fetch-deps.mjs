#!/usr/bin/env node
// Materializes the git dependencies of the playground at pinned commits under
// deps/ (gitignored). Everything the build consumes from outside npm goes
// through here, so a build is reproducible: the same pins produce the same
// dist/, and an upstream push cannot turn a green build red overnight.
//
//   node tools/fetch-deps.mjs                 fetch/refresh the pins
//   node tools/fetch-deps.mjs --print-latest  show upstream HEADs (to bump)
//
// Bumping a pin is an ordinary reviewed commit: run --print-latest, replace
// the sha below, run the script, run the build and the tests.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPS_DIR = path.join(ROOT, "deps");

export const PINS = [
  {
    name: "abap2ui5",
    url: "https://github.com/abap2UI5/abap2UI5",
    sha: "997e73d50d33fce4a5610befb35722cd15a5d2de",
    note: "the framework itself - src/ is downported and transpiled",
  },
  {
    /* The UI5 frontend, which used to come out of the same clone as
     * `build/cloud/app/webapp`. abap2UI5#2676 removed that checked-in tree:
     * the frontend is BUILT there from app/webapp and PUBLISHED here, one
     * result/<variant> tree per delivery branch. `cloud` is the variant this
     * playground serves.
     *
     * Two pins for one upstream is a cost, and the pair is held together
     * rather than trusted: result/cloud/VERSION names the abap2UI5 commit its
     * webapp was mirrored from, and checkFrontendProvenance( ) below fails the
     * fetch when that is not the framework pin above. Without it the two could
     * drift a release apart and the only symptom would be a playground whose
     * frontend and backend disagree at runtime. */
    name: "abap2ui5-frontend",
    url: "https://github.com/abap2UI5/frontend",
    sha: "f58d245a4386d9134ee1a0bebce4c6b17decb517",
    note: "the published UI5 frontend - result/cloud/app/webapp, mirrored from the framework pin above",
  },
  {
    name: "open-abap-core",
    url: "https://github.com/open-abap/open-abap-core",
    // The commit abap2UI5 itself pins, so the playground transpiles the
    // framework against the same standard library its CI tests against.
    sha: "48335c7351ad72265f7272177e1e3e2fec259a16",
    note: "ABAP standard library for abaplint and the transpiler",
  },
];

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

if (process.argv.includes("--print-latest")) {
  for (const p of PINS) {
    const head = git(["ls-remote", p.url, "HEAD"]).split("\t")[0];
    const mark = head === p.sha ? "(pinned = latest)" : `(pinned: ${p.sha})`;
    console.log(`${p.name}: ${head} ${mark}`);
  }
  process.exit(0);
}

const useLatest = process.argv.includes("--latest");

let failures = 0;
for (const p of PINS) {
  const dir = path.join(DEPS_DIR, p.name);
  try {
    const wanted = useLatest ? git(["ls-remote", p.url, "HEAD"]).split("\t")[0] : p.sha;
    if (useLatest && wanted !== p.sha) {
      console.log(`fetch-deps: ${p.name} @ ${wanted.slice(0, 12)} (upstream HEAD, pin is ${p.sha.slice(0, 12)})`);
    }
    if (fs.existsSync(path.join(dir, ".git")) && git(["rev-parse", "HEAD"], dir) === wanted) {
      console.log(`fetch-deps: ${p.name} already at ${wanted.slice(0, 12)}`);
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    git(["init", "--quiet"], dir);
    git(["remote", "add", "origin", p.url], dir);
    git(["fetch", "--quiet", "--depth", "1", "origin", wanted], dir);
    git(["checkout", "--quiet", "--detach", "FETCH_HEAD"], dir);
    console.log(`fetch-deps: ${p.name} @ ${wanted.slice(0, 12)}`);
  } catch (e) {
    // Leave nothing half-checked-out behind - a partial tree would fail much
    // later, in the middle of a transpile, with an error that points nowhere.
    fs.rmSync(dir, { recursive: true, force: true });
    failures++;
    console.error(`fetch-deps: ERROR ${p.name} - ${String(e.message).split("\n")[0]}`);
  }
}

if (failures) {
  console.error(`fetch-deps: ${failures} dependency/dependencies could not be pinned`);
  process.exit(1);
}

/* The frontend is a MIRROR of the framework's app/webapp, published by
 * abap2UI5's frontend_deploy. Two pins can drift, and the drift is invisible:
 * both trees fetch, both build, and the playground only disagrees with itself
 * at runtime - a frontend calling a backend that answers a different protocol.
 *
 * result/<variant>/VERSION records which abap2UI5 commit the webapp was
 * mirrored from, so the pair is checkable rather than a convention. A bump is
 * therefore two lines that have to move together, and this says so when they
 * do not.
 *
 * Deliberately a hard failure and not a warning: a warning here is read once
 * and then not, and the thing it guards against does not announce itself. */
function checkFrontendProvenance() {
  const file = path.join(DEPS_DIR, "abap2ui5-frontend", "result", "cloud", "VERSION");
  const framework = PINS.find((p) => p.name === "abap2ui5");
  if (useLatest || !fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/abap2UI5\/abap2UI5@([0-9a-f]{40})/);
  if (!m) {
    console.error("fetch-deps: result/cloud/VERSION carries no `abap2UI5/abap2UI5@<sha>` line -");
    console.error("  the provenance format changed; update checkFrontendProvenance in this file.");
    process.exit(1);
  }
  if (m[1] !== framework.sha) {
    console.error("fetch-deps: the two abap2UI5 pins disagree.");
    console.error(`  framework pin          ${framework.sha}`);
    console.error(`  frontend was built from ${m[1]}`);
    console.error("  Both move together: pick a frontend commit whose result/cloud/VERSION");
    console.error("  names the framework commit you want, or the reverse.");
    process.exit(1);
  }
  console.log(`fetch-deps: frontend mirrors the pinned framework (${m[1].slice(0, 12)})`);
}
checkFrontendProvenance();
console.log(useLatest ? "fetch-deps: all dependencies at upstream HEAD" : "fetch-deps: all dependencies at pinned SHAs");
