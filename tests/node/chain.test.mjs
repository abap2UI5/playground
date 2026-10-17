// The View tab's edit mode without a browser: the builder chain read out of
// the ABAP (chain-read.mjs), written again in the house layout
// (chain-write.mjs) and patched in place (chain-patch.mjs). The browser specs
// in tests/view-edit.spec.js drive the same code through the page; these hold
// the properties underneath them in milliseconds, on the same sample.
//
// The fixture is abap2UI5/samples' "Data Binding" app (z2ui5_cl_smp_app_494),
// the one view-edit.spec.js edits - copied here so the unit tests need no
// build: a chain in the split shape (a statement per subtree, held in
// variables), with a bind, an event, a boolean and a value wrapped over six
// lines in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { alignWithXml, commentIn, qnameOf, readViewChain, withoutComments } from "../../src/shell/chain-read.mjs";
import { abapLiteral, unwritable, writeViewChain } from "../../src/shell/chain-write.mjs";
import { patchChain } from "../../src/shell/chain-patch.mjs";
import { installDom } from "./dom.mjs";

installDom();

const SOURCE = readFileSync(new URL("fixtures/binding.clas.abap", import.meta.url), "utf8");

// The abap2UI5 linter, for its `chain-house-layout` rule: the claim is that
// what the writer writes passes it, so it is run rather than restated.
const { checkAbapSource } = createRequire(import.meta.url)("@abap2ui5/linter");
const layoutFindings = (source) =>
  checkAbapSource(source, { minUi5: "1.71", distribution: "openui5", rules: { "chain-house-layout": "error" } })
    .findings.map((f) => `${f.type} at line ${f.line}: ${f.message}`);

const write = (chain, element = chain.root.children[0], eol = "\n") =>
  writeViewChain({ indent: chain.indent, assignment: chain.assignment, element, eol });

const splice = (source, chain, text) => source.slice(0, chain.start) + text + source.slice(chain.end);

// The tree view-edit.mjs's merge( ) hands chain-patch.mjs for an edit that
// changed nothing: every node and attribute a copy that remembers, as `from`,
// the one it came from.
function mirror(node) {
  return {
    name: node.name,
    ns: node.ns,
    attrs: node.attrs.map((a) => ({ name: a.name, raw: a.raw, boolean: a.boolean, key: a.key, literal: a.literal, from: a })),
    children: node.children.map(mirror),
    from: node,
  };
}

const find = (node, name) => {
  if (qnameOf(node) === name) return node;
  for (const child of node.children) {
    const hit = find(child, name);
    if (hit) return hit;
  }
  return undefined;
};

test("the sample's chain is read, with every attribute's ABAP kept verbatim", () => {
  const chain = readViewChain(SOURCE);
  assert.equal(chain.ok, true, chain.why);
  assert.equal(chain.assignment, "DATA(view) = ");
  assert.equal(chain.indent, 4);
  assert.deepEqual(chain.usedAfter, []);
  // From the start of the line: nothing but the indent stands in front of the
  // chain, so the rewrite is written in the column it was read in.
  assert.equal(SOURCE[chain.start - 1], "\n");
  assert.equal(SOURCE.slice(chain.start, chain.start + 16), "    DATA(view) =");
  assert.ok(SOURCE.slice(0, chain.end).endsWith("`Greet` )."));

  const view = chain.root.children[0];
  assert.equal(qnameOf(view), "mvc:View");
  const input = find(view, "Input");
  assert.equal(input.attrs[0].raw, "client->_bind( name )");
  const button = find(view, "Button");
  assert.deepEqual(
    button.attrs.map((a) => [a.name, a.key, a.raw]),
    [
      ["press", "v", "client->_event( `GREET` )"],
      ["text", "v", "`Greet`"],
    ],
  );
  assert.equal(button.attrs[1].literal, "Greet");
  const page = find(view, "Page");
  const nav = page.attrs.find((a) => a.name === "showNavButton");
  assert.equal(nav.key, "b");
  assert.equal(nav.raw, "client->check_app_prev_stack( )");
});

test("read, written and read again: the house layout is a fixed point", () => {
  const chain = readViewChain(SOURCE);
  const written = write(chain);
  const once = splice(SOURCE, chain, written);

  // The split shape became one chain - and that chain, read back and written
  // again, is the same text to the byte, over the same range.
  const again = readViewChain(once);
  assert.equal(again.ok, true, again.why);
  assert.equal(once.slice(again.start, again.end), written);
  assert.equal(write(again), written);
  assert.equal(splice(once, again, write(again)), once);

  // Nothing that was ABAP became a string on the way.
  for (const expression of [
    "v = client->_bind( name )",
    "v = client->_bind( greeting )",
    "v = client->_event( `GREET` )",
    "b = client->check_app_prev_stack( )",
    "v = client->_event_nav_app_leave( )",
    "b = abap_true",
  ]) {
    assert.ok(written.includes(expression), expression);
  }
  assert.deepEqual(layoutFindings(once), []);
});

test("a CRLF file gets its chain back in CRLF", () => {
  const crlf = SOURCE.replaceAll("\n", "\r\n");
  const chain = readViewChain(crlf);
  assert.equal(chain.ok, true, chain.why);
  const written = write(chain, undefined, "\r\n");
  assert.ok(!/[^\r]\n/.test(written), "every line break is CRLF");
  assert.equal(readViewChain(splice(crlf, chain, written)).ok, true);
});

test("what is not a single chain is refused with a sentence, not guessed at", () => {
  assert.match(readViewChain("CLASS x IMPLEMENTATION. ENDCLASS.").why, /Nothing here builds a view/);
  const twice = SOURCE.replace(
    "    client->view_display( view->stringify( ) ).",
    "    DATA(other) = z2ui5_cl_ui5_view_builder=>factory( )->ele( `Page` ).\n    client->view_display( view->stringify( ) ).",
  );
  assert.match(readViewChain(twice).why, /more than one view/);
  const looped = SOURCE.replace("    page->ele( n = `SimpleForm`", "    LOOP AT t INTO DATA(r).\n    ENDLOOP.\n    page->ele( n = `SimpleForm`");
  assert.equal(readViewChain(looped).ok, false);
});

test("an untouched edit patches nothing", () => {
  const chain = readViewChain(SOURCE);
  const view = chain.root.children[0];
  const patched = patchChain(SOURCE, mirror(view), view);
  // Made in place, as no edit at all - never a rewrite of what nobody touched.
  assert.ok(patched);
  assert.equal(patched.source, SOURCE);
});

test("a changed value is the only thing in the file that changes", () => {
  const chain = readViewChain(SOURCE);
  const view = chain.root.children[0];
  const built = mirror(view);
  const text = find(built, "Button").attrs.find((a) => a.name === "text");
  Object.assign(text, { raw: abapLiteral("Say hello"), literal: "Say hello", key: "v", boolean: false });

  const patched = patchChain(SOURCE, built, view);
  assert.ok(patched, "a value change is made in place");
  assert.equal(patched.source, SOURCE.replace("v = `Greet`", "v = `Say hello`"));
  // The split shape survived - a regenerated chain would have collapsed it.
  assert.ok(patched.source.includes("DATA(page) = view->ele( `Shell`"));
});

test("an added attribute rewrites that control's block, and the binds beside it stay binds", () => {
  const chain = readViewChain(SOURCE);
  const view = chain.root.children[0];
  const built = mirror(view);
  find(built, "Button").attrs.push({
    name: "icon",
    raw: abapLiteral("sap-icon://email"),
    literal: "sap-icon://email",
    key: "v",
    boolean: false,
    from: undefined,
  });

  const patched = patchChain(SOURCE, built, view);
  assert.ok(patched, "an attribute added is made in place");
  const after = patched.source;
  assert.ok(after.includes("n = `icon`  v = `sap-icon://email`"), "aligned with the block's own column");
  assert.ok(after.includes("v = client->_event( `GREET` )"));
  assert.ok(after.includes("DATA(page) = view->ele( `Shell`"));
  // Everything before the Button's block is untouched, byte for byte.
  const blockAt = SOURCE.indexOf(")->tag( `Button`");
  assert.equal(after.slice(0, blockAt), SOURCE.slice(0, blockAt));
  assert.deepEqual(layoutFindings(after), []);
});

test("the tree pairs with the XML the linter reconstructs - or says where it does not", () => {
  const chain = readViewChain(SOURCE);
  const { docs } = checkAbapSource(SOURCE, { minUi5: "1.71", distribution: "openui5" });
  const [xml] = docs;
  assert.equal(typeof xml, "string");
  assert.equal(alignWithXml(chain.root, xml), undefined);
  // And each attribute now knows what it renders as - a bind as its path.
  assert.equal(find(chain.root, "Input").attrs[0].rendered, "{/NAME}");
  assert.match(alignWithXml(chain.root, xml.replace("<Button", "<Link").replace("</Button", "</Link")), /Link/);
  assert.equal(alignWithXml(chain.root, "<not-xml"), "the reconstructed view is not XML");
});

test("comments are found where a rewrite would drop them, and only there", () => {
  const source = "DATA(x) = `a \" not a comment`. \" a comment\n* a line comment\nDATA(y) = 1.";
  assert.equal(commentIn(source, 0, source.indexOf(".") + 1), false);
  assert.equal(commentIn(source, 0, source.length), true);
  const stripped = withoutComments(source);
  assert.equal(stripped.length, source.length);
  assert.ok(stripped.includes("`a \" not a comment`"));
  assert.ok(!stripped.includes("a comment\n"));
  assert.ok(!stripped.includes("a line comment"));
});

test("the writer refuses what the builder cannot say, and quotes what it can", () => {
  assert.equal(abapLiteral("it`s"), "`it``s`");
  const element = { name: "Text", ns: "", attrs: [{ name: "text", raw: "`x`", boolean: false, key: "v" }], children: [] };
  assert.equal(unwritable(element), undefined);
});
