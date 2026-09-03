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
  fileVersion,
  fixableNow,
  focusProblem,
  getFiles,
  getSource,
  invalidateAnalysis,
  refresh,
} from "../editor/editor.mjs";
import {
  abaplintDefaults,
  abaplintSettings,
  allRuleNames,
  applyAbaplintSettings,
  documentSymbols,
} from "../editor/registry.mjs";
import { applyLinterSettings, linterDefaults, linterSettings, viewsFor } from "../editor/abap2ui5-lint.mjs";
import { copyToClipboard } from "./share.mjs";
import { onRoundtrip, roundtripList } from "./roundtrips.mjs";
import { prettyXml } from "./xml-pretty.mjs";
import { keepAbaplintSettings, keepLinterSettings } from "./checker-settings.mjs";
import { readStored, writeStored } from "./storage.mjs";
import { currentLog, hideOutput, onLogChange, setStatus } from "./ui.mjs";

let panel;
let body;
let tabs;
let view = "problems";
let lastProblems = [];

// Collapsing has to put the dragged height aside, not fight it: a height set
// by the drag lives in the element's style attribute, and an inline style beats
// any class - so `is-collapsed` alone did nothing at all once somebody had
// resized the panel once.
let heightBeforeCollapse = "";

function collapse() {
  heightBeforeCollapse = panel.style.height;
  panel.style.height = "";
  panel.classList.add("is-collapsed");
  paintToggle();
}

function expand() {
  panel.classList.remove("is-collapsed", "is-tucked");
  if (heightBeforeCollapse !== "") panel.style.height = heightBeforeCollapse;
  paintToggle();
}

// Folded or not is a preference, so it is kept - but only when somebody said
// so. The panel opens itself when something is written to the log, and a
// failure taking the screen is not a request to have it open tomorrow.
function remember(collapsed) {
  writeStored(COLLAPSED_KEY, collapsed ? "1" : "0");
}

function paintToggle() {
  const button = document.getElementById("insight-toggle");
  if (!button) return;
  const open = !panel.classList.contains("is-collapsed");
  button.textContent = open ? "▾" : "▴";
  button.setAttribute("aria-expanded", String(open));
  const label = open ? "Hide the panel" : "Show the panel";
  button.title = label;
  button.setAttribute("aria-label", label);
}

const HEIGHT_KEY = "abap2ui5-playground:insight-height";
const COLLAPSED_KEY = "abap2ui5-playground:insight-collapsed";
const MIN_HEIGHT = 80;

// Where the panel starts when nobody has said. At desk width it is a stripe
// under a tall editor and there is no reason to hide it; on a phone it is a
// third of what the editor has to begin with, and the Problems badge in the
// strip says whether it is worth the room before it takes any.
const NARROW = "(max-width: 820px)";

export function setUpInsight() {
  panel = document.getElementById("insight");
  body = document.getElementById("insight-body");
  tabs = [...panel.querySelectorAll("[data-insight]")];

  setUpResize();

  const toggle = document.getElementById("insight-toggle");
  toggle?.addEventListener("click", () => {
    const open = !panel.classList.contains("is-collapsed");
    if (open) collapse();
    else expand();
    remember(open);
  });

  const stored = readStored(COLLAPSED_KEY);
  if (stored === null ? window.matchMedia(NARROW).matches : stored === "1") collapse();
  paintToggle();

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      // Clicking the tab that is already open collapses the panel - the toggle
      // beside them is the same thing said out loud, for the reader who never
      // guessed that a tab does two things.
      if (tab.dataset.insight === view && !panel.classList.contains("is-collapsed")) {
        collapse();
        remember(true);
        return;
      }
      expand();
      remember(false);
      view = tab.dataset.insight;
      render();
    });
  }

  // Anything written to the log opens the panel on it. This is the one thing
  // that may take the screen without being asked: it is written when a run
  // failed or the page could not start, and a message nobody is shown is the
  // same as no message. That includes an embedded playground, where the panel
  // is otherwise out of the way - an error is not tooling.
  onLogChange((entry) => {
    paintLogDot(entry);
    if (entry.body !== "") {
      expand();
      view = "log";
    }
    render();
  });

  // A click in either list goes to the line it names.
  body.addEventListener("click", (e) => {
    const row = e.target.closest("[data-file]");
    if (!row) return;
    focusProblem(row.dataset.file, Number(row.dataset.line), Number(row.dataset.column));
  });

  // A roundtrip landing while its tab is open is listed as it lands; the
  // badge counts them whichever tab is open.
  onRoundtrip(() => {
    paintRoundtripCount();
    if (view === "roundtrips") render();
  });

  render();
}

// The panel's own height, dragged from its top edge. A config screen or a long
// list of problems wants more room than a glance at the outline does, and the
// only person who knows which is happening is the one looking at it.
function setUpResize() {
  const grip = document.getElementById("insight-grip");
  const stored = Number(readStored(HEIGHT_KEY));
  if (Number.isFinite(stored) && stored >= MIN_HEIGHT) panel.style.height = `${stored}px`;

  const apply = (px) => {
    // Bounded against the page: the editor and the app above have to keep
    // enough room to be themselves, or the drag hands the user a panel with
    // nothing left to look at.
    const room = document.body.getBoundingClientRect().height;
    const height = Math.round(Math.min(Math.max(px, MIN_HEIGHT), room - 120));
    panel.style.height = `${height}px`;
    return height;
  };

  grip.addEventListener("pointerdown", (e) => {
    grip.setPointerCapture(e.pointerId);
    expand();
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
    writeStored(HEIGHT_KEY, String(apply(panel.getBoundingClientRect().bottom - e.clientY)));
  };
  grip.addEventListener("pointerup", stop);
  grip.addEventListener("pointercancel", stop);

  // A drag handle is a control, so it answers the keyboard as one.
  grip.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowUp" ? 24 : e.key === "ArrowDown" ? -24 : 0;
    if (step === 0) return;
    e.preventDefault();
    expand();
    writeStored(HEIGHT_KEY, String(apply(panel.getBoundingClientRect().height + step)));
  });
}

// Brings one tab to the front. Used where the page has something specific for
// the reader to look at and knows which view holds it.
export function showInsight(which) {
  if (!panel || !VIEWS[which]) return;
  expand();
  view = which;
  render();
}

// Called whenever the editor changed. `problems` is what refresh() returned, so
// the panel never runs a checker itself - one analysis, two readers.
export function updateInsight(problems) {
  lastProblems = problems ?? [];
  paintCount();
  // The config views hold half-typed text somebody is in the middle of - a
  // rerender under their hands would throw it away on every keystroke.
  if (view === "problems" || view === "outline" || view === "view") render();
}

// A dot on the Log tab while there is something unread in it, so switching
// away does not hide that something went wrong.
function paintLogDot(entry = currentLog()) {
  const dot = document.getElementById("log-dot");
  if (!dot) return;
  const has = entry.body !== "";
  dot.textContent = has ? "!" : "";
  dot.className = `insight-badge${has ? " is-error" : ""}`;
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
  view: viewPreview,
  roundtrips: roundtripView,
  log: logView,
  abaplint: abaplintConfig,
  abap2ui5: linterConfig,
};

function render() {
  if (!panel) return;
  for (const tab of tabs) {
    const active = tab.dataset.insight === view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  }
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
  button.addEventListener("click", async () => {
    button.disabled = true;
    // Both checkers rewrite the source, so this is somebody's code being
    // changed under them. It goes in as one edit per file, which is what makes
    // Ctrl+Z take the whole thing back rather than unpicking it fix by fix.
    const fixed = await applyFixes();
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
    const row = document.createElement("button");
    row.type = "button";
    row.className = `insight-row is-symbol depth-${symbol.depth}`;
    row.dataset.file = file;
    row.dataset.line = String(symbol.line);
    row.dataset.column = "1";

    const kind = document.createElement("span");
    kind.className = "insight-kind";
    kind.textContent = symbol.kind;

    const name = document.createElement("span");
    name.className = "insight-what";
    name.textContent = symbol.name;

    row.append(kind, name);
    item.append(row);
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

// The outline comes from the registry worker, so it is a round trip: what is
// rendered is the last answer for this file at this version, and a newer one
// is asked for and rendered when it lands. A file mid-edit can be
// unparseable, and an outline is not worth an exception - the underlines
// already say what is wrong - so a failed answer is an empty one.
let outline = { key: undefined, symbols: [] };
let outlineAsked;

function outlineOf(file) {
  if (!file) return [];
  const key = `${file}@${fileVersion(file)}`;
  if (outline.key === key) return outline.symbols;
  if (outlineAsked !== key) {
    outlineAsked = key;
    documentSymbols(file)
      .then((symbols) => flatten(symbols, 0))
      .catch(() => [])
      .then((symbols) => {
        outline = { key, symbols };
        if (view === "outline" && `${currentFile()}@${fileVersion(currentFile())}` === key) render();
      });
  }
  try {
    return outline.symbols;
  } catch {
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

// ------------------------------------------------------------------- view

// The XML the builder chain in the open file produces, as the abap2UI5
// linter reconstructs it - without running a line of ABAP, so it follows
// the typing. Not the view the app rendered: that one is in the Roundtrips
// tab, where it arrived. This is the answer to "what does this chain make",
// one element per line, which is the fastest way to learn the builder.
function viewPreview() {
  const file = currentFile();
  const source = file ? getSource(file) : undefined;
  if (source === undefined) return empty("Nothing to show yet.");
  const { docs, notes, loaded } = viewsFor(source);
  if (!loaded) return empty("The abap2UI5 linter is still loading - the view appears when it has.");
  if (docs.length === 0) {
    return empty("This file builds no view with z2ui5_cl_ui5_view_builder - nothing to reconstruct.");
  }

  const wrap = document.createElement("div");
  wrap.className = "view-preview";
  docs.forEach((doc, i) => {
    const pretty = prettyXml(doc);
    const head = document.createElement("div");
    head.className = "log-head";
    const title = document.createElement("span");
    title.className = "log-title";
    title.textContent = docs.length === 1 ? "The view this file builds" : `View ${i + 1} of ${docs.length}`;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ghost";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      copy.textContent = (await copyToClipboard(pretty)) ? "copied" : "Copy";
    });
    head.append(title, copy);
    const body = document.createElement("pre");
    body.className = "log-body view-xml";
    body.textContent = pretty;
    wrap.append(head, body);
  });
  if (notes.length > 0) {
    const said = document.createElement("p");
    said.className = "config-blurb view-notes";
    said.textContent = notes.join(" · ");
    wrap.append(said);
  }
  return wrap;
}

// ------------------------------------------------------------------ config

// The two checkers' settings, as text you can edit. JSON rather than a wall of
// switches: abaplint has 188 rules and the playground runs nine of them, so a
// checkbox per rule would be a screen nobody reads to reach a setting nobody
// wanted. What a reader actually asks is "why is it not warning here" - and
// the answer is to add the rule name and press Apply.
function configEditor({ title, blurb, value, onApply, onKeep, onReset, extra }) {
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

  apply.addEventListener("click", async () => {
    // Changing abaplint's rules dirties every object in the corpus, so applying
    // them is the startup parse over again - seconds, during which the button
    // must not be pressable a second time and the panel should say what is
    // going on rather than appear to have ignored the click.
    if (apply.disabled) return;
    apply.disabled = true;
    reset.disabled = true;
    said.className = "config-said";
    said.textContent = "applying…";
    try {
      const parsed = JSON.parse(area.value);
      // Whether this is asynchronous is the checker's business, not this
      // function's: abaplint's half yields while it reparses, the linter's is
      // a field assignment. Awaiting covers both.
      await onApply(parsed, (done, total) => {
        said.textContent = `applying… ${Math.round((done / total) * 100)}%`;
      });
      // Kept only once the checker accepted it, so a rejected edit is not
      // what greets somebody on their next visit.
      onKeep(parsed);
      // The text did not change, the rules did - and the editor keys its kept
      // analysis on the text alone. Without this the count below would be the
      // one from before the change, which is precisely the number this tab
      // exists to move.
      invalidateAnalysis();
      // The panel says what changed rather than only that something did: the
      // whole point of the tab is understanding why a message is or is not
      // there, so the count is the answer.
      const problems = refresh();
      updateInsight(problems);
      said.textContent = `applied - ${problems.length} problem${problems.length === 1 ? "" : "s"} now`;
    } catch (e) {
      said.className = "config-said is-error";
      said.textContent = String(e.message || e);
    } finally {
      apply.disabled = false;
      reset.disabled = false;
    }
  });

  reset.addEventListener("click", () => {
    area.value = JSON.stringify(onReset(), null, 2);
    apply.click();
  });

  return wrap;
}

// Where the rules come from, for a reader who wants the whole list rather than
// the nine the playground runs.
function docsLink(href, text) {
  const p = document.createElement("p");
  p.className = "config-link";
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = text;
  p.append(a);
  return p;
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

  const links = document.createElement("div");
  links.append(
    docsLink("https://rules.abaplint.org", "Every rule, with what it does and why — rules.abaplint.org"),
    docsLink("https://github.com/abaplint/abaplint", "abaplint on GitHub"),
  );

  return configEditor({
    blurb:
      "What the editor checks. The playground runs the rules that answer " +
      "“would this work”, not the ones that answer “is this the house style” - " +
      "but any of abaplint's rules can be added here. version is the ABAP release the " +
      "syntax check holds you to.",
    value: abaplintSettings(),
    onApply: applyAbaplintSettings,
    onKeep: keepAbaplintSettings,
    onReset: abaplintDefaults,
    extra: appended(links, note),
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
    onKeep: keepLinterSettings,
    onReset: linterDefaults,
    extra: appended(
      docsLink("https://github.com/abap2UI5/linter", "The abap2UI5 linter, its rules and its config file"),
      docsLink("https://www.npmjs.com/package/@abap2ui5/linter", "@abap2ui5/linter on npm"),
    ),
  });
}

// Several bits of trailing matter as one node, because configEditor takes one.
function appended(...nodes) {
  const box = document.createElement("div");
  box.append(...nodes);
  return box;
}

// ------------------------------------------------------------- roundtrips

function paintRoundtripCount() {
  const badge = document.getElementById("roundtrip-count");
  if (!badge) return;
  const list = roundtripList();
  const failed = list.some((r) => r.status >= 400);
  badge.textContent = list.length === 0 ? "" : String(list.length);
  badge.className = `insight-badge${failed ? " is-error" : ""}`;
}

// Which roundtrip is opened up in the list, by its number; a new Run starts
// the numbering over, so a stale selection simply matches nothing.
let openedRoundtrip;

// The conversation between the frontend and the app, one row per roundtrip:
// the event, how long the ABAP took, and what the answer did - a view, a
// popup, a model update, a dump. A row opens up into the request and the
// response as they travelled, and the view XML the answer carried, one
// element per line.
function roundtripView() {
  const list = roundtripList();
  if (list.length === 0) {
    return empty("Nothing yet. Every request the app sends and every answer it gets lands here, with the time the ABAP took.");
  }

  const wrap = document.createElement("div");
  wrap.className = "roundtrips";

  const rows = document.createElement("ul");
  rows.className = "insight-list";
  for (const entry of list) {
    const item = document.createElement("li");
    item.className = "roundtrip-item";
    const row = document.createElement("button");
    row.type = "button";
    row.className = `insight-row roundtrip-row${entry.status >= 400 ? " is-error" : ""}${entry.n === openedRoundtrip ? " is-open" : ""}`;
    row.setAttribute("aria-expanded", String(entry.n === openedRoundtrip));

    const n = document.createElement("span");
    n.className = "insight-where";
    n.textContent = `#${entry.n}`;

    const what = document.createElement("span");
    what.className = "insight-what";
    what.textContent = entry.args.length > 0 ? `${entry.event} (${entry.args.join(", ")})` : entry.event;

    const did = document.createElement("span");
    did.className = "roundtrip-did";
    did.textContent = entry.did.join(" · ");

    const ms = document.createElement("span");
    ms.className = "insight-who";
    ms.textContent = `${entry.ms} ms`;

    row.append(n, what, did, ms);
    row.addEventListener("click", () => {
      openedRoundtrip = openedRoundtrip === entry.n ? undefined : entry.n;
      render();
    });
    item.append(row);
    if (entry.n === openedRoundtrip) item.append(roundtripDetail(entry));
    rows.append(item);
  }
  wrap.append(rows);
  return wrap;
}

function roundtripDetail(entry) {
  const detail = document.createElement("div");
  detail.className = "roundtrip-detail";
  const block = (title, text) => {
    const head = document.createElement("div");
    head.className = "log-head";
    const label = document.createElement("span");
    label.className = "log-title";
    label.textContent = title;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ghost";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      copy.textContent = (await copyToClipboard(text)) ? "copied" : "Copy";
    });
    head.append(label, copy);
    const pre = document.createElement("pre");
    pre.className = "log-body roundtrip-body";
    pre.textContent = text;
    detail.append(head, pre);
  };
  for (const view of entry.views) block(`View for slot ${view.slot}`, prettyXml(view.xml));
  block("Request", asText(entry.request));
  block(entry.status >= 400 ? `Response (${entry.status})` : "Response", asText(entry.response));
  return detail;
}

const asText = (value) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

// ------------------------------------------------------------------- log

function logView() {
  const entry = currentLog();
  if (entry.body === "") {
    return empty("Nothing has gone wrong yet. Startup notes, ABAP errors and dumps land here.");
  }

  const wrap = document.createElement("div");
  wrap.className = "log";

  const head = document.createElement("div");
  head.className = "log-head";

  const title = document.createElement("span");
  title.className = "log-title";
  title.textContent = entry.title;

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "ghost";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => hideOutput());

  head.append(title, clear);

  const body = document.createElement("pre");
  body.className = "log-body";
  body.textContent = entry.body;

  wrap.append(head, body);
  return wrap;
}
