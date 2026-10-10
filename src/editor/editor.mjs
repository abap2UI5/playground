// The editor, as the rest of the page sees it.
//
// One set of functions - the files, the file on screen, the analysis, Format,
// Fix them, undo - answered by one of two halves: Monaco (monaco-editor.mjs),
// or a plain list of files (file-store.mjs) on a page that shows no editor.
// createEditor( ) decides, and the page bundle is split there: Monaco is a
// chunk the entry imports dynamically, so an app-only page - ?view=app,
// ?view=full, which is what every demo embedded in the documentation is -
// never fetches it. It used to download, evaluate and instantiate the whole
// of Monaco into a pane it had hidden.
//
// The analysis (analysis.mjs) is the same module on both pages and is
// re-exported from it directly; everything else goes through `impl`, which
// is the store until createEditor( ) has run - nothing asks before then.
import * as store from "./file-store.mjs";

export {
  analysisPending,
  fixableNow,
  invalidateAnalysis,
  lintViewsFor,
  refresh,
  refreshNow,
  reportTranspilerProblems,
  whenAnalysed,
} from "./analysis.mjs";

let impl = store;

// Starts Monaco's download without creating anything, for a page that will
// show the editor: called at the top of boot( ), before the awaits that
// stand between it and createEditor( ) - the files, which for a ?src= link
// are two round trips to GitHub. The build also preloads the chunk from
// index.html on such a page (writeIndex in tools/build-site.mjs), so by the
// time this runs the bytes are usually there already.
let monacoHalf;
export function preloadEditor() {
  monacoHalf ??= import("./monaco-editor.mjs");
  return monacoHalf;
}

// `options.editor === false` is the app-only page: the files are kept and
// checked, and nothing is drawn.
export async function createEditor(container, files, options = {}) {
  impl = options.editor === false ? store : await preloadEditor();
  // Monaco's stylesheet, linked by index.html beside the chunk's preload and
  // all but always there before the chunk is; see monaco-editor.mjs.
  if (impl !== store) await impl.stylesheetReady();
  return impl.createEditor(container, files, options);
}

export const setEditorTheme = (dark) => impl.setEditorTheme(dark);
export const setEditorReadOnly = (readOnly) => impl.setEditorReadOnly(readOnly);
export const setSourceOf = (name, source) => impl.setSourceOf(name, source);
export const connectRegistry = () => impl.connectRegistry();
export const fileVersion = (name) => impl.fileVersion(name);
export const getFiles = () => impl.getFiles();
export const getSource = (name) => impl.getSource(name);
export const openFile = (name) => impl.openFile(name);
export const onFileShown = (fn) => impl.onFileShown(fn);
export const currentFile = () => impl.currentFile();
export const addFile = (file) => impl.addFile(file);
export const closeFile = (name) => impl.closeFile(name);
export const setFiles = (files) => impl.setFiles(files);
export const focusProblem = (file, line, column) => impl.focusProblem(file, line, column);
export const format = () => impl.format();
export const undo = () => impl.undo();
export const redo = () => impl.redo();
export const canUndo = () => impl.canUndo();
export const canRedo = () => impl.canRedo();
export const applyFixes = () => impl.applyFixes();
