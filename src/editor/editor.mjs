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

import { USER_FILE, diagnostics, getRegistry, knownObjectNames, updateSource } from "./registry.mjs";

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

export function createEditor(container, source, options = {}) {
  onChange = options.onChange;

  monaco.editor.defineTheme(THEME_LIGHT, { base: "vs", inherit: true, rules: [], colors: {} });
  monaco.editor.defineTheme(THEME_DARK, { base: "vs-dark", inherit: true, rules: [], colors: {} });

  const model = monaco.editor.createModel(source, "abap", monaco.Uri.parse(USER_FILE));

  editor = monaco.editor.create(container, {
    model,
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

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

// Called once the registry has finished its first parse. Until then the editor
// highlights and edits but says nothing about the code, which is the honest
// state - there is nothing to say it from.
export function connectRegistry() {
  const reg = getRegistry();
  registerABAP(reg);
  monaco.languages.registerCompletionItemProvider("abap", abapNameCompletion());

  const model = editor.getModel();
  let pending;
  model.onDidChangeContent(() => {
    // A keystroke is cheap to react to (a few milliseconds), but reacting to
    // every one of them while somebody types a word is still noise.
    clearTimeout(pending);
    pending = setTimeout(() => {
      refresh();
      onChange?.(model.getValue());
    }, 150);
  });

  refresh();
}

export function refresh() {
  const model = editor.getModel();
  updateSource(model.getValue());
  updateMarkers(getRegistry(), model);
  return diagnostics();
}

export function getSource() {
  return editor.getModel().getValue();
}

export function setSource(source) {
  editor.getModel().setValue(source);
}

export function focusLine(line, column = 1) {
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column });
  editor.focus();
}

// Completion over the names of the classes and interfaces the corpus defines.
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
          kind: o.type === "INTF" ? monaco.languages.CompletionItemKind.Interface : monaco.languages.CompletionItemKind.Class,
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
