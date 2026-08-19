// The panel under the editor: what is wrong, and what is in the file.
//
// Two views of the same source, sharing one strip because they answer the two
// questions a reader has while looking at a class - "is anything broken" and
// "where is the method I want". Both are derived, never stored: they are
// rebuilt from the editor on every change, so there is no second copy of the
// truth to go stale.
import { currentFile, focusProblem, getFiles } from "../editor/editor.mjs";
import { documentSymbols } from "../editor/registry.mjs";

let panel;
let body;
let tabs;
let view = "problems";
let lastProblems = [];

export function setUpInsight() {
  panel = document.getElementById("insight");
  body = document.getElementById("insight-body");
  tabs = [...panel.querySelectorAll("[data-insight]")];

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

// Called whenever the editor changed. `problems` is what refresh() returned, so
// the panel never runs a checker itself - one analysis, two readers.
export function updateInsight(problems) {
  lastProblems = problems ?? [];
  paintCount();
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

function render() {
  if (!panel) return;
  for (const tab of tabs) tab.classList.toggle("is-active", tab.dataset.insight === view);
  body.replaceChildren(view === "problems" ? problemList() : outlineList());
}

const SEVERITY_LABEL = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

function problemList() {
  const list = document.createElement("ul");
  list.className = "insight-list";

  if (lastProblems.length === 0) {
    return empty("Nothing to report.");
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
  return list;
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
