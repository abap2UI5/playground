import { test, expect } from "@playwright/test";
import { createHash as nodeHash } from "node:crypto";
import { createHash, createHmac } from "../src/runtime/node-crypto-shim.mjs";

// The browser's `crypto` as the transpiled runtime sees it
// (src/runtime/node-crypto-shim.mjs): Node's createHash( ), computed in
// JavaScript because WebCrypto's digest is asynchronous. abap2UI5 1.147.0
// hashes the model the browser holds on every roundtrip through
// cl_abap_message_digest, whose kernel line is
// `createHash(node).update(data, "hex").digest("hex")` - a shim that threw
// there killed every app of the playground ("Network error:
// crypto.createHash is not available", the pin bump of 2026-10-14). What has
// to stay true: the bytes are Node's, for every input length around the
// block boundary, every way the data arrives, and the one algorithm asked for.

const lengths = [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000];

test("sha256 is byte for byte what node:crypto computes, hex in and hex out", () => {
  for (const n of lengths) {
    const hex = Buffer.from("x".repeat(n) + "✓", "utf8").toString("hex");
    expect(
      createHash("sha256").update(hex, "hex").digest("hex"),
      `${n} bytes`,
    ).toBe(nodeHash("sha256").update(hex, "hex").digest("hex"));
  }
});

test("utf-8 strings, byte arrays, chained updates, base64 and raw digests", () => {
  const text = '{"NAME":"Wörld ✓","ROWS":[1,2,3]}';
  expect(createHash("sha256").update(text).digest("base64")).toBe(
    nodeHash("sha256").update(text, "utf8").digest("base64"),
  );
  expect(createHash("SHA-256").update("ab").update("cd").digest("hex")).toBe(
    nodeHash("sha256").update("abcd").digest("hex"),
  );
  const bytes = Buffer.from(
    Array.from({ length: 777 }, (_, i) => (i * 7919) % 256),
  );
  expect(
    Buffer.from(createHash("sha256").update(bytes).digest()).equals(
      nodeHash("sha256").update(bytes).digest(),
    ),
  ).toBe(true);
});

test("another algorithm, and an HMAC, say what the playground cannot do instead of pretending", () => {
  expect(() => createHash("md5")).toThrow(
    /md5.*not available in the playground/,
  );
  expect(() => createHmac("sha256", "key")).toThrow(
    /createHmac is not available/,
  );
  expect(() => createHash("sha256").update("zz", "hex")).toThrow(
    /not a hex string/,
  );
});
