// Pre-build patch: teach the pinned @abaplint/transpiler that `IS SUPPLIED` on a
// RETURNING parameter is true when the caller receives the result.
//
// Runs against the INSTALLED package in this checkout, before anything that
// bundles it: tools/build-framework.mjs (the framework transpile) and
// tools/build-site.mjs (the registry worker, which is the transpiler the page
// runs in the reader's browser). Idempotent by marker, so calling it before
// every build costs a file read.
//
// Why:
//
//     METHOD wire.
//       IF result IS SUPPLIED.        "  v = client->follow_up_action( ... )
//         result = |wired:{ val }|.   "     -> the roundtrip-free view wire
//         RETURN.
//       ENDIF.
//       WRITE / |queued:{ val }|.     "  client->follow_up_action( ... ).
//     ENDMETHOD.
//
// On a system `result IS SUPPLIED` is true exactly when the result is received
// and false when the call is a standalone statement that discards it. The
// transpiler compiles the predicate to `(INPUT && INPUT.result)` and emits the
// SAME call shape for both forms - `await this.wire({val: ...})`, with no
// `result` key in either - so the predicate is always false and the consumed
// branch is dead code.
//
// abap2UI5's `follow_up_action( )` is two calls in one and tells them apart by
// exactly that predicate, so on this site every handler an app writes into a
// VIEW ATTRIBUTE came out as the empty string: the control reached the browser
// with no handler, and the action fired as a follow-up on the first response
// instead - which is where the `${$source>/text} has been activated` toast on
// the App 003 sample page came from, `{0}` filled with the binding as a literal
// string. 543 view-wired calls in 157 classes in samples-controls alone, and
// the same shape in the other two sample repositories.
//
// It is a shim for a defect filed upstream as
// `backlog/items/transpiler-returning-is-supplied.md` (abap2UI5/abap2UI5) with
// the fix proposed to abaplint/transpiler. The replacements below are that same
// change, applied to the compiled package rather than the TypeScript.
//
// REMOVING THIS: when the pinned transpiler carries the fix, delete this file,
// its two call sites (tools/build-framework.mjs, tools/build-site.mjs), the
// line in build-framework's outputHash( ) and tests/transpiler-patch.spec.js.
// The version assertion below fails the build on any other version, so a
// dependabot bump cannot carry the site past it silently.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = path.join(ROOT, "node_modules", "@abaplint", "transpiler");
const SRC = path.join(PKG, "build", "src");
const MARKER = "/* abap2ui5-playground: RETURNING IS SUPPLIED */";

/* Each edit names the file it belongs to, the exact text it replaces and what
 * it puts there. `find` is copied from the compiled package, so a transpiler
 * that no longer emits it fails the build by name instead of being patched into
 * something that only looks right. */
const EDITS = [
  {
    file: "expressions/parameter_list_s.js",
    find: `class ParameterListSTranspiler {
    transpile(node, traversal) {
        const parameters = [];`,
    replace: `class ParameterListSTranspiler {
    extraEntry;
    constructor(extraEntry) {
        this.extraEntry = extraEntry;
    }
    transpile(node, traversal) {
        const parameters = [];`,
  },
  {
    file: "expressions/parameter_list_s.js",
    find: `        return new chunk_1.Chunk().appendString("{").join(parameters).appendString("}");`,
    replace: `        if (this.extraEntry !== undefined) {
            parameters.push(new chunk_1.Chunk(this.extraEntry));
        }
        return new chunk_1.Chunk().appendString("{").join(parameters).appendString("}");`,
  },
  {
    file: "expressions/method_call_param.js",
    find: `const chunk_1 = require("../chunk");
class MethodCallParamTranspiler {
    m;
    constructor(m) {
        this.m = m;
    }
    transpile(node, traversal) {
        let name = "";`,
    replace: `const chunk_1 = require("../chunk");
const parameter_list_s_1 = require("./parameter_list_s");
class MethodCallParamTranspiler {
    m;
    supplyReturning;
    constructor(m, supplyReturning = false) {
        this.m = m;
        this.supplyReturning = supplyReturning;
    }
    returningName() {
        if (this.supplyReturning === false) {
            return undefined;
        }
        return this.m?.getParameters().getReturning()?.getName().toLowerCase();
    }
    transpile(node, traversal) {
        let name = "";
        const returning = this.returningName();
        const returningEntry = returning === undefined ? undefined : returning + ": 1";`,
  },
  {
    file: "expressions/method_call_param.js",
    find: `                return new chunk_1.Chunk()
                    .appendString("{" + def + ": ")
                    .appendChunk(traversal.traverse(source))
                    .appendString("}");`,
    replace: `                const ret = new chunk_1.Chunk()
                    .appendString("{" + def + ": ")
                    .appendChunk(traversal.traverse(source));
                if (returningEntry !== undefined) {
                    ret.appendString(", " + returningEntry);
                }
                return ret.appendString("}");`,
  },
  {
    file: "expressions/method_call_param.js",
    find: `        if (parameters) {
            return traversal.traverse(parameters);
        }`,
    replace: `        if (parameters) {
            return new parameter_list_s_1.ParameterListSTranspiler(returningEntry).transpile(parameters, traversal);
        }`,
  },
  {
    file: "expressions/method_call_param.js",
    find: `        name = name.replace(/}{/g, ", ");
        return new chunk_1.Chunk(name);`,
    replace: `        name = name.replace(/}{/g, ", ");
        if (returningEntry !== undefined) {
            if (name === "") {
                name = "{" + returningEntry + "}";
            }
            else if (name.startsWith("{") && name.endsWith("}")) {
                const inner = name.substring(1, name.length - 1);
                name = "{" + (inner === "" ? "" : inner + ", ") + returningEntry + "}";
            }
        }
        return new chunk_1.Chunk(name);`,
  },
  {
    file: "expressions/method_call.js",
    find: `    postName;
    method;`,
    replace: `    postName;
    method;
    supplyReturning;`,
  },
  {
    file: "expressions/method_call.js",
    find: `    constructor(postName = "", method) {
        this.postName = postName;
        this.method = method;
    }`,
    replace: `    constructor(postName = "", method, supplyReturning = false) {
        this.postName = postName;
        this.method = method;
        this.supplyReturning = supplyReturning;
    }`,
  },
  {
    // a builtin is a plain runtime function, not a method taking an INPUT
    // object; line_exists/line_index wrap their argument in a callback where an
    // object entry is not even syntax
    file: "expressions/method_call.js",
    find: `        if (traversal.isBuiltinMethod(nameToken)) {`,
    replace: `        const isBuiltin = traversal.isBuiltinMethod(nameToken);
        if (isBuiltin) {`,
  },
  {
    file: "expressions/method_call.js",
    find: `        ret.appendChunk(new method_call_param_1.MethodCallParamTranspiler(m?.def).transpile(step, traversal));`,
    replace: `        ret.appendChunk(new method_call_param_1.MethodCallParamTranspiler(m?.def, this.supplyReturning && isBuiltin === false).transpile(step, traversal));`,
  },
  {
    file: "expressions/method_call_body.js",
    find: `class MethodCallBodyTranspiler {
    m;
    constructor(m) {
        this.m = m;
    }`,
    replace: `class MethodCallBodyTranspiler {
    m;
    supplyReturning;
    constructor(m, supplyReturning = false) {
        this.m = m;
        this.supplyReturning = supplyReturning;
    }`,
  },
  {
    file: "expressions/method_call_body.js",
    find: `                ret.appendChunk(new method_call_param_1.MethodCallParamTranspiler(this.m).transpile(c, traversal));`,
    replace: `                ret.appendChunk(new method_call_param_1.MethodCallParamTranspiler(this.m, this.supplyReturning).transpile(c, traversal));`,
  },
  {
    // only the LAST call of a chain that is a statement is discarded - every
    // earlier one hands its result on as the next receiver
    file: "expressions/method_call_chain.js",
    find: `class MethodCallChainTranspiler {
    transpile(node, traversal) {
        let ret = new chunk_1.Chunk();
        const children = node.getChildren();
        for (const c of children) {`,
    replace: `class MethodCallChainTranspiler {
    discardLastResult;
    constructor(discardLastResult = false) {
        this.discardLastResult = discardLastResult;
    }
    transpile(node, traversal) {
        let ret = new chunk_1.Chunk();
        const children = node.getChildren();
        let lastCall = undefined;
        if (this.discardLastResult === true) {
            for (const c of children) {
                if (c instanceof core_1.Nodes.ExpressionNode && c.get() instanceof core_1.Expressions.MethodCall) {
                    lastCall = c;
                }
            }
        }
        for (const c of children) {`,
  },
  {
    file: "expressions/method_call_chain.js",
    find: `                const sub = prefix === undefined
                    ? traversal.traverse(c)
                    : new method_call_1.MethodCallTranspiler(".bind(this)", method).transpile(c, traversal);`,
    replace: `                const supplyReturning = c !== lastCall;
                const sub = prefix === undefined
                    ? new method_call_1.MethodCallTranspiler("", undefined, supplyReturning).transpile(c, traversal)
                    : new method_call_1.MethodCallTranspiler(".bind(this)", method, supplyReturning).transpile(c, traversal);`,
  },
  {
    file: "statements/call.js",
    find: `            const chainChunk = traversal.traverse(chain);`,
    replace: `            const chainChunk = new (require("../expressions/method_call_chain").MethodCallChainTranspiler)(receiving === undefined).transpile(chain, traversal);`,
  },
  {
    file: "statements/call.js",
    find: `            const methodCallBody = node.findDirectExpression(abaplint.Expressions.MethodCallBody);`,
    replace: `            const receivingParam = node.findFirstExpression(abaplint.Expressions.MethodParameters)?.findExpressionAfterToken("RECEIVING");
            const methodCallBody = node.findDirectExpression(abaplint.Expressions.MethodCallBody);`,
  },
  {
    file: "statements/call.js",
    find: `                    body = new expressions_1.MethodCallBodyTranspiler(m?.def).transpile(methodCallBody, traversal).getCode();`,
    replace: `                    body = new expressions_1.MethodCallBodyTranspiler(m?.def, receivingParam !== undefined).transpile(methodCallBody, traversal).getCode();`,
  },
  {
    file: "statements/call.js",
    find: `            const receiving = node.findFirstExpression(abaplint.Expressions.MethodParameters)?.findExpressionAfterToken("RECEIVING");
            if (receiving) {
                const target = traversal.traverse(receiving.findDirectExpression(abaplint.Expressions.Target));`,
    replace: `            const receiving = receivingParam;
            if (receiving) {
                const target = traversal.traverse(receiving.findDirectExpression(abaplint.Expressions.Target));`,
  },
];

export function patchTranspilerReturning() {
  const pinned = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
    .devDependencies["@abaplint/transpiler"];
  const installed = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;
  if (installed !== pinned) {
    throw new Error(
      `patch-transpiler-returning: @abaplint/transpiler is ${installed}, package.json pins ${pinned} - run npm ci`,
    );
  }

  const files = new Map();
  for (const edit of EDITS) {
    if (files.has(edit.file) === false) {
      files.set(edit.file, fs.readFileSync(path.join(SRC, edit.file), "utf8"));
    }
  }

  // already patched: every file carries the marker
  if ([...files.values()].every((c) => c.includes(MARKER))) {
    console.log(`patch-transpiler-returning: already applied to ${installed}`);
    return;
  }

  for (const edit of EDITS) {
    const before = files.get(edit.file);
    const occurrences = before.split(edit.find).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `patch-transpiler-returning: ${edit.file} in ${installed} has ${occurrences} matches for\n${edit.find}\n` +
          "- the transpiler no longer emits what this patch rewrites; check whether it carries the fix and this file can go",
      );
    }
    files.set(edit.file, before.replace(edit.find, edit.replace));
  }

  for (const [file, content] of files) {
    fs.writeFileSync(path.join(SRC, file), `${MARKER}\n${content}`);
  }
  console.log(`patch-transpiler-returning: patched ${files.size} file(s) of @abaplint/transpiler ${installed}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  patchTranspilerReturning();
}
