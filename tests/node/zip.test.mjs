// The abapGit zip (src/shell/zip.mjs): stored entries, written by hand. The
// archive is read back here the way an unzipper reads it - from the end of
// central directory record, through the central directory, to each local
// header - so a field written at the wrong offset fails by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { zipStored } from "../../src/shell/zip.mjs";

const decoder = new TextDecoder();

// Every entry as an unzipper finds it, plus the counts the end record claims.
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endAt = bytes.length - 22;
  assert.equal(view.getUint32(endAt, true), 0x06054b50, "end of central directory");
  const count = view.getUint16(endAt + 10, true);
  assert.equal(view.getUint16(endAt + 8, true), count);
  const size = view.getUint32(endAt + 12, true);
  const directoryAt = view.getUint32(endAt + 16, true);
  assert.equal(directoryAt + size, endAt, "the directory ends where the end record starts");

  const entries = [];
  let at = directoryAt;
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, "central directory header");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const length = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength;

    assert.equal(view.getUint32(localAt, true), 0x04034b50, "local file header");
    assert.equal(view.getUint32(localAt + 14, true), crc, "local and central CRC agree");
    assert.equal(view.getUint32(localAt + 18, true), compressed);
    const localName = view.getUint16(localAt + 26, true);
    const extra = view.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + localName + extra;
    entries.push({ name, flags, method, crc, compressed, length, data: bytes.subarray(dataAt, dataAt + length) });
  }
  assert.equal(at, endAt);
  return entries;
}

test("CRC-32 of known strings is the one every zip tool computes", () => {
  // The check value of the CRC-32 the format specifies, and two more.
  const known = [
    ["123456789", 0xcbf43926],
    ["The quick brown fox jumps over the lazy dog", 0x414fa339],
    ["", 0],
  ];
  const zip = readZip(zipStored(known.map(([data], i) => ({ name: `${i}.txt`, data }))));
  assert.deepEqual(
    zip.map((e) => e.crc),
    known.map(([, crc]) => crc),
  );
});

test("CRC-32 matches zlib's over binary data", () => {
  const data = Uint8Array.from({ length: 70000 }, (_, i) => (i * 7919) & 0xff);
  const [entry] = readZip(zipStored([{ name: "blob.bin", data }]));
  assert.equal(entry.crc, crc32(data));
  assert.deepEqual(entry.data, data);
});

test("the archive lays out every entry stored, named in UTF-8, in order", () => {
  const entries = [
    { name: "src/z2ui5_cl_app.clas.abap", data: "CLASS z2ui5_cl_app DEFINITION.\nENDCLASS.\n" },
    { name: "src/z2ui5_cl_app.clas.xml", data: '<?xml version="1.0" encoding="utf-8"?>\n<abapGit/>\n' },
    { name: "src/päckchen.txt", data: "ü" },
    { name: ".abapgit.xml", data: new Uint8Array([1, 2, 3]) },
  ];
  const zip = readZip(zipStored(entries));
  assert.deepEqual(
    zip.map((e) => e.name),
    entries.map((e) => e.name),
  );
  for (const [i, e] of zip.entries()) {
    assert.equal(e.method, 0, "stored");
    assert.equal(e.flags & 0x0800, 0x0800, "UTF-8 names");
    assert.equal(e.compressed, e.length);
    const want = typeof entries[i].data === "string" ? new TextEncoder().encode(entries[i].data) : entries[i].data;
    assert.deepEqual(e.data, want);
  }
});

test("the timestamp is the moment given, in DOS format", () => {
  const bytes = zipStored([{ name: "a", data: "x" }], new Date(2026, 9, 17, 13, 45, 30));
  const view = new DataView(bytes.buffer);
  const time = view.getUint16(10, true);
  const day = view.getUint16(12, true);
  assert.deepEqual([time >> 11, (time >> 5) & 0x3f, (time & 0x1f) * 2], [13, 45, 30]);
  assert.deepEqual([(day >> 9) + 1980, (day >> 5) & 0xf, day & 0x1f], [2026, 10, 17]);
});

test("an empty archive is just the end record", () => {
  const bytes = zipStored([]);
  assert.equal(bytes.length, 22);
  assert.deepEqual(readZip(bytes), []);
});
