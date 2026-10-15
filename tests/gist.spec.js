import { test, expect } from "@playwright/test";
import { createGist, fetchGist, filesFromGist, gistIdFrom, gistPayload, playgroundUrlFor } from "../src/shell/gist.mjs";

// The open files as a GitHub gist and back (src/shell/gist.mjs): the id read
// out of whatever was pasted, the payload POST /gists takes, and a gist's
// files with the app first - the playground starts the class in the first
// file, and GitHub hands the files out in alphabetical order. The browser
// half (?gist= at startup, the Share dialog) is held by tests/shell.spec.js.

const ID = "aa5a315d61ae9438b18d";
const LONG_ID = "0123456789abcdef0123456789abcdef";

test("the gist id is read out of a bare id, a gist page, an API URL and a raw URL - and nothing else", () => {
  expect(gistIdFrom(ID)).toBe(ID);
  expect(gistIdFrom(`  ${LONG_ID}\n`)).toBe(LONG_ID);
  expect(gistIdFrom(`https://gist.github.com/someone/${ID}`)).toBe(ID);
  expect(gistIdFrom(`https://gist.github.com/${ID}`)).toBe(ID);
  expect(gistIdFrom(`https://gist.github.com/someone/${ID}#file-zcl_app-clas-abap`)).toBe(ID);
  expect(gistIdFrom(`https://api.github.com/gists/${ID}`)).toBe(ID);
  expect(gistIdFrom(`https://gist.githubusercontent.com/someone/${ID}/raw/abc/zcl_app.clas.abap`)).toBe(ID);
  for (const bad of ["", undefined, "not-an-id", "xyz123", `https://github.com/someone/${ID}`, `https://example.com/gists/${ID}`, "javascript:alert(1)", "../etc/passwd"]) {
    expect(gistIdFrom(bad), String(bad)).toBeUndefined();
  }
});

test("the playground link opens the gist and carries nothing else of the page it was made on", () => {
  expect(playgroundUrlFor(ID, "https://abap2ui5.github.io/playground/?embed=1&src=x#code")).toBe(
    `https://abap2ui5.github.io/playground/?gist=${ID}`,
  );
});

const FILES = [
  { name: "zcl_app.clas.abap", source: "CLASS zcl_app DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES z2ui5_if_app.\nENDCLASS." },
  { name: "zcl_app.clas.testclasses.abap", source: "" },
  { name: "notes.txt", source: "not ABAP" },
];

test("the payload is the ABAP files by name, secret, described after the app", () => {
  const payload = gistPayload(FILES);
  expect(payload.public).toBe(false);
  expect(payload.description).toBe("abap2UI5 playground - ZCL_APP");
  expect(Object.keys(payload.files)).toEqual(["zcl_app.clas.abap", "zcl_app.clas.testclasses.abap"]);
  // GitHub refuses an empty file.
  expect(payload.files["zcl_app.clas.testclasses.abap"].content).toBe("\n");
  expect(gistPayload(FILES, { isPublic: true, description: "Mine" })).toMatchObject({ public: true, description: "Mine" });
  expect(() => gistPayload([{ name: "notes.txt", source: "x" }])).toThrow(/no ABAP file/);
});

test("a gist's files come back with the app first, whatever order GitHub lists them in", () => {
  const app = "CLASS zcl_z_app DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES z2ui5_if_app.\nENDCLASS.";
  const files = filesFromGist({
    files: {
      "README.md": { filename: "README.md", content: "# x" },
      "zcl_a_helper.clas.abap": { filename: "zcl_a_helper.clas.abap", content: "CLASS zcl_a_helper DEFINITION PUBLIC." },
      "ZCL_Z_APP.clas.abap": { filename: "ZCL_Z_APP.clas.abap", content: app },
      "zif_b.intf.abap": { filename: "zif_b.intf.abap", content: "INTERFACE zif_b PUBLIC." },
    },
  });
  expect(files.map((f) => f.name)).toEqual(["zcl_z_app.clas.abap", "zcl_a_helper.clas.abap", "zif_b.intf.abap"]);
  expect(files[0].source).toBe(app);
  // Without an app, the first class leads.
  expect(filesFromGist({ files: { "zif_b.intf.abap": { filename: "zif_b.intf.abap", content: "" }, "zcl_c.clas.abap": { filename: "zcl_c.clas.abap", content: "" } } })
    .map((f) => f.name)).toEqual(["zcl_c.clas.abap", "zif_b.intf.abap"]);
  expect(() => filesFromGist({ files: { "a.md": { filename: "a.md", content: "" } } })).toThrow(/no ABAP object file/);
  expect(() => filesFromGist({ files: { "zif_b.intf.abap": { filename: "zif_b.intf.abap", content: "" } } })).toThrow(/no class to start/);
  expect(() => filesFromGist({ files: { "zcl_c.clas.abap": { filename: "zcl_c.clas.abap", truncated: true, content: "" } } })).toThrow(/larger than/);
});

test("reading needs no token, writing sends the reader's as a bearer and says GitHub's refusal", async () => {
  const asked = [];
  const answer = (status, body) => async (url, init = {}) => {
    asked.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const read = await fetchGist(ID, { fetch: answer(200, { files: { "zcl_c.clas.abap": { filename: "zcl_c.clas.abap", content: "CLASS zcl_c." } } }) });
  expect(read).toEqual([{ name: "zcl_c.clas.abap", source: "CLASS zcl_c." }]);
  expect(asked[0].url).toBe(`https://api.github.com/gists/${ID}`);
  expect(asked[0].init.headers.authorization).toBeUndefined();
  await expect(fetchGist("../x", { fetch: answer(200, {}) })).rejects.toThrow(/not a gist id/);
  await expect(fetchGist(ID, { fetch: answer(404, { message: "Not Found" }) })).rejects.toThrow(/no such gist/);

  const made = await createGist(FILES, { token: " ghp_x ", fetch: answer(201, { id: ID, html_url: `https://gist.github.com/${ID}` }) });
  expect(made.id).toBe(ID);
  expect(made.url).toBe(`https://gist.github.com/${ID}`);
  const post = asked.at(-1);
  expect(post.url).toBe("https://api.github.com/gists");
  expect(post.init.method).toBe("POST");
  expect(post.init.headers.authorization).toBe("Bearer ghp_x");
  expect(JSON.parse(post.init.body).files["zcl_app.clas.abap"]).toBeDefined();
  await expect(createGist(FILES, { token: "" })).rejects.toThrow(/token is needed/);
  await expect(createGist(FILES, { token: "bad", fetch: answer(401, { message: "Bad credentials" }) })).rejects.toThrow(/did not accept the token: Bad credentials/);
});
