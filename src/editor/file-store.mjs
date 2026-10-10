// The editor's interface without an editor: the file set an app-only page
// runs on.
//
// ?view=app and ?view=full hide the editor pane (setUpTabs in layout.mjs
// returns before it draws a tab), and still the page created a Monaco editor
// in it - 0.85 MB compressed downloaded, evaluated and instantiated for a
// pane nobody would see. What such a page actually needs from "the editor" is
// the list of files and their text: the registry worker checks them (an
// abaplint error still stops Run), the worker compiles them, Run starts the
// class. This is that list, behind the same functions monaco-editor.mjs
// exports, so main.mjs, the file strip and the panel call the same names on
// both pages and src/editor/editor.mjs decides which answers.
//
// Everything that needs a caret, an undo stack or a theme is a no-op here
// that answers what an empty editor would: the toolbar those buttons live in
// is hidden on the pages this serves, and a page that had them would have
// created the real editor instead.
import * as analysis from "./analysis.mjs";
import { refresh } from "./analysis.mjs";

let files = [];
let versions = new Map();
let generation = 0;
let shown;
let onChange;
let onShown = [];
let connected = false;

const indexOf = (name) => files.findIndex((f) => f.name === name);
const lines = (name) => (files[indexOf(name)]?.source ?? "").split(/\r?\n/);

analysis.useHost({
  files: () => getFiles(),
  key: () => files.map((f) => `${f.name}@${versions.get(f.name)}`).join("|") + `#${generation}`,
  // Nothing to underline in.
  markers: () => {},
  lineCount: (name) => Math.max(1, lines(name).length),
  lineMaxColumn: (name, line) => (lines(name)[line - 1]?.length ?? 0) + 1,
});

const changed = () => {
  if (connected) refresh();
  onChange?.(getFiles());
};

export function createEditor(container, starting, options = {}) {
  onChange = options.onChange;
  files = starting.map((f) => ({ ...f }));
  versions = new Map(files.map((f) => [f.name, 1]));
  shown = files[0]?.name;
  return undefined;
}

export function setEditorTheme() {}
export function setEditorReadOnly() {}

export function connectRegistry() {
  connected = true;
  analysis.connect();
  refresh();
}

export const fileVersion = (name) => versions.get(name);
export const getFiles = () => files.map((f) => ({ name: f.name, source: f.source }));
export const getSource = (name) => files[indexOf(name)]?.source;
export const currentFile = () => shown;

export function openFile(name) {
  if (indexOf(name) === -1 || shown === name) return;
  shown = name;
  for (const fn of onShown) fn();
}

export function onFileShown(fn) {
  onShown.push(fn);
}

function write(name, source) {
  const i = indexOf(name);
  if (i === -1 || files[i].source === source) return;
  files[i] = { name, source };
  versions.set(name, (versions.get(name) ?? 0) + 1);
}

export function setSourceOf(name, source) {
  write(name, source);
  changed();
}

export function addFile(file) {
  if (indexOf(file.name) !== -1) write(file.name, file.source);
  else {
    files.push({ ...file });
    versions.set(file.name, 1);
  }
  generation += 1;
  openFile(file.name);
  changed();
}

export function closeFile(name) {
  const i = indexOf(name);
  // The first file is the app; see monaco-editor.mjs for the rest of the rule.
  if (i <= 0) return;
  const tests = name.endsWith(".clas.abap") ? name.replace(/\.clas\.abap$/, ".clas.testclasses.abap") : undefined;
  const gone = (n) => n === name || n === tests;
  const remaining = files.filter((f) => !gone(f.name));
  if (remaining.length === 0) return;
  files = remaining;
  generation += 1;
  if (gone(shown)) openFile(files[0].name);
  changed();
}

// Replaces everything - what a sample or a link puts in.
export function setFiles(next) {
  const before = new Set(files.map((f) => f.name));
  files = next.map((f) => ({ ...f }));
  for (const f of files) versions.set(f.name, before.has(f.name) ? (versions.get(f.name) ?? 0) + 1 : 1);
  for (const name of before) if (indexOf(name) === -1) versions.delete(name);
  generation += 1;
  const was = shown;
  shown = files[0]?.name;
  if (shown !== was) for (const fn of onShown) fn();
  changed();
}

export function focusProblem() {}
export async function format() {
  return { formatted: 0, files: [] };
}
export function undo() {}
export function redo() {}
export const canUndo = () => false;
export const canRedo = () => false;
export async function applyFixes() {
  return 0;
}
