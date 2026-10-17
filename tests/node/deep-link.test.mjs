// `?src=` deep links (src/shell/deep-link.mjs): where a linked file may come
// from, and what is made of the URL a human pasted. The allow list is the
// security boundary of the feature - the playground fetches on behalf of
// whoever opened the link - so every refusal is checked before a request
// would have been made: `fetch` here fails the test if it is reached for a
// link that should have been refused.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  REPOSITORY_HOSTS,
  fetchLinkedFiles,
  forgetOrigins,
  humanUrl,
  instantiatedClasses,
  originOf,
  rawFor,
} from "../../src/shell/deep-link.mjs";

const PAGE = "https://abap2ui5.github.io/playground/";
globalThis.window = { location: { href: PAGE, origin: new URL(PAGE).origin } };

const CLASS = "CLASS zcl_x DEFINITION PUBLIC.\nENDCLASS.\n";
let requested;

beforeEach((t) => {
  requested = [];
  forgetOrigins();
  t.mock.method(globalThis, "fetch", async (href) => {
    requested.push(String(href));
    return new Response(CLASS, { status: 200 });
  });
});

const params = (...src) => new URLSearchParams(src.map((s) => ["src", s]));

test("raw GitHub, a gist's raw host and this site are followed", async () => {
  const raw = "https://raw.githubusercontent.com/abap2UI5/samples/main/src/zcl_a.clas.abap";
  const gist = "https://gist.githubusercontent.com/someone/abc123/raw/zcl_b.clas.abap";
  const local = "/playground/examples/zcl_linked_example.clas.abap";
  const files = await fetchLinkedFiles(params(raw, gist, local));
  assert.deepEqual(
    files.map((f) => f.name),
    ["zcl_a.clas.abap", "zcl_b.clas.abap", "zcl_linked_example.clas.abap"],
  );
  assert.deepEqual(requested, [raw, gist, new URL(local, PAGE).href]);
  assert.equal(originOf("zcl_a.clas.abap"), raw);
});

test("the GitHub page a human copies is read from the raw host", async () => {
  await fetchLinkedFiles(params("https://github.com/abap2UI5/samples/blob/main/src/zcl_a.clas.abap"));
  assert.deepEqual(requested, ["https://raw.githubusercontent.com/abap2UI5/samples/main/src/zcl_a.clas.abap"]);
});

test("anything else is refused before a request is made", async () => {
  const refused = [
    ["https://evil.example/zcl_a.clas.abap", /only opens ABAP from raw.githubusercontent.com or gist.githubusercontent.com/],
    ["http://raw.githubusercontent.com/o/r/main/zcl_a.clas.abap", /points at raw.githubusercontent.com/],
    ["https://raw.githubusercontent.com.evil.example/o/r/main/zcl_a.clas.abap", /only opens ABAP/],
    ["https://user:pw@raw.githubusercontent.com/o/r/main/zcl_a.clas.abap", /no user name or password/],
    ["javascript:alert(1)", /only opens ABAP/],
    ["https://raw.githubusercontent.com/o/r/main/readme.md", /not an ABAP object file/],
  ];
  for (const [link, why] of refused) {
    await assert.rejects(fetchLinkedFiles(params(link)), why, link);
  }
  // One bad link refuses the whole set - the good one was not fetched first.
  await assert.rejects(
    fetchLinkedFiles(params("https://raw.githubusercontent.com/o/r/main/zcl_a.clas.abap", "https://evil.example/zcl_b.clas.abap")),
    /only opens ABAP/,
  );
  // Two files of one name.
  await assert.rejects(
    fetchLinkedFiles(params("https://raw.githubusercontent.com/o/r/main/zcl_a.clas.abap", "https://raw.githubusercontent.com/p/q/main/ZCL_A.CLAS.ABAP")),
    /both called zcl_a.clas.abap/,
  );
  assert.deepEqual(requested, []);
});

test("the Pilot's narrower list takes no gist", async () => {
  assert.deepEqual(REPOSITORY_HOSTS, ["raw.githubusercontent.com"]);
  await assert.rejects(
    fetchLinkedFiles(params("https://gist.githubusercontent.com/someone/abc/raw/zcl_b.clas.abap"), { hosts: REPOSITORY_HOSTS }),
    /only opens ABAP from raw.githubusercontent.com,/,
  );
  assert.deepEqual(requested, []);
});

test("a host that answers with an error status is reported with it", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("nope", { status: 404 }));
  await assert.rejects(fetchLinkedFiles(params("https://raw.githubusercontent.com/o/r/main/zcl_a.clas.abap")), /answered 404/);
});

test("raw and human URLs translate both ways", () => {
  assert.equal(
    rawFor(new URL("https://github.com/o/r/raw/main/src/a.clas.abap")).href,
    "https://raw.githubusercontent.com/o/r/main/src/a.clas.abap",
  );
  const other = new URL("https://github.com/o/r");
  assert.equal(rawFor(other), other);
  assert.equal(humanUrl("https://raw.githubusercontent.com/o/r/main/src/a.clas.abap"), "https://github.com/o/r/blob/main/src/a.clas.abap");
  assert.equal(humanUrl("https://gist.githubusercontent.com/someone/abc/raw/a.clas.abap"), "https://gist.github.com/someone/abc");
  assert.equal(humanUrl("not a url"), "not a url");
});

test("the classes a source needs from beside it - not the framework's, not a comment's", () => {
  const source = [
    "* header: this app calls zcl_from_comment",
    "    client->nav_app_call( NEW zcl_detail( ) ). \" and zcl_trailing( )",
    "    DATA(x) = zcl_util=>do( ).",
    "    DATA r TYPE REF TO zcl_typed.",
    "    DATA d TYPE REF TO data.",
    "    CREATE OBJECT o TYPE zcl_created.",
    "    z2ui5_cl_util=>x( ). cl_abap_typedescr=>describe( ). NEW lcl_local( ).",
  ].join("\n");
  assert.deepEqual(instantiatedClasses(source).sort(), ["zcl_created", "zcl_detail", "zcl_typed", "zcl_util"]);
});
