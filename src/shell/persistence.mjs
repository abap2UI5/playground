// What the playground keeps of the editor between visits: the files that
// were open, and which of them was on screen.
//
// The draft - every open file - is written by remember( ) in main.mjs on the
// editor's own debounce (150 ms of quiet after a change, in
// src/editor/monaco-editor.mjs), so a reload a moment after the last
// keystroke still finds it. It is what the playground comes back on after a
// reload, under the one key tests/shell.spec.js and the studio's spec read
// by name. A link outranks it (startingFiles( ) in main.mjs) - a share
// link's fragment, a ?src= or a ?gist= - so the stored work is never opened
// over something somebody was sent, and it stays stored for the next plain
// visit. Beside it, the file that was shown, so a reload lands on the test
// include that was being written rather than on the class.
//
// Every read and write goes through storage.mjs: a private window, a
// blocked third-party storage or a full quota throws on access, and none of
// this is worth a broken page. A stored value that will not parse, or whose
// shape is not a file set, reads as nothing stored.
import { readStored, readStoredJson, removeStored, writeStored, writeStoredJson } from "./storage.mjs";

export const DRAFT_KEY = "abap2ui5-playground:files";
export const OPEN_FILE_KEY = "abap2ui5-playground:open-file";

/** Whether `files` is a file set: a non-empty list of { name, source } with
 *  a name and strings in both. No size limit of its own - a set the quota
 *  cannot hold is refused by the write, and the draft before it stays. */
export function isFileSet(files) {
  return Array.isArray(files) && files.length > 0 &&
    files.every((f) => typeof f?.name === "string" && f.name !== "" && typeof f?.source === "string");
}

/** The stored draft - [{ name, source }] - or undefined. */
export function readDraft() {
  const stored = readStoredJson(DRAFT_KEY);
  if (!isFileSet(stored)) return undefined;
  return stored.map(({ name, source }) => ({ name, source }));
}

/** Keeps the files; answers whether they were kept. */
export function writeDraft(files) {
  if (!isFileSet(files)) return false;
  return writeStoredJson(DRAFT_KEY, files.map(({ name, source }) => ({ name, source })));
}

/** The file that was on screen, if it is one of `files`. */
export function readOpenFile(files) {
  const name = readStored(OPEN_FILE_KEY);
  if (typeof name !== "string" || name === "") return undefined;
  return files.some((f) => f.name === name) ? name : undefined;
}

/** Keeps which file is on screen; the first file, where every load starts
 *  anyway, is forgotten rather than stored. */
export const writeOpenFile = (name, files) =>
  name && files?.[0]?.name !== name ? writeStored(OPEN_FILE_KEY, name) : removeStored(OPEN_FILE_KEY);

/** The draft with the file to show first: { files, openFile } or undefined. */
export function readSession() {
  const files = readDraft();
  if (!files) return undefined;
  return { files, openFile: readOpenFile(files) };
}
