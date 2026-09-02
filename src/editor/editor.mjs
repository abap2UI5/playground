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
import { registerABAP } from "@abaplint/monaco";
import { applyLinterFixes, fixableAmong, findingsFor, ruleUrl } from "./abap2ui5-lint.mjs";

import { uriFor } from "./files.mjs";
import {
  abaplintFixable,
  applyAbaplintFixes,
  diagnostics,
  getRegistry,
  knownObjectNames,
  updateFiles,
} from "./registry.mjs";

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
// Bumped whenever a model is created or disposed. It is half of the key the
// analysis below is cached under, and it is there for one case a version id
// cannot cover: two different samples under the same file name. A freshly
// created model starts at version 1, so loading sample B over an untouched
// sample A would produce exactly the key sample A had.
let modelGeneration = 0;
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
  modelGeneration += 1;
  const model = monaco.editor.createModel(file.source, "abap", monaco.Uri.parse(uriFor(file.name)));
  let pending;
  model.onDidChangeContent(() => {
    // A keystroke is cheap to react to (a few milliseconds), but reacting to
    // every one of them while somebody types a word is still noise.
    clearTimeout(pending);
    pending = setTimeout(() => {
      refresh();
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
  const files = getFiles();
  // The first file is the app. Removing it would change what Run starts
  // without saying so, which is worse than refusing.
  if (files[0]?.name === name) return;
  const remaining = files.filter((f) => f.name !== name);
  if (remaining.length === 0) return;
  if (currentFile() === name) openFile(remaining[0].name);
  model.dispose();
  modelGeneration += 1;
  if (connected) refresh();
  onChange?.(getFiles());
}

// Replaces everything - what loading a sample or a shared link does.
export function setFiles(files) {
  for (const model of monaco.editor.getModels()) model.dispose();
  modelGeneration += 1;
  for (const file of files) createModel(file);
  editor.setModel(modelFor(files[0].name));
  if (connected) refresh();
  onChange?.(getFiles());
}

// One analysis of everything open, and everybody's answer to it.
//
// Three questions are asked of the same text, from three places, on every
// keystroke: what is wrong with it (the underlines and the Problems list), how
// much of that can be repaired (the Fix them bar), and - through updateInsight
// - what the panel should now show. They used to be three separate walks over
// the file set, and a single debounced change ran the whole analysis three
// times over: once in the editor's own change handler, once in the page's
// remember( ), and once more when the panel rendered its problem list and
// asked fixableNow( ).
//
// So the walk happens once and is kept. The key is what the editor is: the
// generation counter above, plus every open model's uri and version id, which
// Monaco bumps on every edit. Anything that changes the text changes the key;
// anything that does not - a second reader asking the same question - gets the
// answer already computed. What that does NOT cover is a checker whose
// configuration changed under unchanged text, which is why the Config tabs
// call invalidateAnalysis( ) before they ask again.
let analysis = { key: undefined, problems: [], fixable: 0 };

const analysisKey = () =>
  monaco.editor
    .getModels()
    .filter((m) => m.uri.scheme === "file")
    .map((m) => `${m.uri.path}@${m.getVersionId()}`)
    .join("|") + `#${modelGeneration}`;

// Throws the kept answer away. For the one caller whose change is invisible to
// the key: a checker reconfigured while the text stayed exactly as it was.
export function invalidateAnalysis() {
  analysis = { key: undefined, problems: [], fixable: 0 };
}

// Everything wrong with what is open, from both checkers, and the markers to
// match. The two sources are kept apart by their marker owner: Monaco replaces
// all markers of one owner at a time, so a shared owner would have whichever
// checker ran second erase the other's underlines.
function analyse() {
  // Nothing to check against, and nothing to check with. The registry does not
  // exist until the corpus has been parsed, and the editor is typeable for the
  // whole of that - a moment on a fast connection, several seconds on a slow
  // one. Every path that reacts to a change in the editor arrives here, so the
  // guard belongs here rather than at each caller: it was at one of them and
  // not at the other, and the one without it reached straight into a registry
  // that was not there yet. Not cached either - the very next call, once the
  // corpus has landed, has to do the work.
  if (!connected) return { problems: [], fixable: 0 };

  const key = analysisKey();
  if (key === analysis.key) return analysis;

  const files = getFiles();
  updateFiles(files);

  const problems = [];
  // abaplint's own count, over the whole registry, is one call rather than one
  // per file - so it is asked here rather than inside the loop.
  let fixable = abaplintFixable();

  for (const file of files) {
    const model = modelFor(file.name);

    // @abaplint/monaco's updateMarkers( ) written out, because it asked the
    // language server for these diagnostics and then this function asked for
    // them a second time to build the Problems list from. The marker shape is
    // theirs, code and all - what is gone is the duplicate parse and the
    // duplicate analysis.
    const found = diagnostics(file.name);
    monaco.editor.setModelMarkers(
      model,
      ABAPLINT_OWNER,
      found.map((d) => ({
        severity: LSP_SEVERITY[d.severity] ?? monaco.MarkerSeverity.Error,
        message: typeof d.message === "string" ? d.message : d.message.value,
        code: {
          value: typeof d.code === "string" ? d.code : "",
          target: monaco.Uri.parse(d.codeDescription?.href || ""),
        },
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
      })),
    );
    for (const issue of found) {
      problems.push({ file: file.name, source: "abaplint", ...issue });
    }

    // The linter's findings, asked for once and then used three times over:
    // the underlines, the Problems rows, and how many of them carry a fix.
    const findings = findingsFor(file.source);
    fixable += fixableAmong(findings).length;
    monaco.editor.setModelMarkers(
      model,
      LINT_OWNER,
      findings.map((f) => ({
        severity: MONACO_SEVERITY[f.severity] ?? monaco.MarkerSeverity.Warning,
        message: f.message,
        // the same shape abaplint's markers have above: Monaco shows the
        // source and the code behind the message, and the code is a link -
        // here to the rule's card, which is where "what does this mean" is
        source: "abap2UI5",
        code: { value: f.type, target: monaco.Uri.parse(ruleUrl(f)) },
        startLineNumber: f.line,
        startColumn: f.column,
        endLineNumber: f.line,
        // The linter points at where a finding starts; without an end the
        // marker would be a caret nobody can hit with the mouse.
        endColumn: f.column + 1,
      })),
    );
    for (const f of findings) {
      problems.push({
        file: file.name,
        source: "abap2UI5",
        severity: f.severity === "error" ? 1 : f.severity === "warning" ? 2 : 3,
        message: f.message,
        rule: f.type,
        url: ruleUrl(f),
        range: { start: { line: f.line - 1, character: f.column - 1 } },
      });
    }
  }

  analysis = { key, problems, fixable };
  return analysis;
}

// Pushes the editor's state into the registry and the registry's opinion back
// into the gutters. Returns everything wrong with everything open, so the
// caller can decide whether a run is worth attempting.
export function refresh() {
  return analyse().problems;
}

const ABAPLINT_OWNER = "abaplint";

// The language server speaks LSP severities; Monaco has its own numbers. Only
// the two @abaplint/monaco mapped are mapped here, and for the same reason:
// everything else is an error, including a severity it did not recognise.
const LSP_SEVERITY = {
  2: monaco.MarkerSeverity.Warning,
  3: monaco.MarkerSeverity.Info,
};

const LINT_OWNER = "abap2ui5";

const MONACO_SEVERITY = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  hint: monaco.MarkerSeverity.Hint,
};

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

      // Ranked before it is cut: names that start with what was typed beat
      // names that merely contain it, and the cut to 200 has to respect that -
      // an alphabetical cut would happily drop the one class being typed while
      // keeping two hundred incidental substring matches.
      //
      // One pass into two buckets rather than a filter and a sort. This runs on
      // a keystroke over several thousand names, and knownObjectNames( ) hands
      // them back in name order already, so appending to two lists keeps that
      // order within each and costs no comparisons at all. Each name is also
      // lower-cased once here rather than the four times the sort and the map
      // between them used to ask for.
      const leading = [];
      const anywhere = [];
      for (const object of knownObjectNames()) {
        const name = object.name.toLowerCase();
        if (!name.includes(lower)) continue;
        (name.startsWith(lower) ? leading : anywhere).push({ name, type: object.type });
      }

      const suggestions = [...leading, ...anywhere].slice(0, 200).map((o, i) => ({
        label: o.name,
        kind:
          o.type === "INTF"
            ? monaco.languages.CompletionItemKind.Interface
            : monaco.languages.CompletionItemKind.Class,
        detail: o.type === "INTF" ? "interface" : "class",
        insertText: o.name,
        range,
        // The order they are in is the order they belong in, and Monaco sorts
        // by this string rather than by position - so the position is what it
        // is given. Padded, or "10" would sort between "1" and "2".
        sortText: String(i).padStart(4, "0"),
      }));

      return { suggestions };
    },
  };
}

// ---------------------------------------------------------------- autofix

// How many problems either checker could repair on its own, so the button can
// say what it will do - and stay away when it would do nothing.
//
// Answers zero before the registry exists. The panel is built while the corpus
// is still parsing, and asking abaplint anything at that point reaches a
// registry that is not there yet.
export function fixableNow() {
  return analyse().fixable;
}

// Applies both checkers' fixes to everything open.
//
// Written back through pushEditOperations rather than setValue, because an
// automatic rewrite of somebody's source has to be one Ctrl+Z away. One edit
// per file, so undo takes the whole thing back rather than unpicking it fix by
// fix - a half-undone autofix is a state nobody asked for.
//
// abaplint first: its fixes are structural (a missing ENDMETHOD, a statement in
// the wrong place) and the abap2UI5 linter reads the builder chain, which is
// easier to read correctly once the ABAP around it parses.
export function applyFixes() {
  if (!connected) return 0;
  let fixed = 0;

  const afterAbaplint = applyAbaplintFixes(getFiles());
  fixed += afterAbaplint.fixed;
  for (const file of afterAbaplint.files) writeSource(file.name, file.source);

  // Repeated, because one fix can uncover the next - the same reason abaplint
  // loops - and bounded for the same reason.
  for (let pass = 0; pass < 5; pass++) {
    let changed = 0;
    for (const file of getFiles()) {
      const result = applyLinterFixes(file.source);
      if (result.fixed === 0) continue;
      writeSource(file.name, result.source);
      changed += result.fixed;
    }
    if (changed === 0) break;
    fixed += changed;
  }

  refresh();
  return fixed;
}

function writeSource(name, source) {
  const model = modelFor(name);
  if (!model || model.getValue() === source) return;
  model.pushEditOperations(
    null,
    [{ range: model.getFullModelRange(), text: source }],
    () => null,
  );
}
