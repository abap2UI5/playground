// The Problems tab: what both checkers (and the transpiler, and a dump) say
// is wrong with the files that are open, and the Fix them bar over it.
//
// Derived, never stored: the list is what the editor's last analysis said
// (updateInsight( ) in insight.mjs hands it over), so there is no second copy
// of the truth to go stale.
import { applyFixes, fixableNow, getFiles, refresh } from "../editor/editor.mjs";
import { empty, problemsChanged } from "./insight-common.mjs";
import { setStatus, showOutput } from "./ui.mjs";

let lastProblems = [];

// Kept for the next draw, and counted on the tab's badge at once - the badge
// is what says whether the tab is worth opening.
export function setProblems(problems) {
  lastProblems = problems ?? [];
  paintCount();
}

function paintCount() {
  const errors = lastProblems.filter((p) => p.severity === 1).length;
  const rest = lastProblems.length - errors;
  const badge = document.getElementById("problem-count");
  if (!badge) return;
  badge.textContent = lastProblems.length === 0 ? "" : errors > 0 ? String(errors) : String(rest);
  badge.className = `insight-badge${errors > 0 ? " is-error" : lastProblems.length > 0 ? " is-warning" : ""}`;
}

const SEVERITY_LABEL = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

export function problemsTab() {
  const wrap = document.createElement("div");
  wrap.className = "insight-problems";

  const fixable = fixableNow();
  if (fixable > 0) wrap.append(fixBar(fixable));

  const list = document.createElement("ul");
  list.className = "insight-list";
  wrap.append(list);

  if (lastProblems.length === 0) {
    if (fixable === 0) return empty("Nothing to report.");
    return wrap;
  }

  // Errors first, then by file and line: the order somebody would work through
  // them in, rather than the order the two checkers happened to run.
  const sorted = [...lastProblems].sort(
    (a, b) =>
      a.severity - b.severity ||
      a.file.localeCompare(b.file) ||
      (a.range?.start?.line ?? 0) - (b.range?.start?.line ?? 0),
  );

  // Asked once for the list rather than once per row: getFiles( ) reads every
  // open model's full text out of Monaco, and the answer cannot change halfway
  // down a list that is being built in one go.
  const several = getFiles().length > 1;

  for (const problem of sorted) {
    const line = (problem.range?.start?.line ?? 0) + 1;
    const column = (problem.range?.start?.character ?? 0) + 1;

    const item = document.createElement("li");
    // The row is a button in the item rather than the item itself: going to a
    // problem is the whole purpose of this list, and a <li> cannot be tabbed
    // to or pressed. The click handler is delegated on [data-file] either way.
    const row = document.createElement("button");
    row.type = "button";
    row.className = `insight-row is-${SEVERITY_LABEL[problem.severity] ?? "info"}`;
    row.dataset.file = problem.file;
    row.dataset.line = String(line);
    row.dataset.column = String(column);

    const where = document.createElement("span");
    where.className = "insight-where";
    // The file name only earns its space when there is more than one.
    where.textContent = several ? `${problem.file}:${line}` : `line ${line}`;

    const what = document.createElement("span");
    what.className = "insight-what";
    what.textContent = problem.message;

    const who = document.createElement("span");
    who.className = "insight-who";
    // Which checker said it, because the two mean different things: abaplint
    // says this will not compile, abap2UI5 says it will compile and be wrong.
    who.textContent = problem.source === "abap2UI5" ? `abap2UI5 · ${problem.rule ?? ""}` : (problem.source ?? "abaplint");

    row.append(where, what, who);
    item.append(row);

    // Where the rule is explained - the linter's rules page for an abap2UI5
    // finding, rules.abaplint.org for abaplint's (its diagnostics carry the
    // link as codeDescription). Outside the button, because a link cannot
    // live inside one; the row still goes to the problem, this goes to the
    // page that says what the problem means and shows the same code fixed.
    const url = problem.url ?? problem.codeDescription?.href;
    if (url) {
      const doc = document.createElement("a");
      doc.className = "insight-doc";
      doc.href = url;
      doc.target = "_blank";
      doc.rel = "noopener";
      doc.title = `What ${problem.rule ?? problem.code ?? "this rule"} means, and the same code fixed`;
      doc.textContent = "rule ↗";
      item.append(doc);
    }
    list.append(item);
  }
  return wrap;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What Fix them would repair, by kind. "1 of these can be fixed
// automatically" over a list of three errors read as one of the errors - and
// the one was a warning about an obsolete call, with all three errors still
// there after the press. So the sentence names what is fixable, and when
// errors are left over it says that too: the button is not the way to make
// the ABAP compile, and the reader should know before pressing it.
//
// Counted off the rows, each of which says whether its checker has a fix for
// it (`fixable`); `count` is the checkers' own total, which the rows can fall
// short of (a finding in a file not on screen) - then the plain number is all
// there is to say.
export function fixableSaid(count, problems) {
  const fixable = problems.filter((p) => p.fixable);
  if (fixable.length !== count) return `${count} of these can be fixed automatically`;
  const errors = fixable.filter((p) => p.severity === 1).length;
  const warnings = fixable.filter((p) => p.severity === 2).length;
  const rest = fixable.length - errors - warnings;
  const parts = [];
  if (errors > 0) parts.push(plural(errors, "error"));
  if (warnings > 0) parts.push(plural(warnings, "warning"));
  if (rest > 0) parts.push(plural(rest, "hint"));
  const what = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  const said = `${what} can be fixed automatically`;
  const allErrors = problems.filter((p) => p.severity === 1).length;
  const left = allErrors - errors;
  if (left === 0) return said;
  return `${said} - ${left === allErrors ? `the ${plural(allErrors, "error")}` : `${left} of the ${plural(allErrors, "error")}`} cannot`;
}

// The autofix offer. Shown only when something is actually repairable, and it
// says how many - a button that turns out to do nothing is worse than no
// button, and "Fix" alone does not tell anybody whether it is worth pressing.
function fixBar(count) {
  const bar = document.createElement("div");
  bar.className = "insight-fixbar";

  const said = document.createElement("span");
  said.textContent = fixableSaid(count, lastProblems);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.textContent = "Fix them";
  button.addEventListener("click", async () => {
    button.disabled = true;
    // Both checkers rewrite the source, so this is somebody's code being
    // changed under them. It goes in as one edit per file, which is what makes
    // Ctrl+Z take the whole thing back rather than unpicking it fix by fix.
    let fixed;
    try {
      fixed = await applyFixes();
    } catch (e) {
      // A fixer that threw in the worker: said, and the button handed back,
      // rather than an unhandled rejection under a button left disabled.
      button.disabled = false;
      setStatus("the fixes could not be applied", true);
      showOutput("Fix them", String(e?.message ?? e));
      return;
    }
    problemsChanged(refresh());
    // The outcome goes to the status line, not into this bar: the line above
    // was written by a render that the problemsChanged( ) on the line before
    // just replaced, so anything set here would be wiped by its own success.
    setStatus(
      fixed === 0
        ? "nothing could be fixed after all"
        : `fixed ${fixed} problem${fixed === 1 ? "" : "s"} - Ctrl+Z takes it back`,
    );
  });

  bar.append(said, button);
  return bar;
}
