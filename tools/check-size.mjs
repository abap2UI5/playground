#!/usr/bin/env node
// A budget for what the playground weighs.
//
// The page is big by nature - it carries a whole ABAP runtime, a whole UI5, and
// a compiler - so "big" is not the thing to guard against. What is worth
// catching is a change that makes it bigger without anyone noticing: a stray
// import that drags a second copy of abaplint into the page bundle, a corpus
// that stopped being filtered, a UI5 build that stopped being trimmed.
//
// The numbers are the measured sizes with room above them, not aspirations.
// Raising one is fine - it is a line in a commit that says the cost was
// accepted, which is the whole point.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const MB = 1024 * 1024;

// Everything a visitor downloads before the playground is usable. These are the
// ones measured compressed, because that is what travels.
const TRANSFERRED = [
  { file: "assets/shell.mjs", limit: 3.5 * MB, note: "Monaco, abaplint and the transpiler" },
  { file: "runtime/framework.mjs", limit: 1.5 * MB, note: "abap2UI5 and open-abap, transpiled" },
  { file: "editor/corpus.json", limit: 1.5 * MB, note: "the ABAP sources the editor checks against" },
  { file: "runtime/sql-wasm.wasm", limit: 0.5 * MB, note: "SQLite" },
];

// The whole site. Most of it is UI5, which is fetched a bundle at a time and
// never downloaded whole - so this guards the Pages artifact, not the visitor.
const TOTAL_LIMIT = 200 * MB;

const size = (p) => fs.statSync(p).size;
const gzipped = (p) => zlib.gzipSync(fs.readFileSync(p), { level: 9 }).length;
const mb = (n) => `${(n / MB).toFixed(2)} MB`;

let failed = false;

console.log("what a visitor downloads (compressed, as it is served):");
for (const { file, limit, note } of TRANSFERRED) {
  const full = path.join(DIST, file);
  if (!fs.existsSync(full)) {
    console.error(`  MISSING  ${file} - the build did not produce it`);
    failed = true;
    continue;
  }
  const actual = gzipped(full);
  const over = actual > limit;
  if (over) failed = true;
  console.log(
    `  ${over ? "OVER   " : "ok     "} ${file.padEnd(26)} ${mb(actual).padStart(9)} of ${mb(limit).padStart(9)}` +
      `   (${mb(size(full))} uncompressed, ${note})`,
  );
}

const total = Number(execFileSync("du", ["-sb", DIST]).toString().split("\t")[0]);
const totalOver = total > TOTAL_LIMIT;
if (totalOver) failed = true;
console.log(`\nthe published site: ${mb(total)} of ${mb(TOTAL_LIMIT)} ${totalOver ? "OVER" : "ok"}`);

if (failed) {
  console.error(
    "\ncheck-size: over budget. Either the change is heavier than intended, or the budget in " +
      "tools/check-size.mjs should move - deliberately, in this commit.",
  );
  process.exit(1);
}
