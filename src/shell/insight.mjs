// The panel under the editor: what is wrong, and what is in the file.
//
// Two views of the same source, sharing one strip because they answer the two
// questions a reader has while looking at a class - "is anything broken" and
// "where is the method I want". Both are derived, never stored: they are
// rebuilt from the editor on every change, so there is no second copy of the
// truth to go stale.
import {
  applyFixes,
  currentFile,
  fixableNow,
  focusProblem,
  getFiles,
  refresh,
} from "../editor/editor.mjs";
import {
  abaplintDefaults,
  abaplintSettings,
  allRuleNames,
  applyAbaplintSettings,
  documentSymbols,
} from "../editor/registry.mjs";
import { applyLinterSettings, linterDefaults, linterSettings } from "../editor/abap2ui5-lint.mjs";
import { setStatus } from "./ui.mjs";

let panel;
let body;
let tabs;
let view = "problems";
let lastProblems = [];

const HEIGHT_KEY = "abap2ui5-playground:insight-height";
const MIN_HEIGHT = 80;

export function setUpInsight() {
  panel = document.getElementById("insight");
  body = document.getElementById("insight-body");
  tabs = [...panel.querySelectorAll("[data-insight]")];

  setUpResize();

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      // Clicking the tab that is already open collapses the panel. On a short
      // screen the editor is what matters, and this is the only control that
      // gives the space back.
      if (tab.dataset.insight === view && !panel.classList.contains("is-collapsed")) {
        panel.classList.add("is-collapsed");
        return;
      }
      panel.classList.remove("is-collapsed");
      view = tab.dataset.insight;
      render();
    });
  }

  // A click in either list goes to the line it names.
  body.addEventListener("click", (e) => {
    const row = e.target.closest("[data-file]");
    if (!row) return;
    focusProblem(row.dataset.file, Number(row.dataset.line), Number(row.dataset.column));
  });

  render();
}

// The panel's own height, dragged from its top edge. A config screen or a long
// list of problems wants more room than a glance at the outline does, and the
// only person who knows which is happening is the one looking at it.
function setUpResize() {
  const grip = document.getElementById("insight-grip");
  const stored = Number(localStorage.getItem(HEIGHT_KEY));
  if (Number.isFinite(stored) && stored >= MIN_HEIGHT) panel.style.height = `${stored}px`;

  const apply = (px) => {
    // Bounded against the pane rather than the window: the editor above has to
    // keep enough room to be an editor, or the drag hands the user a panel
    // with nothing left to look at.
    const room = panel.parentElement.getBoundingClientRect().height;
    const height = Math.round(Math.min(Math.max(px, MIN_HEIGHT), room - 120));
    panel.style.height = `${height}px`;
    return height;
  };

  grip.addEventListener("pointerdown", (e) => {
    grip.setPointerCapture(e.pointerId);
    panel.classList.remove("is-collapsed");
    grip.classList.add("is-dragging");
    e.preventDefault();
  });

  grip.addEventListener("pointermove", (e) => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    apply(panel.getBoundingClientRect().bottom - e.clientY);
  });

  const stop = (e) => {
    if (!grip.hasPointerCapture?.(e.pointerId)) return;
    grip.releasePointerCapture(e.pointerId);
    grip.classList.remove("is-dragging");
    localStorage.setItem(HEIGHT_KEY, String(apply(panel.getBoundingClientRect().bottom - e.clientY)));
  };
  grip.addEventListener("pointerup", stop);
  grip.addEventListener("pointercancel", stop);

  // A drag handle is a control, so it answers the keyboard as one.
  grip.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowUp" ? 24 : e.key === "ArrowDown" ? -24 : 0;
    if (step === 0) return;
    e.preventDefault();
    panel.classList.remove("is-collapsed");
    localStorage.setItem(HEIGHT_KEY, String(apply(panel.getBoundingClientRect().height + step)));
  });
}

// Called whenever the editor changed. `problems` is what refresh() returned, so
// the panel never runs a checker itself - one analysis, two readers.
export function updateInsight(problems) {
  lastProblems = problems ?? [];
  paintCount();
  // The config views hold half-typed text somebody is in the middle of - a
  // rerender under their hands would throw it away on every keystroke.
  if (view === "problems" || view === "outline") render();
}

function paintCount() {
  const errors = lastProblems.filter((p) => p.severity === 1).length;
  const rest = lastProblems.length - errors;
  const badge = document.getElementById("problem-count");
  if (!badge) return;
  badge.textContent = lastProblems.length === 0 ? "" : errors > 0 ? String(errors) : String(rest);
  badge.className = `insight-badge${errors > 0 ? " is-error" : lastProblems.length > 0 ? " is-warning" : ""}`;
}

const VIEWS = {
  problems: problemList,
  outline: outlineList,
  abaplint: abaplintConfig,
  abap2ui5: linterConfig,
};

function render() {
  if (!panel) return;
  for (const tab of tabs) tab.classList.toggle("is-active", tab.dataset.insight === view);
  body.replaceChildren((VIEWS[view] ?? problemList)());
}

const SEVERITY_LABEL = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

function problemList() {
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

  for (const problem of sorted) {
    const line = (problem.range?.start?.line ?? 0) + 1;
    const column = (problem.range?.start?.character ?? 0) + 1;

    const item = document.createElement("li");
    item.className = `insight-row is-${SEVERITY_LABEL[problem.severity] ?? "info"}`;
    item.dataset.file = problem.file;
    item.dataset.line = String(line);
    item.dataset.column = String(column);

    const where = document.createElement("span");
    where.className = "insight-where";
    // The file name only earns its space when there is more than one.
    where.textContent = getFiles().length > 1 ? `${problem.file}:${line}` : `line ${line}`;

    const what = document.createElement("span");
    what.className = "insight-what";
    what.textContent = problem.message;

    const who = document.createElement("span");
    who.className = "insight-who";
    // Which checker said it, because the two mean different things: abaplint
    // says this will not compile, abap2UI5 says it will compile and be wrong.
    who.textContent = problem.source === "abap2UI5" ? `abap2UI5 · ${problem.rule ?? ""}` : "abaplint";

    item.append(where, what, who);
    list.append(item);
  }
  return wrap;
}

// The autofix offer. Shown only when something is actually repairable, and it
// says how many - a button that turns out to do nothing is worse than no
// button, and "Fix" alone does not tell anybody whether it is worth pressing.
function fixBar(count) {
  const bar = document.createElement("div");
  bar.className = "insight-fixbar";

  const said = document.createElement("span");
  said.textContent = `${count} of these can be fixed automatically`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.textContent = "Fix them";
  button.addEventListener("click", () => {
    button.disabled = true;
    // Both checkers rewrite the source, so this is somebody's code being
    // changed under them. It goes in as one edit per file, which is what makes
    // Ctrl+Z take the whole thing back rather than unpicking it fix by fix.
    const fixed = applyFixes();
    updateInsight(refresh());
    // The outcome goes to the status line, not into this bar: the line above
    // was written by a render that the updateInsight( ) on the line before just
    // replaced, so anything set here would be wiped by its own success.
    setStatus(
      fixed === 0
        ? "nothing could be fixed after all"
        : `fixed ${fixed} problem${fixed === 1 ? "" : "s"} - Ctrl+Z takes it back`,
    );
  });

  bar.append(said, button);
  return bar;
}

// The classes, interfaces, methods and attributes of the file on screen, read
// out of the same registry the editor checks against - abaplint answers
// documentSymbol, so this is a view of an existing analysis rather than a
// second parser that could disagree with the first.
function outlineList() {
  const file = currentFile();
  const symbols = outlineOf(file);
  if (symbols.length === 0) return empty("Nothing to show yet.");

  const list = document.createElement("ul");
  list.className = "insight-list is-outline";
  for (const symbol of symbols) {
    const item = document.createElement("li");
    item.className = `insight-row is-symbol depth-${symbol.depth}`;
    item.dataset.file = file;
    item.dataset.line = String(symbol.line);
    item.dataset.column = "1";

    const kind = document.createElement("span");
    kind.className = "insight-kind";
    kind.textContent = symbol.kind;

    const name = document.createElement("span");
    name.className = "insight-what";
    name.textContent = symbol.name;

    item.append(kind, name);
    list.append(item);
  }
  return list;
}

// abaplint's symbol kinds are LSP numbers; only the handful ABAP produces are
// named here, and anything else keeps its distance rather than claiming a name.
const KIND = {
  5: "class",
  6: "method",
  7: "field",
  8: "field",
  11: "interface",
  12: "function",
  14: "const",
};

function outlineOf(file) {
  if (!file) return [];
  try {
    return flatten(documentSymbols(file), 0);
  } catch {
    // A file mid-edit can be unparseable, and an outline is not worth an
    // exception - the underlines already say what is wrong.
    return [];
  }
}

function flatten(symbols, depth) {
  const out = [];
  for (const symbol of symbols ?? []) {
    out.push({
      name: symbol.name,
      kind: KIND[symbol.kind] ?? "",
      line: (symbol.range?.start?.line ?? symbol.selectionRange?.start?.line ?? 0) + 1,
      depth: Math.min(depth, 2),
    });
    out.push(...flatten(symbol.children, depth + 1));
  }
  return out;
}

function empty(text) {
  const p = document.createElement("p");
  p.className = "insight-empty";
  p.textContent = text;
  return p;
}

// ------------------------------------------------------------------ config

// The two checkers' settings, as text you can edit. JSON rather than a wall of
// switches: abaplint has 188 rules and the playground runs nine of them, so a
// checkbox per rule would be a screen nobody reads to reach a setting nobody
// wanted. What a reader actually asks is "why is it not warning here" - and
// the answer is to add the rule name and press Apply.
function configEditor({ title, blurb, value, onApply, onReset, extra }) {
  const wrap = document.createElement("div");
  wrap.className = "config";

  const head = document.createElement("p");
  head.className = "config-blurb";
  head.append(blurb);
  wrap.append(head);

  const area = document.createElement("textarea");
  area.className = "config-text";
  area.spellcheck = false;
  area.value = JSON.stringify(value, null, 2);
  wrap.append(area);

  const row = document.createElement("div");
  row.className = "config-row";

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "primary";
  apply.textContent = "Apply";

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset";

  const said = document.createElement("span");
  said.className = "config-said";

  row.append(apply, reset, said);
  wrap.append(row);

  if (extra) wrap.append(extra);

  apply.addEventListener("click", () => {
    said.className = "config-said";
    try {
      const parsed = JSON.parse(area.value);
      onApply(parsed);
      // The panel says what changed rather than only that something did: the
      // whole point of the tab is understanding why a message is or is not
      // there, so the count is the answer.
      const problems = refresh();
      updateInsight(problems);
      said.textContent = `applied - ${problems.length} problem${problems.length === 1 ? "" : "s"} now`;
    } catch (e) {
      said.className = "config-said is-error";
      said.textContent = String(e.message || e);
    }
  });

  reset.addEventListener("click", () => {
    area.value = JSON.stringify(onReset(), null, 2);
    apply.click();
  });

  return wrap;
}

function abaplintConfig() {
  const note = document.createElement("details");
  note.className = "config-more";
  const summary = document.createElement("summary");
  summary.textContent = "Every rule abaplint has";
  note.append(summary);
  const list = document.createElement("p");
  list.className = "config-rules";
  list.textContent = allRuleNames().join(", ");
  note.append(list);

  return configEditor({
    blurb:
      "What the editor checks. The playground runs the rules that answer " +
      "“would this work”, not the ones that answer “is this the house style” - " +
      "but any of abaplint's rules can be added here. version is the ABAP release the " +
      "syntax check holds you to.",
    value: abaplintSettings(),
    onApply: applyAbaplintSettings,
    onReset: abaplintDefaults,
    extra: note,
  });
}

function linterConfig() {
  return configEditor({
    blurb:
      "What the abap2UI5 linter checks the view against. ui5 is the oldest release " +
      "your app has to work on - lowering it finds controls and properties that a " +
      "newer system would render and an older one would not.",
    value: linterSettings(),
    onApply: applyLinterSettings,
    onReset: linterDefaults,
  });
}
