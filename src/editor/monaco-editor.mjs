// Monaco, wired to abaplint - the half of the editor that IS Monaco.
//
// Imported dynamically, by src/editor/editor.mjs, and only when an editor is
// going to be shown: on an app-only page (?view=app, ?view=full) the pane
// this draws in is hidden, and the 0.85 MB of Monaco used to be downloaded,
// evaluated and instantiated for nobody. The analysis is in analysis.mjs,
// which knows nothing of Monaco and reads this module through a host; the
// file set an app-only page runs on is file-store.mjs, behind the same
// interface. Nothing outside src/editor imports this file.
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
// Ctrl+M (Ctrl+Shift+M on a Mac): Tab moves the focus instead of indenting.
import "monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js";
import { uriFor } from "./files.mjs";
import { registerProviders } from "./providers.mjs";
import { applyAbaplintFixes, applyLinterFixes, formatFiles, knownObjectNames } from "./registry.mjs";
import * as analysis from "./analysis.mjs";
import { OWNERS, refresh } from "./analysis.mjs";

// @abaplint/monaco's snippet provider reaches for a global `monaco`, the way a
// script tag would have provided it. It is a library written for a page that
// loads Monaco from a CDN; here it is bundled, so the global has to be put
// there.
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
// The element the editor was created in, kept because the pane says out loud
// when it is read-only and Monaco's own DOM node is not where that belongs.
let editorContainer;
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

const modelFor = (name) => monaco.editor.getModel(monaco.Uri.parse(uriFor(name)));

// The analysis (analysis.mjs) is Monaco-free and reads the editor through
// this: the open files, what they are right now - every model's uri and
// version id, which Monaco bumps on every edit, plus the generation counter
// above - and where the underlines go. Monaco replaces all markers of one
// owner at a time, so the two checkers keep separate owners: a shared one
// would have whichever ran second erase the other's underlines.
const LSP_SEVERITY = () => ({
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
  hint: monaco.MarkerSeverity.Hint,
});
analysis.useHost({
  files: () => getFiles(),
  key: () =>
    monaco.editor
      .getModels()
      .filter((m) => m.uri.scheme === "file")
      .map((m) => `${m.uri.path}@${m.getVersionId()}`)
      .join("|") + `#${modelGeneration}`,
  markers(name, owner, list) {
    const model = modelFor(name);
    if (!model) return;
    const severity = LSP_SEVERITY();
    monaco.editor.setModelMarkers(
      model,
      owner,
      list.map((m) => ({
        ...m,
        severity: severity[m.severity] ?? monaco.MarkerSeverity.Error,
        code: m.code ? { value: m.code.value, target: monaco.Uri.parse(m.code.href) } : undefined,
      })),
    );
  },
  lineCount: (name) => modelFor(name)?.getLineCount() ?? 1,
  lineMaxColumn: (name, line) => modelFor(name)?.getLineMaxColumn(line) ?? 1,
});

// Monaco's stylesheet is a file of its own - assets/monaco-editor-<hash>.css,
// bundled apart from shell.css by tools/build-site.mjs so that a page with no
// editor never downloads it - and index.html's inline script links it, under
// this id, on every page that will show the editor, at the same moment it
// preloads this chunk. The chunk is forty times the stylesheet, so the sheet
// has all but always landed first; this is for the time it has not, so the
// editor is never created against a document Monaco's rules are not in yet.
// Bounded: a stylesheet the network lost costs an unstyled editor, not a
// playground that never starts. A document without the link at all is one
// the inline script did not run on, which no page of this site is - said
// loudly rather than drawn unstyled.
export function stylesheetReady() {
  const link = document.getElementById("monaco-css");
  if (!link) {
    throw new Error("Monaco's stylesheet is not on this page - index.html's inline script links it wherever the editor is shown");
  }
  if (link.sheet) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", done, { once: true });
    setTimeout(done, 5000);
  });
}

// options.dark says which theme to start in; the shell decides that (see
// src/shell/theme.mjs) and calls setEditorTheme( ) when it changes.
export function createEditor(container, files, options = {}) {
  onChange = options.onChange;
  editorContainer = container;

  monaco.editor.defineTheme(THEME_LIGHT, { base: "vs", inherit: true, rules: [], colors: {} });
  // Comments a shade lighter than vs-dark's #608b4e, which is 4.2:1 on the
  // editor's background - below the 4.5:1 text needs.
  monaco.editor.defineTheme(THEME_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [{ token: "comment", foreground: "6A9955" }],
    colors: {},
  });

  fileOrder = files.map((f) => f.name);
  for (const file of files) createModel(file);

  editor = monaco.editor.create(container, {
    model: modelFor(files[0].name),
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 13,
    tabSize: 2,
    renderWhitespace: "selection",
    theme: options.dark ? THEME_DARK : THEME_LIGHT,
  });
  // A disposed file's markers go with it. Monaco clears them itself only for
  // its own URI schemes, not for file:/// - so every file closed, and every
  // file a sample or the AI chat replaced, left its underlines in the marker
  // service for the session, and a file opened again under the same name
  // showed the old ones until the next analysis.
  monaco.editor.onWillDisposeModel((model) => {
    for (const owner of OWNERS) monaco.editor.setModelMarkers(model, owner, []);
  });
  // Shift+Alt+F, as the Format button's tooltip says, on every platform.
  // Monaco binds document formatting to Ctrl+Shift+I on Linux, so there the
  // advertised key did nothing at all (the tests run with a Windows user
  // agent, which is why they never saw it).
  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
    editor.getAction("editor.action.formatDocument")?.run();
  });
  // A way out for the keyboard. Tab indents in a code editor, which is right,
  // and it left a keyboard reader no way to reach the panel, the splitter or
  // the running app once the focus was in here - Escape did nothing and the
  // Ctrl+M toggle was not in the build. Now Escape arms ONE Tab or Shift+Tab
  // that moves the focus on, and any other key disarms it, so a plain Tab
  // still indents.
  const K = monaco.KeyCode;
  let tabLeaves = false;
  const leaveOnTab = (on) => {
    if (tabLeaves === on) return;
    tabLeaves = on;
    editor.updateOptions({ tabFocusMode: on });
  };
  editor.onKeyDown((e) => {
    if (e.keyCode === K.Escape) leaveOnTab(true);
    else if (e.keyCode !== K.Tab && e.keyCode !== K.Shift) leaveOnTab(false);
  });
  editor.onDidBlurEditorText(() => leaveOnTab(false));

  return editor;
}

export function setEditorTheme(dark) {
  monaco.editor.setTheme(dark ? THEME_DARK : THEME_LIGHT);
}

// Whether the editor takes typing.
//
// One caller: the View tab's edit mode, which hands the reader the view to
// change instead of the chain that builds it. While that is open the ABAP is
// derived from the XML rather than the other way round, and typing into both
// at once would mean deciding which of the two is the truth on every
// keystroke. The panel is the one that says when this goes back on, in every
// path out of edit mode - Save, Cancel, and the file being switched away from.
//
// Monaco's read-only state looks exactly like its editable one - same colours,
// and a caret that still lands where the reader clicks - so the class is what
// makes it visible: `.editor.is-readonly` in src/shell/shell.css greys the
// source back and takes the caret away, the way a disabled control reads.
// Typing was already refused; this is so nobody has to try it to find out.
export function setEditorReadOnly(readOnly) {
  editor?.updateOptions({ readOnly });
  editorContainer?.classList.toggle("is-readonly", readOnly);
}

// Replaces one file's text as an edit somebody can undo, which is what makes
// a view rewritten out of the View tab a Ctrl+Z away from what it replaced.
// Same door the fixers use; see writeSource( ) at the bottom of this file.
export function setSourceOf(name, source) {
  writeSource(name, source);
  closeUndoSteps();
  refresh();
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
  // The formatting provider - Shift+Alt+F, which is Monaco's own binding -
  // formats through the same worker call the bar's button does, and needs the
  // whole file set to do it: an include is not an object on its own.
  // `version` names a file's text: Monaco's version id, bumped on every
  // edit, with the model's own id in front of it, because a file closed and
  // opened again is a new model whose versions start over at one.
  registerProviders({
    files: () => getFiles(),
    version: (name) => {
      const model = modelFor(name);
      return model ? `${model.id}@${model.getVersionId()}` : undefined;
    },
    write: writeSource,
    format: () => format(),
  });
  monaco.languages.registerCompletionItemProvider("abap", abapNameCompletion());
  connected = true;
  analysis.connect();
  refresh();
}

// The names of the open files, without reading their text - which getFiles( )
// does, and which a completion on every keystroke should not.
const openNames = () => orderedModels().map(nameOf);

// The version Monaco keeps per model, bumped on every edit - for a reader
// that caches something about a file and has to know when it went stale.
export const fileVersion = (name) => modelFor(name)?.getVersionId();

// Everything currently open, in the order it was opened.
export function getFiles() {
  return orderedModels().map((m) => ({ name: m.uri.path.replace(/^\//, ""), source: m.getValue() }));
}

// The open files in the order they were OPENED IN, not the order Monaco
// happens to hold their models in.
//
// The first file is the app - it is what Run starts - so this order decides
// what runs, and Monaco's is the order models were created in. setFiles( )
// reuses a model whose file is already open (that is what keeps a loaded
// sample one Ctrl+Z away from the draft it replaced), so a sample whose second
// file is another sample's first one came out with its files the wrong way
// round and started the wrong class. Nothing said so: both classes were there,
// both compiled, and the app on screen was simply not the one that had been
// picked.
let fileOrder = [];
const nameOf = (model) => model.uri.path.replace(/^\//, "");
function orderedModels() {
  const open = monaco.editor.getModels().filter((m) => m.uri.scheme === "file");
  const at = (m) => {
    const i = fileOrder.indexOf(nameOf(m));
    // A model nobody ordered - there is none today - goes last rather than
    // first, where it would silently become the app.
    return i === -1 ? fileOrder.length : i;
  };
  return open.sort((a, b) => at(a) - at(b));
}

export const getSource = (name) => modelFor(name)?.getValue();

export function openFile(name) {
  const model = modelFor(name);
  if (model) editor.setModel(model);
}

// Called whenever a different file is on screen, whoever put it there - the
// strip, a problem row in another file, a failing test's row - so the strip
// and everything that follows the open file are told once, here, rather than
// by each caller that remembers to.
export function onFileShown(fn) {
  editor.onDidChangeModel(() => fn());
}

// Which file the editor is showing, or nothing at all - there is a moment in
// setFiles( ) below where it holds no model, and a reader that asks then is
// asking a fair question with no answer.
export const currentFile = () => editor.getModel()?.uri.path.replace(/^\//, "");

export function addFile(file) {
  fileOrder = [...fileOrder.filter((n) => n !== file.name), file.name];
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
  // A class's test include goes with it: left open alone it was a file set
  // nothing could hold - the reload, the share link and the named draft all
  // refused it, and the stored draft was lost behind the refusal.
  const tests = name.endsWith(".clas.abap") ? name.replace(/\.clas\.abap$/, ".clas.testclasses.abap") : undefined;
  const gone = (n) => n === name || n === tests;
  const remaining = files.filter((f) => !gone(f.name));
  if (remaining.length === 0) return;
  if (gone(currentFile())) openFile(remaining[0].name);
  fileOrder = fileOrder.filter((n) => !gone(n));
  if (tests) modelFor(tests)?.dispose();
  model.dispose();
  modelGeneration += 1;
  if (connected) refresh();
  onChange?.(getFiles());
}

// Replaces everything - what loading a sample or a catalogued example does.
//
// Through the undo stack where it can: a file that is open under the same
// name is rewritten in place rather than disposed and recreated, so what was
// there - a draft somebody had been typing for an hour and then clicked a
// sample over - is one Ctrl+Z away instead of gone. Files the new set does
// not have are closed; files it adds are created. Every sample starts in
// the same main file, so the draft's main file is always kept this way.
export function setFiles(files) {
  fileOrder = files.map((f) => f.name);
  modelGeneration += 1;
  for (const file of files) {
    if (modelFor(file.name)) writeSource(file.name, file.source);
    else createModel(file);
  }
  closeUndoSteps();
  editor.setModel(modelFor(files[0].name));
  // The leftovers go only once the editor is showing one of the new models.
  // Disposing the model the editor holds leaves the editor with NO model, and
  // everything that asks which file is open reads `uri` off null in that
  // window - the panel does, on the change the disposal itself fires. It was
  // unreachable while every sample was called zcl_playground.clas.abap: the
  // shown model was always one of the ones being written over rather than one
  // being disposed.
  const wanted = new Set(files.map((f) => f.name));
  for (const model of monaco.editor.getModels()) {
    if (model.uri.scheme === "file" && !wanted.has(model.uri.path.replace(/^\//, ""))) model.dispose();
  }
  if (connected) refresh();
  onChange?.(getFiles());
}

export function focusProblem(file, line, column = 1) {
  openFile(file);
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column });
  editor.focus();
}

// Format: every file that is open, laid out.
//
// It is abaplint's pretty printer - indentation and keyword case - with
// abaplint's layout fixes in front of it, which is a good deal more than the
// printer does alone: trailing whitespace, tabs, double spaces, a space before
// the full stop, two statements on one line, blank lines by the half dozen.
// registry-core.mjs's formatFiles( ) is the whole of it, and the list of rules
// there says what is deliberately NOT on it.
//
// Every file, not just the one on screen: a class and its test include are one
// piece of work, and formatting the half somebody happens to be looking at is
// the kind of half-done that has to be noticed to be finished. Written back
// through pushEditOperations, one edit per file, so Ctrl+Z takes the whole
// thing back the way it takes an autofix back.
export async function format() {
  if (!connected) return { formatted: 0, files: [] };
  const unchanged = versionGuard();
  const result = await formatFiles(getFiles());
  const files = result.files.filter((file) => unchanged(file.name));
  for (const file of files) writeSource(file.name, file.source);
  closeUndoSteps();
  if (files.length > 0) refresh();
  editor.focus();
  return { ...result, formatted: files.length, files };
}

// Which files are still as they were when the worker was asked. Format and
// Fix them answer with a whole file each, a round trip later, and written over
// a model somebody typed into meanwhile they took the typing with them - the
// longer the worker was busy (a reparse after a Config change, on a phone),
// the more. A file that moved is left alone; the next press catches it up.
function versionGuard() {
  const before = new Map(orderedModels().map((m) => [m.uri.path.replace(/^\//, ""), m.getVersionId()]));
  return (name) => {
    const model = modelFor(name);
    return model != null && model.getVersionId() === before.get(name);
  };
}

// One step back in the open file, through Monaco's own undo - the same one
// Ctrl+Z is bound to, so a Format or a Fix them comes back the way it went:
// as one edit. For the bar's button, which is there for the reader on a
// phone, where there is no Ctrl+Z to press.
export function undo() {
  editor.trigger("bar", "undo", null);
  editor.focus();
}

export function redo() {
  editor.trigger("bar", "redo", null);
  editor.focus();
}

// Whether those buttons have anything to do. Asked after every change and
// every file switch; a button that does nothing when pressed is worse than
// none.
export const canUndo = () => editor?.getModel()?.canUndo() ?? false;
export const canRedo = () => editor?.getModel()?.canRedo() ?? false;

// The name the caret is at the end of - letters, digits and underscores, not
// starting with a digit - or undefined: what /([a-zA-Z_][\w_]*)$/ found, read
// backwards from the caret instead. Anchored at the end, that regex was tried
// from every start, so a long run of word characters with one more character
// after it - a long name, then `(` - cost the square of its length.
const isDigit = (c) => c >= 48 && c <= 57;
const isWord = (c) => isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
function typedName(line) {
  let start = line.length;
  while (start > 0 && isWord(line.charCodeAt(start - 1))) start--;
  while (start < line.length && isDigit(line.charCodeAt(start))) start++;
  return start < line.length ? line.slice(start) : undefined;
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
      const prefix = typedName(line);
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
      for (const object of knownObjectNames(openNames())) {
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
export async function applyFixes() {
  if (!connected) return 0;
  let fixed = 0;

  const unchanged = versionGuard();
  const afterAbaplint = await applyAbaplintFixes(getFiles());
  closeUndoSteps();
  fixed += afterAbaplint.fixed;
  for (const file of afterAbaplint.files) if (unchanged(file.name)) writeSource(file.name, file.source, { sameStep: true });

  // Repeated, because one fix can uncover the next - the same reason abaplint
  // loops - and bounded for the same reason.
  for (let pass = 0; pass < 5; pass++) {
    let changed = 0;
    for (const file of getFiles()) {
      // A round trip: the linter runs in the registry worker. The reader's
      // own edit in the meantime wins, as it does over abaplint's above -
      // guarded per file, since the pass before has moved the versions.
      const still = versionGuard();
      const result = await applyLinterFixes(file.source);
      if (result.fixed === 0 || !still(file.name)) continue;
      // The passes after abaplint's join the step its write opened: one
      // Ctrl+Z per file for the whole of Fix them.
      writeSource(file.name, result.source, { sameStep: true });
      changed += result.fixed;
    }
    if (changed === 0) break;
    fixed += changed;
  }

  closeUndoSteps();
  refresh();
  return fixed;
}

// The undo step the reader's typing left open is closed first. Without that
// Monaco added the edit to it, and ONE Ctrl+Z after a Format, a Fix them or a
// write from the AI took back the format and the last words typed with it.
// The step the edit opens is closed by the caller once its batch is done
// (closeUndoSteps( )), so Fix them's passes over a file are still one step.
function writeSource(name, source, { sameStep = false } = {}) {
  const model = modelFor(name);
  if (!model || model.getValue() === source) return;
  if (!sameStep) model.pushStackElement();
  model.pushEditOperations(
    null,
    [{ range: model.getFullModelRange(), text: source }],
    () => null,
  );
}

function closeUndoSteps() {
  for (const model of orderedModels()) model.pushStackElement();
}
