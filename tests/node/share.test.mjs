// Share links (src/shell/share.mjs): the code in the fragment, deflated and
// base64url'd behind a version character. What tests/link.spec.js checks
// through the page - a link opens on the code it was made from - held here on
// the encoding alone, including the two links it must refuse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { decodeFiles, encodeFiles } from "../../src/shell/share.mjs";

const FILES = [
  { name: "z2ui5_cl_app.clas.abap", source: "CLASS z2ui5_cl_app DEFINITION PUBLIC.\n  \" ünïcödé, `backticks`, |templates { 1 }|\nENDCLASS.\n" },
  { name: "z2ui5_cl_app.clas.testclasses.abap", source: "CLASS ltcl DEFINITION FOR TESTING.\nENDCLASS.\r\n" },
  { name: "zif_x.intf.abap", source: "" },
];

const base64url = (bytes) => Buffer.from(bytes).toString("base64url");

test("files survive the trip through a link, byte for byte", async () => {
  const fragment = await encodeFiles(FILES);
  assert.equal(fragment[0], "2");
  // URL-safe as it stands: nothing a fragment would have to escape.
  assert.match(fragment, /^[0-9A-Za-z_-]+$/);
  assert.deepEqual(await decodeFiles(fragment, "unused"), FILES);
});

test("only name and source travel", async () => {
  const fragment = await encodeFiles([{ name: "a.clas.abap", source: "x", dirty: true, version: 7 }]);
  assert.deepEqual(await decodeFiles(fragment, "unused"), [{ name: "a.clas.abap", source: "x" }]);
});

test("a link several classes long stays well under its source's length", async () => {
  const source = FILES[0].source.repeat(400);
  const fragment = await encodeFiles([{ name: "a.clas.abap", source }]);
  assert.ok(fragment.length < source.length / 10, `${fragment.length} for ${source.length}`);
  assert.equal((await decodeFiles(fragment, "unused"))[0].source, source);
});

test("a version 1 link - one ABAP source - still opens, as the main file", async () => {
  const fragment = "1" + base64url(deflateRawSync(Buffer.from("CLASS old DEFINITION.\nENDCLASS.")));
  assert.deepEqual(await decodeFiles(fragment, "main.clas.abap"), [
    { name: "main.clas.abap", source: "CLASS old DEFINITION.\nENDCLASS." },
  ]);
});

test("a fragment this playground did not write is refused", async () => {
  await assert.rejects(decodeFiles("", "m"), /not written by this playground/);
  await assert.rejects(decodeFiles("3abc", "m"), /not written by this playground/);
  const notFiles = "2" + base64url(deflateRawSync(Buffer.from(JSON.stringify({ name: "x" }))));
  await assert.rejects(decodeFiles(notFiles, "m"), /does not carry any ABAP/);
  const empty = "2" + base64url(deflateRawSync(Buffer.from("[]")));
  await assert.rejects(decodeFiles(empty, "m"), /does not carry any ABAP/);
});

test("a link that inflates past the cap is given up on, not unpacked", async () => {
  // Nine megabytes of one character deflate to a few kilobytes.
  const bomb = "2" + base64url(deflateRawSync(Buffer.alloc(9 * 1024 * 1024, 0x61)));
  assert.ok(bomb.length < 64 * 1024);
  await assert.rejects(decodeFiles(bomb, "m"), /more code than the playground opens/);
});
