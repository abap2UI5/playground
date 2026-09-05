#!/usr/bin/env node
// A budget for what the playground weighs, and for what it asks of the browser
// it opens in.
//
// The page is big by nature - it carries a whole ABAP runtime, a whole UI5, and
// a compiler - so "big" is not the thing to guard against. What is worth
// catching is a change that makes it bigger without anyone noticing: a stray
// import that drags a second copy of abaplint into the page bundle, a corpus
// that stopped being filtered, a UI5 build that stopped being trimmed.
//
// The numbers are the measured sizes with a little room above them, not
// aspirations - close enough that a stray import shows up as red rather than
// as a number nobody looks at. Raising one is fine - it is a line in a commit
// that says the cost was accepted, which is the whole point.
//
// The second budget is not a size. Starting the playground parses nine hundred
// ABAP objects with abaplint, whose statement parser is a tree of recursive
// combinators - so one long enough statement is a stack deep enough to end the
// page, and how deep is too deep is not the same number in every browser.
// tools/build-site.mjs has the story of the phone that found this.
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
//
// The page bundle is several files - assets/shell.mjs and the chunks esbuild
// split off it, whose names carry a hash - so that entry is a pattern, and
// the budget is over their sum: a chunk is still a download, and a module
// that moved from the entry into a chunk has not gotten any smaller.
const TRANSFERRED = [
  { file: "assets/*.mjs", limit: 1.3 * MB, note: "Monaco and the abap2UI5 linter" },
  { file: "editor/registry.mjs", limit: 0.7 * MB, note: "abaplint and the transpiler, in the registry worker" },
  { file: "runtime/framework.mjs", limit: 0.8 * MB, note: "abap2UI5 and open-abap, transpiled" },
  { file: "editor/corpus.json", limit: 0.6 * MB, note: "the ABAP sources the editor checks against" },
  { file: "runtime/sql-wasm.wasm", limit: 0.4 * MB, note: "SQLite" },
  /* The sample catalogue at /samples/ is its own document and its own wait:
   * nobody downloads it to write ABAP, and nobody downloads the playground to
   * read it. Budgeted because it is the one file here that grows with the
   * corpus - a sample added in any of the three repositories adds a row - and
   * it is what stands between opening the page and seeing a list. It
   * compresses hard: it is 770 near-identical objects. */
  { file: "samples/apps.json", limit: 0.25 * MB, note: "the sample catalogue's index, 770 samples" },
  { file: "samples/catalogue.mjs", limit: 0.02 * MB, note: "the catalogue page itself" },
  /* The bar's search box, loaded by the catalogue and by every per-sample
   * page - so it is one file for 773 documents, and the budget is on the file
   * rather than on the sum. What it searches is not in here: the index is
   * fetched from the documentation's deployment, and only once somebody
   * types. */
  { file: "samples/search.mjs", limit: 0.012 * MB, note: "the search box in the bar" },
];

// The whole site. Most of it is UI5, which is fetched a bundle at a time and
// never downloaded whole - so this guards the Pages artifact, not the visitor.
//
// It moved from 200 MB when every line of every printed class got an id and a
// numbered link (#L42 and #L42-L58 on a sample's page, AGENTS.md says why):
// 191,000 lines of markup is 16 MB, and the sample pages went from 39 MB to
// 55. That is the accepted cost, written here as this file asks for it to be -
// deliberately, in the commit that spends it - and what is left above it is
// room for the sample corpus to keep growing, not for the next feature to
// land unmeasured.
const TOTAL_LIMIT = 220 * MB;

// How much JavaScript stack the boot parse is allowed to want. Measured: the
// shipped corpus needs a little over 130 KB, and needed more than 610 KB while
// abap2UI5's generated frontend was still in it. Node and Chrome hand out a
// little under a megabyte, mobile Safari less - so this is set where a change
// that costs several times more fails here rather than on somebody's phone,
// which is the only place the last one was reported from.
const STACK_BUDGET_KB = 256;

// The budget is checked by doing the thing: this file re-runs itself with that
// much stack and parses the corpus the way boot( ) does - the same registry,
// the same rules, out of the same dist/ the tests run against - so what is
// measured is the playground rather than a model of it.
if (process.argv[2] === "--parse-corpus") {
  const { buildRegistry } = await import(new URL("../src/editor/registry-core.mjs", import.meta.url));
  const corpus = JSON.parse(fs.readFileSync(path.join(DIST, "editor", "corpus.json"), "utf8"));
  await buildRegistry(corpus, Promise.resolve([]), () => {});
  process.exit(0);
}

const size = (p) => fs.statSync(p).size;
const gzipped = (p) => zlib.gzipSync(fs.readFileSync(p), { level: 9 }).length;
const mb = (n) => `${(n / MB).toFixed(2)} MB`;

let failed = false;

// The files a TRANSFERRED entry names: the one file, or - for a pattern with
// a `*` in its base name - every file in that directory the pattern matches.
function expand(file) {
  if (!file.includes("*")) return fs.existsSync(path.join(DIST, file)) ? [file] : [];
  const dir = path.dirname(file);
  const pattern = new RegExp(`^${path.basename(file).split("*").map((s) => s.replace(/[.]/g, "\\.")).join(".*")}$`);
  if (!fs.existsSync(path.join(DIST, dir))) return [];
  return fs
    .readdirSync(path.join(DIST, dir))
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => `${dir}/${name}`);
}

console.log("what a visitor downloads (compressed, as it is served):");
for (const { file, limit, note } of TRANSFERRED) {
  const files = expand(file);
  if (files.length === 0) {
    console.error(`  MISSING  ${file} - the build did not produce it`);
    failed = true;
    continue;
  }
  const actual = files.reduce((n, f) => n + gzipped(path.join(DIST, f)), 0);
  const raw = files.reduce((n, f) => n + size(path.join(DIST, f)), 0);
  const over = actual > limit;
  if (over) failed = true;
  console.log(
    `  ${over ? "OVER   " : "ok     "} ${file.padEnd(26)} ${mb(actual).padStart(9)} of ${mb(limit).padStart(9)}` +
      `   (${mb(raw)} uncompressed, ${note})`,
  );
  if (files.length > 1) {
    for (const f of files) console.log(`           ${f.padEnd(26)} ${mb(gzipped(path.join(DIST, f))).padStart(9)}`);
  }
}

console.log("\nwhat it asks of the browser:");
let stackDetail = "";
let stackOk = true;
try {
  execFileSync(process.execPath, [`--stack-size=${STACK_BUDGET_KB}`, fileURLToPath(import.meta.url), "--parse-corpus"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
} catch (e) {
  stackOk = false;
  failed = true;
  stackDetail = String(e.stderr ?? "")
    .split("\n")
    .find((l) => l.includes("Error"))
    ?.trim() ?? "the parse did not finish";
}
console.log(
  `  ${stackOk ? "ok     " : "OVER   "} the corpus parses in ${STACK_BUDGET_KB} KB of JavaScript stack` +
    (stackOk ? "" : `   (${stackDetail})`),
);
if (!stackOk) {
  console.error(
    "  A statement somewhere in the corpus is deep enough to exhaust the stack. That is a page\n" +
      "  that does not start on a browser with less of one than this machine has - see the\n" +
      "  GENERATED_FRONTEND note in tools/build-site.mjs for the last source of it.",
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
