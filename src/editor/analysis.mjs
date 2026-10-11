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
// So the walk happens once and is kept. The key is what the editor is: a
// generation counter plus every open file's version, which the host bumps on
// every edit. Anything that changes the text changes the key; anything that
// does not - a second reader asking the same question - gets the answer
// already computed. What that does NOT cover is a checker whose configuration
// changed under unchanged text, which is why the Config tabs call
// invalidateAnalysis( ) before they ask again.
//
// This module knows nothing of Monaco. The files, the key and where the
// underlines go come from a HOST (useHost below): Monaco's models on the
// playground (monaco-editor.mjs), a plain list of files on an app-only page
// (file-store.mjs), which has no editor to underline in and still has to
// know whether the class compiles before it runs it. That split is what lets
// the page bundle leave Monaco out until an editor is actually shown.
import { libraryOf, isCarried } from "../shell/ui5-libs.mjs";
import { ruleUrl } from "./abap2ui5-lint.mjs";
import { analyse as analyseInWorker } from "./registry.mjs";

// What the host provides: the open files (`files( )`), what they are right
// now as a string (`key( )`), the underlines for one file under one owner
// (`markers(name, owner, list)` - a no-op where there is nothing to underline
// in), and a file's shape for a transpiler problem to be clamped to
// (`lineCount(name)`, `lineMaxColumn(name, line)`).
let host = {
  files: () => [],
  key: () => "",
  markers: () => {},
  lineCount: () => 1,
  lineMaxColumn: () => 1,
};
export function useHost(next) {
  host = next;
}

// Until the corpus has been parsed there is nothing to check against, so the
// editor edits and highlights but says nothing about the code.
let connected = false;
export function connect() {
  connected = true;
}

export const ABAPLINT_OWNER = "abaplint";
export const LINT_OWNER = "abap2ui5";
export const TRANSPILER_OWNER = "transpiler";
export const OWNERS = [ABAPLINT_OWNER, LINT_OWNER, TRANSPILER_OWNER];

// A marker, in the one shape both hosts read: the severity by name, the
// code's link as a plain string. Monaco's host maps them to its own.
const LSP_SEVERITY = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

let analysis = { key: undefined, problems: [], fixable: 0, lint: {} };

// Throws the kept answer away. For the one caller whose change is invisible to
// the key: a checker reconfigured while the text stayed exactly as it was.
export function invalidateAnalysis() {
  analysis = { key: undefined, problems: [], fixable: 0, lint: {} };
}

// The analysis under way, if one is, so two readers asking during the same
// round trip share it rather than sending the worker the same text twice.
let inFlight;

async function analyse() {
  // Nothing to check against, and nothing to check with. The registry does not
  // exist until the corpus has been parsed, and the editor is typeable for the
  // whole of that - a moment on a fast connection, several seconds on a slow
  // one. Every path that reacts to a change in the editor arrives here, so the
  // guard belongs here rather than at each caller: it was at one of them and
  // not at the other, and the one without it reached straight into a registry
  // that was not there yet. Not cached either - the very next call, once the
  // corpus has landed, has to do the work.
  if (!connected) return { problems: [], fixable: 0 };

  const key = host.key();
  if (key === analysis.key) return analysis;
  if (inFlight?.key === key) return inFlight.promise;
  if (key !== transpilerKey) forgetTranspilerProblems();

  const promise = analyseKey(key).finally(() => {
    if (inFlight?.key === key) inFlight = undefined;
  });
  inFlight = { key, promise };
  return promise;
}

async function analyseKey(key) {
  const files = host.files();
  // One round trip: the registry brought in line with the editor, then
  // abaplint's diagnostics per file and its count of what it could fix, and
  // the abap2UI5 linter's findings per file with the views they came from.
  const told = await analyseInWorker(files);
  // The text moved on while the worker was answering: this answer is about a
  // key nobody holds any more, so it is thrown away and the question asked
  // again about the text that is there now.
  if (host.key() !== key) return analyse();

  const problems = [];
  let fixable = told.fixable;

  for (const file of files) {
    // @abaplint/monaco's updateMarkers( ) written out, because it asked the
    // language server for these diagnostics and then this function asked for
    // them a second time to build the Problems list from. The marker shape is
    // theirs, code and all - what is gone is the duplicate parse and the
    // duplicate analysis.
    const found = told.diagnostics[file.name] ?? [];
    host.markers(
      file.name,
      ABAPLINT_OWNER,
      found.map((d) => ({
        severity: LSP_SEVERITY[d.severity] ?? "error",
        message: typeof d.message === "string" ? d.message : d.message.value,
        code: { value: typeof d.code === "string" ? d.code : "", href: d.codeDescription?.href || "" },
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
      })),
    );
    for (const issue of found) {
      problems.push({ file: file.name, source: "abaplint", ...issue });
    }

    // The linter's findings, computed once in the worker and used three times
    // over: the underlines, the Problems rows, and how many of them carry a
    // fix - and the views they came from, for the one check the linter
    // cannot make (below) and for the View tab (lintViewsFor).
    const { findings, docs, fixable: linterFixable } = told.lint?.[file.name] ?? NOT_LINTED;
    fixable += linterFixable;
    host.markers(
      file.name,
      LINT_OWNER,
      findings.map((f) => ({
        severity: f.severity in LINT_SEVERITY ? f.severity : "warning",
        message: f.message,
        // the same shape abaplint's markers have above: Monaco shows the
        // source and the code behind the message, and the code is a link -
        // here to the rule's card, which is where "what does this mean" is
        source: "abap2UI5",
        code: { value: f.type, href: ruleUrl(f) },
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
    problems.push(...librariesNotCarried(file, docs));
  }

  analysis = { key, problems, fixable, lint: told.lint ?? {} };
  onAnalysed?.(currentProblems());
  return analysis;
}

const LINT_SEVERITY = { error: 1, warning: 2, hint: 4 };
const NOT_LINTED = { findings: [], docs: [], notes: [], fixable: 0, loaded: false };

// The views the abap2UI5 linter reconstructed from one open file, as the
// last analysis left them - what the View tab shows. The same reconstruction
// the findings came from, so what is shown is what was checked; the notes
// are the linter's own remarks about how sure it is of the shape (a level
// left open at stringify( ), a helper it could not follow). `loaded` is
// false until the linter's chunk has reached the worker AND an analysis has
// run over this file - the tab says so in both cases, and is drawn again
// when the next analysis lands (whenAnalysed). Read off the kept answer, so
// it costs nothing: the tab used to run the linter a second time for this.
export function lintViewsFor(name) {
  const kept = analysis.lint[name];
  if (kept === undefined || !kept.loaded) return { docs: [], notes: [], loaded: false };
  return { docs: kept.docs, notes: kept.notes, loaded: true };
}

/* The one thing the abap2UI5 linter cannot know: which UI5 libraries THIS
 * site ships. It checks a view against a UI5 release and a distribution, and
 * a control from a library that exists on that release passes - sap.ui.mdc,
 * sap.ui.webc.main, sap.ui.commons are all real OpenUI5 - while
 * tools/build-ui5.mjs builds ten libraries into dist/app and no other. Such a
 * control compiles, lints, runs, and renders a gap with nothing in the
 * console: exactly the silent failure the linter was added to end, left open
 * on the one axis the playground itself introduces. The samples browser and
 * the catalogue already judge a SAMPLE's libraries this way (UI5_LIBRARIES,
 * isCarried); this judges the code in the editor the same way.
 *
 * Read off the views the linter reconstructed: every xmlns the view declares
 * that an element actually uses, mapped to its library. A row per library,
 * a warning, never an error - the class is correct ABAP and correct UI5, it
 * is this site that cannot show it. Pointed at the line that names the
 * library, which is the line to change. */
function librariesNotCarried(file, docs) {
  const used = new Set();
  for (const doc of docs) {
    const xml = typeof doc === "string" ? doc : String(doc?.xml ?? doc?.text ?? "");
    const declared = new Map();
    for (const m of xml.matchAll(/xmlns(?::([\w.-]+))?\s*=\s*"([^"]+)"/g)) declared.set(m[1] ?? "", m[2]);
    const prefixes = new Set();
    for (const m of xml.matchAll(/<([\w.-]+):[A-Za-z]/g)) prefixes.add(m[1]);
    if (/<[A-Z][\w.]*[\s/>]/.test(xml)) prefixes.add("");
    for (const prefix of prefixes) {
      const uri = declared.get(prefix);
      if (uri && uri.startsWith("sap.")) used.add(libraryOf(uri));
    }
  }
  const lines = file.source.split(/\r?\n/);
  return [...used]
    .filter((library) => !isCarried(library))
    .sort()
    .map((library) => {
      const at = lines.findIndex((line) => line.includes(library));
      return {
        file: file.name,
        source: "playground",
        severity: 2,
        message: `${library} is not one of the UI5 libraries this playground carries - a control from it will not render here (Where it stops, in the About dialog)`,
        rule: "library",
        range: { start: { line: at < 0 ? 0 : at, character: 0 } },
      };
    });
}

const currentProblems = () =>
  transpilerProblems.length === 0 ? analysis.problems : [...analysis.problems, ...transpilerProblems];

// Told whenever a fresh analysis has landed, with everything wrong with
// everything open. The registry answers from a worker now, so an analysis is
// a round trip: refresh( ) hands back what was last known and starts the
// next one, and this is how the page hears the next one.
let onAnalysed;
export const whenAnalysed = (fn) => {
  onAnalysed = fn;
};

// Pushes the editor's state towards the registry and answers with what was
// last known about everything open. The fresh answer arrives through
// whenAnalysed( ), because the registry is a worker and an analysis is a
// round trip - so a caller that has to decide on the current text, Run,
// uses refreshNow( ) and waits for it.
export function refresh() {
  analyse().catch(() => {});
  return currentProblems();
}

// Whether an analysis is under way - after refresh( ), whether its answer is
// still to come through whenAnalysed( ). analyse( ) sets this before its first
// await, so it is already true when refresh( ) returns.
export const analysisPending = () => inFlight !== undefined;

export async function refreshNow() {
  await analyse();
  return currentProblems();
}

// How many problems either checker could repair on its own, so the button can
// say what it will do - and stay away when it would do nothing.
//
// Answers zero before the registry exists. The panel is built while the corpus
// is still parsing, and asking abaplint anything at that point reaches a
// registry that is not there yet.
export function fixableNow() {
  analyse().catch(() => {});
  return analysis.fixable;
}

// What the transpiler refused, at the line it named. A third source beside
// the two checkers, with a life of its own: it is not part of the analysis,
// because it is not computed from the text but reported by a Run - and it
// goes away the moment the text changes, because the next Run will say again
// whatever is still true. Until then it is underlined and listed, so "the
// transpiler cannot compile this" points at a line rather than at the Log.
let transpilerProblems = [];
let transpilerKey;

// The same path reports what a Run found at run time - the ABAP line a dump
// was raised at (src/runtime/index.mjs traces it) - under the source name
// "runtime": also not part of the analysis, also true until the text
// changes, also one line somebody has to look at.
export function reportTranspilerProblems(found, source = "transpiler") {
  transpilerKey = host.key();
  transpilerProblems = [];
  // The underlines of the last report go with it, in every file - a dump in
  // one class and then in another left the first one underlined with no row
  // in the Problems list to say why.
  const names = host.files().map((f) => f.name);
  for (const name of names) host.markers(name, TRANSPILER_OWNER, []);
  const byFile = new Map();
  for (const { file, line: reported, message } of found) {
    if (!names.includes(file)) continue;
    // The line is the compiled text's, and the text may have lost lines since
    // (typed during the compile, or deleted before a button in the app dumped):
    // Monaco throws on a line past the end, and that throw took the app's
    // roundtrip down with it. The nearest line that exists is pointed at.
    const line = Math.min(Math.max(1, Number(reported) || 1), host.lineCount(file));
    transpilerProblems.push({
      file,
      source,
      severity: 1,
      message,
      range: { start: { line: line - 1, character: 0 } },
    });
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ line, message });
  }
  for (const [file, list] of byFile) {
    host.markers(
      file,
      TRANSPILER_OWNER,
      list.map(({ line, message }) => ({
        severity: "error",
        message: `${message}  (${source})`,
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: host.lineMaxColumn(file, line),
      })),
    );
  }
}

// Dropped as soon as the text they were about has changed. Called from
// analyse( ) on every fresh key, which is exactly that moment.
function forgetTranspilerProblems() {
  if (transpilerProblems.length === 0) return;
  transpilerProblems = [];
  transpilerKey = undefined;
  for (const { name } of host.files()) host.markers(name, TRANSPILER_OWNER, []);
}
