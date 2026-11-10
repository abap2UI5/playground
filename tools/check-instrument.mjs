// The debug build over real code: every carried sample and every abap2UI5
// class, transpiled and instrumented (src/editor/instrument.mjs) the way the
// playground does it in the browser, and each result parsed. A hook that
// makes the transpiler's output a SyntaxError would cost a reader their
// breakpoints in that class - the playground falls back to the plain build
// (transpile-core.mjs) - and this is where it shows before anybody meets it.
//
// It says how many methods and statements it
// instrumented and fails on the first object that does not parse.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as abaplint from "@abaplint/core";
import { Transpiler, UnknownTypesEnum } from "@abaplint/transpiler";
import { instrument, statementStarts } from "../src/editor/instrument.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// The samples, abap2UI5 as the framework build downported it (the build's
// own input, build/downport), and open-abap under both for the types they
// name - all of it instrumented, which is only more code to prove the hooks
// on. Run after `npm run build`.
const DIRS = [path.join(ROOT, "deps", "abap2ui5-samples", "src"), path.join(ROOT, "build", "downport"), path.join(ROOT, "deps", "open-abap-core", "src")];

function abapFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...abapFiles(at));
    else if (/\.(clas|intf)\.(abap|xml)$/.test(entry.name) || /\.clas\.(testclasses|locals_imp|locals_def)\.abap$/.test(entry.name)) out.push(at);
  }
  return out;
}

const files = DIRS.flatMap(abapFiles);
if (files.length === 0) {
  console.error("check-instrument: no sources under deps/ and build/ - run `npm run build` first");
  process.exit(1);
}

const reg = new abaplint.Registry(new abaplint.Config(JSON.stringify({
  global: { files: "/**/*.*" },
  syntax: { version: abaplint.Version.v702, errorNamespace: "." },
  rules: {},
})));
for (const f of files) reg.addFile(new abaplint.MemoryFile(path.basename(f), fs.readFileSync(f, "utf8")));
reg.parse();

const started = Date.now();
const output = await new Transpiler({
  ignoreSyntaxCheck: true,
  addFilenames: false,
  addCommonJS: false,
  unknownTypes: UnknownTypesEnum.runtimeError,
  keywords: ["return", "in", "class", "for", "delete", "var", "with"],
}).run(reg);

const starts = new Map();
for (const obj of reg.getObjects()) {
  for (const file of obj.getABAPFiles?.() ?? []) starts.set(path.basename(file.getFilename()), statementStarts(file));
}

const AsyncFunction = (async () => {}).constructor;
let objects = 0;
let methods = 0;
let statements = 0;
const failed = [];
for (const o of output.objects) {
  if (!o.chunk) continue;
  const code = o.chunk.getCode();
  const result = instrument(code, o.chunk.mappings ?? [], starts);
  if (!result) continue;
  objects++;
  methods += result.methods.length;
  statements += result.methods.reduce((n, m) => n + m.lines.length, 0);
  if (result.js.split("\n").length !== code.split("\n").length) failed.push(`${o.filename}: the line count changed`);
  // Only what the hooks broke counts: some of open-abap's kernel classes are
  // JavaScript the playground never evaluates this way (import.meta, an
  // await in a callback), plain or not.
  let plainParses = true;
  try {
    new AsyncFunction("abap", code);
  } catch {
    plainParses = false;
  }
  try {
    new AsyncFunction("abap", result.js);
  } catch (e) {
    if (plainParses) failed.push(`${o.filename}: ${e.message}`);
  }
}

console.log(`check-instrument: ${objects} objects, ${methods} methods, ${statements} stoppable lines, in ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (failed.length > 0) {
  for (const f of failed.slice(0, 20)) console.error(`  ${f}`);
  console.error(`check-instrument: ${failed.length} object(s) would run without breakpoints`);
  process.exit(1);
}
