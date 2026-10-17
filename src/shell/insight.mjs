// The panel under the editor: what is wrong, and what is in the file.
//
// Several views of the same source, sharing one strip because they answer the
// questions a reader has while looking at a class - "is anything broken",
// "where is the method I want", "what did the app just do". All of them are
// derived, never stored: they are rebuilt from the editor and the runtime on
// every change, so there is no second copy of the truth to go stale.
//
// This module is the panel itself - the strip, folding it away, the drag that
// sizes it, and the redraw that keeps the reader's place. Every tab is a
// module of its own that draws one view (the VIEWS table below names them),
// and insight-common.mjs is what a tab may ask of the panel in return.
import { currentFile, focusProblem, onFileShown } from "../editor/editor.mjs";
import { readStored, writeStored } from "./storage.mjs";
import { onLogChange } from "./ui.mjs";
import { connectPanel } from "./insight-common.mjs";
import { problemsTab, setProblems } from "./insight-problems.mjs";
import { outlineTab } from "./insight-outline.mjs";
import { fileShown, viewTab } from "./insight-view.mjs";
import { testsTab } from "./insight-tests.mjs";
import { followRoundtrips, roundtripsTab } from "./insight-roundtrips.mjs";
import { consoleTab } from "./insight-console.mjs";
import { logTab, paintLogDot } from "./insight-log.mjs";
import { abaplintTab, linterTab } from "./insight-config.mjs";

export { setTestResults } from "./insight-tests.mjs";

let panel;
let body;
let tabs;
let view = "problems";

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

// The panel's height held to the window it is in now (setUpResize( )). A
// height kept from a taller window - stored, or from before a collapse - left
// the editor squeezed to nothing and the panel cut off at the bottom.
let refit = () => {};

function expand() {
  panel.classList.remove("is-collapsed", "is-tucked");
  if (heightBeforeCollapse !== "") panel.style.height = heightBeforeCollapse;
  refit();
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

  connectPanel({ view: () => view, render, update: updateInsight });

  // The View tab's edit is about one file's chain; showing another file ends
  // it, on the switch itself (insight-view.mjs says why).
  onFileShown(() => fileShown(currentFile()));

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
  //
  // A CLEARED log (every run starts by clearing it) redraws only the Log tab
  // itself. It used to redraw whatever tab was open, and the Config tabs are
  // a textarea rebuilt from the stored settings - so Ctrl+Enter, or autorun,
  // in the middle of editing that JSON threw the edit away.
  onLogChange((entry) => {
    paintLogDot(entry);
    if (entry.body !== "") {
      expand();
      view = "log";
      render();
    } else if (view === "log") {
      render();
    }
  });

  // A click in either list goes to the line it names.
  body.addEventListener("click", (e) => {
    const row = e.target.closest("[data-file]");
    if (!row) return;
    focusProblem(row.dataset.file, Number(row.dataset.line), Number(row.dataset.column));
  });

  // A roundtrip landing while the Roundtrips or the Console tab is open is
  // drawn as it lands; the badges count them whichever tab is open.
  followRoundtrips(body);

  render();
}

// The panel's own height, dragged from its top edge. A config screen or a long
// list of problems wants more room than a glance at the outline does, and the
// only person who knows which is happening is the one looking at it.
function setUpResize() {
  const grip = document.getElementById("insight-grip");

  const apply = (px) => {
    // Bounded against the page: the editor and the app above have to keep
    // enough room to be themselves, or the drag hands the user a panel with
    // nothing left to look at.
    const room = document.body.getBoundingClientRect().height;
    const height = Math.round(Math.min(Math.max(px, MIN_HEIGHT), room - 120));
    panel.style.height = `${height}px`;
    // What a screen reader is told about the separator: it said 50 of 100
    // for ever, whatever the panel's height.
    grip.setAttribute("aria-valuenow", String(height));
    grip.setAttribute("aria-valuemax", String(Math.max(MIN_HEIGHT, Math.round(room - 120))));
    return height;
  };

  // The stored height is the reader's choice for a window of the size they
  // made it in; in a smaller one it is held to what fits, and the choice is
  // kept for when the window is large again - nothing is written back here.
  refit = () => {
    if (!panel.style.height || panel.classList.contains("is-collapsed")) return;
    // A document with no layout yet (a frame not shown) has no room to measure.
    if (document.body.getBoundingClientRect().height === 0) return;
    apply(parseFloat(panel.style.height));
  };
  const stored = Number(readStored(HEIGHT_KEY));
  if (Number.isFinite(stored) && stored >= MIN_HEIGHT) {
    panel.style.height = `${stored}px`;
    refit();
  }
  addEventListener("resize", refit);

  grip.addEventListener("pointerdown", (e) => {
    // The primary button only, as on the splitter (src/shell/layout.mjs): a
    // right click's pointerup goes to the context menu and left the grip
    // dragging until it was touched again.
    if (e.button !== 0 || !e.isPrimary) return;
    grip.setPointerCapture(e.pointerId);
    // Opened by hand is a request to have it open, as the toggle's is.
    if (panel.classList.contains("is-collapsed")) remember(false);
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
    // A cancelled pointer's position is not one (often 0, 0, which is the
    // tallest panel there is): what the last move applied is what is kept.
    const height = e.type === "pointercancel"
      ? Math.round(panel.getBoundingClientRect().height)
      : apply(panel.getBoundingClientRect().bottom - e.clientY);
    writeStored(HEIGHT_KEY, String(height));
  };
  grip.addEventListener("pointerup", stop);
  grip.addEventListener("pointercancel", stop);

  // A drag handle is a control, so it answers the keyboard as one.
  grip.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowUp" ? 24 : e.key === "ArrowDown" ? -24 : 0;
    if (step === 0) return;
    e.preventDefault();
    if (panel.classList.contains("is-collapsed")) remember(false);
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
  setProblems(problems);
  // The config views hold half-typed text somebody is in the middle of - a
  // rerender under their hands would throw it away on every keystroke.
  if (view === "problems" || view === "outline" || view === "view") render();
}

// Each tab, by its data-insight name, and the function that draws it.
const VIEWS = {
  problems: problemsTab,
  outline: outlineTab,
  view: viewTab,
  tests: testsTab,
  roundtrips: roundtripsTab,
  console: consoleTab,
  log: logTab,
  abaplint: abaplintTab,
  abap2ui5: linterTab,
};

// Which view the body last drew, so a redraw of the SAME view - every edit
// redraws Problems, Outline and View, twice - keeps the reader's place.
let rendered;

function render() {
  if (!panel) return;
  for (const tab of tabs) {
    const active = tab.dataset.insight === view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  // A reader working down a long problem list or outline was thrown back
  // up it and lost the focused row on every keystroke in the editor. The
  // scroll offset and the focused row (by the file and line it names) are
  // carried over the redraw of the same view; a different view starts at
  // its top.
  const same = rendered === view;
  const top = body.scrollTop;
  const focused = body.contains(document.activeElement) ? document.activeElement.closest?.("[data-file][data-line]") : null;
  const at = focused ? { file: focused.dataset.file, line: focused.dataset.line } : undefined;
  // Rows that name no line (a roundtrip, its Copy buttons) carry a key of
  // their own instead: Enter on a roundtrip, or the next one landing every
  // second from a timer app, dropped the focus to <body>.
  const keyed = body.contains(document.activeElement) ? document.activeElement.closest?.("[data-focus]")?.dataset.focus : undefined;
  // And the one element that is not rebuilt but put back: the View tab's
  // editor (viewPreview( ) hands the same node over). Taken out of the
  // document and put back, it had lost the focus - a Run from inside it
  // (Ctrl+Enter, Ctrl+S) redraws the panel, and what was typed next went
  // nowhere. Its caret and scroll go with it.
  const kept = body.contains(document.activeElement) ? document.activeElement : null;
  const caret = kept instanceof HTMLTextAreaElement
    ? { start: kept.selectionStart, end: kept.selectionEnd, direction: kept.selectionDirection, top: kept.scrollTop }
    : undefined;
  body.replaceChildren((VIEWS[view] ?? problemsTab)());
  rendered = view;
  if (kept && kept !== document.activeElement && body.contains(kept)) {
    kept.focus({ preventScroll: true });
    if (caret) {
      kept.setSelectionRange(caret.start, caret.end, caret.direction);
      kept.scrollTop = caret.top;
    }
  }
  if (!same) return;
  body.scrollTop = top;
  if (at) {
    const again = [...body.querySelectorAll("[data-file][data-line]")]
      .find((el) => el.dataset.file === at.file && el.dataset.line === at.line);
    again?.focus({ preventScroll: true });
  } else if (keyed !== undefined) {
    [...body.querySelectorAll("[data-focus]")].find((el) => el.dataset.focus === keyed)?.focus({ preventScroll: true });
  }
}
