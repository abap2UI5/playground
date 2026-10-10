// The abap2UI5 linter, as it runs in the registry worker.
//
// It used to run on the page's thread: checkAbapSource( ) over every open file
// on every analysis - 10 to 100 ms a file on a desk, several times that on a
// phone - between the keystroke and the next paint, beside Monaco. The
// analysis is a round trip to this worker anyway (abaplint lives here), so
// the linter now answers in the same message, and the page's thread keeps
// nothing of it but the settings and the rule links
// (src/editor/abap2ui5-lint.mjs).
//
// The linter itself, and the half-megabyte of UI5 metadata it checks against,
// arrive as a bundle of their own beside this worker's (editor/lint.mjs, from
// src/editor/lint-entry.mjs - which says why not a chunk) rather than in it:
// nothing needs them before the corpus has parsed, and in the worker's bundle
// they would sit in front of the corpus fetch. loadLinter( ) is called the
// moment the worker starts, so the download runs beside the corpus's and the
// evaluation happens when it lands - between two objects of the parse, which
// yields on a clock. Until then every file answers "no findings", which is
// also what a class that builds no view answers, and the page re-runs the
// analysis once the page's own loadLinter( ) resolves (main.mjs).
//
// The import is a URL built at run time, so the bundler leaves it alone;
// relative to this script, which is served from the directory the linter's
// bundle is written to.
const LINT_BUNDLE = "./lint.mjs";
let lib;
let loading;
export function loadLinter() {
  loading ??= import(new URL(LINT_BUNDLE, self.location.href).href).then((mod) => {
    lib = { checkAbapSource: mod.checkAbapSource, applyFixes: mod.applyFixes, isFixable: mod.isFixable };
  });
  return loading;
}

export const linterLoaded = () => lib !== undefined;

// The settings in the shape the linter takes them, decided by the page
// (settingsFor( ) in abap2ui5-lint.mjs) and told to this worker whenever they
// change. The memo below is dropped with them: an answer under other settings
// is not an answer.
let settings;
export function useLinterSettings(next) {
  settings = next;
  memo.clear();
}

// The last few answers, by source. The linter runs over every open file on
// every analysis, for files that, but for the one being typed in, did not
// change. Kept per source text and dropped whenever the settings change; a
// handful is all the open files need.
const memo = new Map();
const MEMO_SIZE = 8;
function check(source) {
  if (memo.has(source)) {
    const hit = memo.get(source);
    memo.delete(source);
    memo.set(source, hit);
    return hit;
  }
  let result;
  try {
    result = lib.checkAbapSource(source, settings ?? {});
  } catch {
    result = null;
  }
  memo.set(source, result);
  if (memo.size > MEMO_SIZE) memo.delete(memo.keys().next().value);
  return result;
}

// One pass of the linter over one source, and everything the page reads off
// it: the findings for the Problems list and the underlines, how many of them
// this linter can repair itself (the Fix them bar), the views it reconstructed
// them from (the View tab, and the one check the linter cannot make - which
// libraries this site carries) and its notes on how sure it is of them. One
// walk over the builder chain, read five ways. Never throws: a rule that
// falls over on unusual input must not take the editor's diagnostics with it,
// and the file being typed into is unusual input by definition. A class that
// builds no view has nothing for this linter to say - reporting that as a
// finding would put a message on every helper class - so it comes back as no
// findings and no views, `usesBuilder` false. `loaded` says whether the
// chunk has arrived, so the page can tell "nothing to say" from "not here
// yet". Plain data throughout, which is what crosses the thread.
export function lintFor(source) {
  if (lib === undefined) return { findings: [], fixable: 0, docs: [], notes: [], usesBuilder: false, loaded: false };
  const result = check(source);
  if (!result?.usesBuilder) return { findings: [], fixable: 0, docs: [], notes: [], usesBuilder: false, loaded: true };
  const findings = result.findings ?? [];
  return {
    findings,
    // Not all of them: an icon that does not exist has no correct replacement
    // to guess at, while a missing namespace declaration or a chain that has
    // drifted out of the house layout has exactly one right answer.
    fixable: findings.filter(lib.isFixable).length,
    docs: result.docs ?? [],
    notes: result.notes ?? [],
    usesBuilder: true,
    loaded: true,
  };
}

// Repairs what can be repaired, and says how much. `deferred` counts fixes
// that overlapped one already applied - they are not lost, they are simply
// for the next press, which is why the caller runs this until it stops
// changing things.
export function applyLinterFixes(source) {
  if (lib === undefined) return { source, fixed: 0 };
  const result = check(source);
  const fixable = (result?.usesBuilder ? result.findings ?? [] : []).filter(lib.isFixable);
  if (fixable.length === 0) return { source, fixed: 0 };
  const { output, applied } = lib.applyFixes(source, fixable);
  return { source: output, fixed: applied };
}
