// The debug build without a browser (src/editor/instrument.mjs): the hooks
// land on the statements a debugger stops at and nowhere else, the code
// still parses, keeps its line count, and runs - with the hooks called in
// the order the ABAP runs. tools/check-instrument.mjs does the same over
// every sample and framework class; tests/debug.spec.js drives the debugger.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as abaplint from "@abaplint/core";
import { Transpiler } from "@abaplint/transpiler";
import { ABAP, MemoryConsole } from "@abaplint/runtime";
import { instrument, statementStarts } from "../../src/editor/instrument.mjs";

const fixture = (name) => readFileSync(new URL(`../fixtures/debug/${name}`, import.meta.url), "utf8");
const AsyncFunction = (async () => {}).constructor;

// The playground's compile, in short: the transpiler as transpile-core.mjs
// configures it, and the statements of each file by its plain name.
async function build(name) {
  const reg = new abaplint.Registry();
  // The browser's registry names a file by its URI; the hooks must not care.
  reg.addFile(new abaplint.MemoryFile(`file:///${name}`, fixture(name)));
  reg.parse();
  const out = await new Transpiler({
    ignoreSyntaxCheck: true,
    addFilenames: false,
    addCommonJS: false,
    unknownTypes: "runtimeError",
    keywords: ["return", "in", "class", "for", "delete", "var", "with"],
  }).run(reg);
  const starts = new Map();
  for (const obj of reg.getObjects()) for (const f of obj.getABAPFiles()) starts.set(f.getFilename().replace(/^.*\//, ""), statementStarts(f));
  const o = out.objects.find((x) => x.chunk);
  const plain = o.chunk.getCode();
  return { plain, result: instrument(plain, o.chunk.mappings, starts) };
}

const linesOf = (result, method) => result.methods.find((m) => m.method === method).lines;

test("every method is framed, and the code parses with the line count it had", async () => {
  for (const name of ["zcl_dbg_shapes.clas.abap", "zcl_dbg_calls.clas.abap"]) {
    const { plain, result } = await build(name);
    assert.equal(result.js.split("\n").length, plain.split("\n").length, name);
    assert.doesNotThrow(() => new AsyncFunction("abap", result.js), name);
    assert.equal(result.js.match(/abap\.dbg\.enter\(/g).length, result.methods.length);
    assert.equal(result.js.match(/abap\.dbg\.leave\(/g).length, result.methods.length);
  }
});

test("the stops are the statements, not ELSE, WHEN, CATCH or the declarations", async () => {
  const { result } = await build("zcl_dbg_shapes.clas.abap");
  const run = linesOf(result, "RUN");
  // DO, APPEND, ENDDO, LOOP, the call in the loop, ENDLOOP, two statements on
  // line 46, WHILE … ENDWHILE, IF, BREAK-POINT, the branches, ENDIF, CASE and
  // its branches, TRY and its statement, APPEND, WRITE, IF, RAISE, ENDIF, the
  // static call, ENDMETHOD.
  assert.deepEqual(run, [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 54, 56, 57, 58, 60, 62, 64, 65, 71, 72, 73, 74, 75, 76, 77]);
  for (const notOne of [36, 37, 39, 53, 55, 59, 61, 66, 68]) assert.ok(!run.includes(notOne), `line ${notOne}`);
  // A static method's body is the static one, not its instance forwarder.
  assert.deepEqual(linesOf(result, "TWICE"), [27, 28, 29]);
  assert.match(result.js, /static async twice\(INPUT\) \{ let \$dbg; try \{/);
  // A method with nothing in it still has its ENDMETHOD.
  assert.deepEqual(linesOf(result, "NOTHING"), [85]);
  // The locals the debugger can read, a field symbol by its JavaScript name.
  assert.deepEqual(result.methods.find((m) => m.method === "RUN").locals, ["rv_out", "iv_in", "lv_inline", "lx", "lt_tab", "lv_sum", "lv_text", "fs_lv_"]);
  // BREAK-POINT stops for itself; RAISE says it is one.
  assert.match(result.js, /await \$dbg\.stop\(51, 2\);/);
  assert.match(result.js, /if \(\$dbg\.hit\(74, 1\)\) await \$dbg\.stop\(74, 1\);/);
});

test("a call statement stops before the call, whatever its first mapping points at", async () => {
  const { result } = await build("zcl_dbg_calls.clas.abap");
  assert.deepEqual(linesOf(result, "GO"), [11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23]);
  assert.match(result.js, /if \(\$dbg\.hit\(14\)\) await \$dbg\.stop\(14\); await this\.mo_other\.get\(\)\.take/);
});

test("the instrumented class runs as before, its hooks called in the order the ABAP runs", async () => {
  const { result } = await build("zcl_dbg_calls.clas.abap");
  const abap = new ABAP({ console: new MemoryConsole() });
  const hits = [];
  const depth = [];
  abap.dbg = {
    methods: (list) => list,
    enter(me, info) {
      depth.push(info.method);
      return {
        hit: (line) => {
          hits.push(`${info.method}:${line}`);
          return false;
        },
        stop: async () => {},
        info,
      };
    },
    leave: () => depth.pop(),
  };
  await new AsyncFunction("abap", `${result.js}\nreturn true;`)(abap);
  const obj = await new abap.Classes.ZCL_DBG_CALLS().constructor_();
  await obj.go();
  assert.deepEqual(hits, [
    "GO:11", "TAKE:26", "GO:12", "TAKE:26", "GO:13", "GO:14", "TAKE:26", "GO:16", "STAT:29", "GO:17", "TAKE:26",
    "GO:18", "GO:19", "TAKE:26", "GO:20", "GO:21", "GO:22",
  ]);
  // Every frame left again, the RETURN's included.
  assert.equal(depth.length, 0);
});

test("nothing to instrument is said, not invented", () => {
  assert.equal(instrument("const x = 1;", [], new Map()), undefined);
});
