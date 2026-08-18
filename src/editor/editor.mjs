// Monaco, wired to abaplint.
//
// Monaco is the editor out of VS Code, and @abaplint/monaco is the same language
// integration the abaplint playground uses: hover, go to definition, rename,
// references, document symbols, quick fixes, semantic highlighting and the
// pretty printer, all answered from the registry in src/editor/registry.mjs.
//
// Two things it does not bring, and this module adds: syntax highlighting, which
// comes from Monaco's own ABAP grammar, and completion of object names, which
// abaplint has no API for - see abapNameCompletion below.
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/abap/register.js";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/format/browser/formatActions.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js";
import "monaco-editor/editor/contrib/rename/browser/rename.js";
import "monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js";
import "monaco-editor/editor/contrib/comment/browser/comment.js";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js";
import { registerABAP, updateMarkers } from "@abaplint/monaco";

import { uriFor } from "./files.mjs";
import { diagnostics, getRegistry, knownObjectNames, updateFiles } from "./registry.mjs";

// @abaplint/monaco reaches for a global `monaco`, the way a script tag would
// have provided it. It is a library written for a page that loads Monaco from a
// CDN; here it is bundled, so the global has to be put there.
globalThis.monaco = monaco;

// Monaco's own workers do word-based suggestions and diff computation. Neither
// is worth a second bundle here - abaplint answers everything the ABAP editor
// offers - so the editor is told there is no worker rather than being left to
// discover it through an exception.
globalThis.MonacoEnvironment = {
  getWorker() {
    return {
      postMessage() {},
      addEventListener() {},
      removeEventListener() {},
      terminate() {},
    };
  },
};

const THEME_DARK = "abap-dark";
const THEME_LIGHT = "abap-light";

let editor;
let onChange;
// Until the corpus has been parsed there is nothing to check against, so the
// editor edits and highlights but says nothing about the code.
let connected = false;

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

const modelFor = (name) => monaco.editor.getModel(monaco.Uri.parse(uriFor(name)));

export function createEditor(container, files, options = {}) {
  onChange = options.onChange;

  monaco.editor.defineTheme(THEME_LIGHT, { base: "vs", inherit: true, rules: [], colors: {} });
  monaco.editor.defineTheme(THEME_DARK, { base: "vs-dark", inherit: true, rules: [], colors: {} });

  for (const file of files) createModel(file);

  editor = monaco.editor.create(container, {
    model: modelFor(files[0].name),
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 13,
    tabSize: 2,
    renderWhitespace: "selection",
    theme: prefersDark() ? THEME_DARK : THEME_LIGHT,
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    monaco.editor.setTheme(e.matches ? THEME_DARK : THEME_LIGHT);
  });

  return editor;
}

function createModel(file) {
  const model = monaco.editor.createModel(file.source, "abap", monaco.Uri.parse(uriFor(file.name)));
  let pending;
  model.onDidChangeContent(() => {
    // A keystroke is cheap to react to (a few milliseconds), but reacting to
    // every one of them while somebody types a word is still noise.
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (connected) refresh();
      onChange?.(getFiles());
    }, 150);
  });
  return model;
}

export function connectRegistry() {
  registerABAP(getRegistry());
  monaco.languages.registerCompletionItemProvider("abap", abapNameCompletion());
  connected = true;
  refresh();
}

// Everything currently open, in the order it was opened.
export function getFiles() {
  return monaco.editor
    .getModels()
    .filter((m) => m.uri.scheme === "file")
    .map((m) => ({ name: m.uri.path.replace(/^\//, ""), source: m.getValue() }));
}

export const getSource = (name) => modelFor(name)?.getValue();

export function openFile(name) {
  const model = modelFor(name);
  if (model) editor.setModel(model);
}

export const currentFile = () => editor.getModel().uri.path.replace(/^\//, "");

export function addFile(file) {
  createModel(file);
  openFile(file.name);
  if (connected) refresh();
  onChange?.(getFiles());
}

export function closeFile(name) {
  const model = modelFor(name);
  if (!model) return;
  const remaining = getFiles().filter((f) => f.name !== name);
  if (remaining.length === 0) return;
  if (currentFile() === name) openFile(remaining[0].name);
  model.dispose();
  if (connected) refresh();
  onChange?.(getFiles());
}

// Replaces everything - what loading a sample or a shared link does.
export function setFiles(files) {
  for (const model of monaco.editor.getModels()) model.dispose();
  for (const file of files) createModel(file);
  editor.setModel(modelFor(files[0].name));
  if (connected) refresh();
  onChange?.(getFiles());
}

// Pushes the editor's state into the registry and the registry's opinion back
// into the gutters. Returns everything wrong with everything open, so the caller
// can decide whether a run is worth attempting.
export function refresh() {
  const files = getFiles();
  updateFiles(files);

  const problems = [];
  for (const file of files) {
    updateMarkers(getRegistry(), modelFor(file.name));
    for (const issue of diagnostics(file.name)) problems.push({ file: file.name, ...issue });
  }
  return problems;
}

export function focusProblem(file, line, column = 1) {
  openFile(file);
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column });
  editor.focus();
}

// abaplint's pretty printer, through the editor's own format action so the
// change lands in the undo stack like any other edit.
export async function format() {
  await editor.getAction("editor.action.formatDocument")?.run();
  editor.focus();
}

// Completion over the names of the classes and interfaces the registry knows -
// the framework's and the user's own.
//
// abaplint has no completion API at all - @abaplint/monaco's completion provider
// offers a handful of fixed snippets and nothing else - so this is the
// playground's own, and it is deliberately modest: it completes object names,
// not members. Knowing that z2ui5_cl_ui5_view_builder exists is most of what
// somebody new to abap2UI5 is missing; what its methods are called is what hover
// and go-to-definition are for.
function abapNameCompletion() {
  return {
    provideCompletionItems(model, position) {
      const line = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const prefix = /([a-zA-Z_][\w_]*)$/.exec(line)?.[1];
      if (!prefix || prefix.length < 3) return { suggestions: [] };

      const lower = prefix.toLowerCase();
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column - prefix.length,
        endColumn: position.column,
      };

      const suggestions = knownObjectNames()
        .filter((o) => o.name.toLowerCase().includes(lower))
        .slice(0, 200)
        .map((o) => ({
          label: o.name.toLowerCase(),
          kind:
            o.type === "INTF"
              ? monaco.languages.CompletionItemKind.Interface
              : monaco.languages.CompletionItemKind.Class,
          detail: o.type === "INTF" ? "interface" : "class",
          insertText: o.name.toLowerCase(),
          range,
          // Names that start with what was typed belong above names that merely
          // contain it.
          sortText: (o.name.toLowerCase().startsWith(lower) ? "0" : "1") + o.name,
        }));

      return { suggestions };
    },
  };
}
