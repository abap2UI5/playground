import { test, expect } from "@playwright/test";
import {
  DRAFT_KEY,
  isFileSet,
  OPEN_FILE_KEY,
  readDraft,
  readOpenFile,
  readSession,
  writeDraft,
  writeOpenFile,
} from "../src/shell/persistence.mjs";

// What the playground keeps of the editor between visits
// (src/shell/persistence.mjs), read and written here against a stand-in for
// localStorage - and against one that throws, which is the embedded
// playground's ordinary case (storage.mjs). The browser half - the debounce,
// a reload, a link outranking the draft - is held by tests/shell.spec.js.

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const throwing = {
  getItem() { throw new DOMException("blocked", "SecurityError"); },
  setItem() { throw new DOMException("full", "QuotaExceededError"); },
  removeItem() { throw new DOMException("blocked", "SecurityError"); },
};

let storage;
test.beforeEach(() => {
  storage = memoryStorage();
  globalThis.localStorage = storage;
});
test.afterEach(() => {
  delete globalThis.localStorage;
});

const FILES = [
  { name: "zcl_app.clas.abap", source: "CLASS zcl_app DEFINITION." },
  { name: "zcl_app.clas.testclasses.abap", source: "CLASS ltcl DEFINITION." },
];

test("the draft is written and read back as files, and nothing else rides along", () => {
  expect(readDraft()).toBeUndefined();
  expect(writeDraft(FILES.map((f) => ({ ...f, extra: 1 })))).toBe(true);
  expect(JSON.parse(storage.map.get(DRAFT_KEY))).toEqual(FILES);
  expect(readDraft()).toEqual(FILES);
});

test("what is not a file set is neither written nor read", () => {
  for (const bad of [undefined, null, [], {}, "x", [{ name: "", source: "" }], [{ name: "a" }], [{ name: 1, source: "" }]]) {
    expect(isFileSet(bad), JSON.stringify(bad)).toBe(false);
    expect(writeDraft(bad)).toBe(false);
  }
  expect(storage.map.has(DRAFT_KEY)).toBe(false);
  // A stored value that will not parse, or has the wrong shape, is no draft.
  storage.map.set(DRAFT_KEY, "{not json");
  expect(readDraft()).toBeUndefined();
  storage.map.set(DRAFT_KEY, JSON.stringify({ name: "a", source: "b" }));
  expect(readDraft()).toBeUndefined();
  // A refused write leaves the draft before it where it was.
  writeDraft(FILES);
  writeDraft([]);
  expect(readDraft()).toEqual(FILES);
});

test("the file on screen comes back with its draft, only when it is one of the files", () => {
  writeDraft(FILES);
  writeOpenFile(FILES[1].name, FILES);
  expect(storage.map.get(OPEN_FILE_KEY)).toBe(FILES[1].name);
  expect(readSession()).toEqual({ files: FILES, openFile: FILES[1].name });
  // The first file is where every load starts: not stored.
  writeOpenFile(FILES[0].name, FILES);
  expect(storage.map.has(OPEN_FILE_KEY)).toBe(false);
  expect(readSession()).toEqual({ files: FILES, openFile: undefined });
  // A name the draft does not hold is forgotten on the way in.
  storage.map.set(OPEN_FILE_KEY, "zcl_gone.clas.abap");
  expect(readOpenFile(FILES)).toBeUndefined();
  storage.map.clear();
  expect(readSession()).toBeUndefined();
});

test("a storage that throws on every access is no draft, and no broken page", () => {
  globalThis.localStorage = throwing;
  expect(readDraft()).toBeUndefined();
  expect(readSession()).toBeUndefined();
  expect(writeDraft(FILES)).toBe(false);
  expect(writeOpenFile(FILES[1].name, FILES)).toBe(false);
  expect(readOpenFile(FILES)).toBeUndefined();
});
