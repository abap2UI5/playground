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
    sha: "67f214d65bd9700a67db1761196e7208c99f67fb",
    note: "the framework itself - src/ is downported and transpiled, build/cloud/app/webapp is the UI5 frontend",
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

let failures = 0;
for (const p of PINS) {
  const dir = path.join(DEPS_DIR, p.name);
  try {
    if (fs.existsSync(path.join(dir, ".git")) && git(["rev-parse", "HEAD"], dir) === p.sha) {
      console.log(`fetch-deps: ${p.name} already at ${p.sha.slice(0, 12)}`);
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    git(["init", "--quiet"], dir);
    git(["remote", "add", "origin", p.url], dir);
    git(["fetch", "--quiet", "--depth", "1", "origin", p.sha], dir);
    git(["checkout", "--quiet", "--detach", "FETCH_HEAD"], dir);
    console.log(`fetch-deps: ${p.name} @ ${p.sha.slice(0, 12)}`);
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
console.log("fetch-deps: all dependencies at pinned SHAs");
