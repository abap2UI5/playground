// The debugger, as the rest of the page sees it - kept small on purpose:
// this module is in the shell entry, on every page, and the debugger itself
// (its tab, the breakpoints, stepping, the variables) is a chunk,
// src/shell/debugger.mjs, fetched once the playground's own page is up.
//
// The playground's own page offers it, and an embed whose page asked for it
// (`?debug=1`). An app-only page and the AI Agent's run the plain build: a
// stop nobody can see or continue would hang a documentation page. The AI
// App Builder's page runs the debug build for the model's `inspect` tool,
// with BREAK-POINT switched off. Where the build is plain, `BREAK-POINT` is
// the JavaScript `debugger;` it always was.
import { aiPage, appOnly, embedded, embedDebug, keepsDrafts } from "./page.mjs";
import { blockHead, empty, redraw, redrawIf } from "./insight-common.mjs";
import * as editor from "../editor/editor.mjs";
import { readStoredJson, removeStored, writeStoredJson } from "./storage.mjs";
import { setStatus } from "./ui.mjs";
import { state } from "./state.mjs";

// An embed only when its page asked for it (`?debug=1`, data-debug on the
// loader's element) - then it is somebody's tutorial showing a roundtrip.
export const offersDebugger = (keepsDrafts || embedDebug) && !appOnly;

let ui;
let loading;

// Fetches the chunk and hands it what it needs of the page (the chunk rule
// in docs/design/load-time.md: it imports no shell module). Called once the
// runtime is up; `showInsight` brings the panel's Debugger tab forward, and
// `showCode` the editor's pane on a phone, where the app has the screen, and
// `rerun` is how Stop starts the app again.
export function setUpDebugger(showInsight, showCode = () => {}, rerun = undefined) {
  // The AI App Builder's page runs the debug build with nothing on screen to
  // continue a stop: BREAK-POINT in the model's code must not hold its Run.
  if (aiPage && !embedded) state.runtime?.debug("options", { raise: false, statements: false }).catch(() => {});
  if (!offersDebugger) return Promise.resolve();
  const tab = document.querySelector('[data-insight="debug"]');
  tab?.removeAttribute("hidden");
  loading ??= import("./debugger.mjs").then((m) => {
    ui = m.setUpDebugger({
      runtime: () => state.runtime,
      editor,
      redraw,
      redrawIf,
      showTab: () => {
        showCode();
        showInsight("debug");
      },
      empty,
      blockHead,
      setStatus,
      // Kept with the draft on the playground's page; an embed never reads
      // or writes the stored settings (AGENTS.md), its breakpoints included.
      storage: keepsDrafts
        ? { read: readStoredJson, write: (key, value) => (value === null ? removeStored(key) : writeStoredJson(key, value)) }
        : { read: () => undefined, write: () => {} },
      dot: document.getElementById("debug-dot"),
      // Run, once the run the Stop ended has let go (runWhenFree( )).
      rerun,
    });
    if (lastCompiled) ui.compiled(lastCompiled);
    redrawIf("debug");
  });
  return loading;
}

// Run waits for the chunk before it starts anything (run.mjs): a breakpoint
// kept from the last visit, in the app's first roundtrip, has to be in the
// worker before that roundtrip runs. Fetched beside the corpus, it is there
// long before; a chunk that fails to arrive costs the debugger, not the Run.
export const debuggerReady = () => (loading ?? Promise.resolve()).catch(() => {});

// The Debugger tab in the panel (insight.mjs).
export const debugTab = () => ui?.tab() ?? empty("The debugger is loading…");

// What Run asks of the compile, and tells the debugger after it.
// The AI App Builder's page runs the debug build too, without the debugger
// on screen: its `inspect` tool stops the app at a line (agent-hooks.mjs).
export const compileOptions = () => ({ debug: offersDebugger || (aiPage && !embedded) });
let lastCompiled;
// Where the last debug build can stop, per file (transpile-core.mjs).
export const lastStops = () => lastCompiled?.stops;
export const debugCompiled = (result) => {
  lastCompiled = result;
  ui?.compiled(result);
};

// Whether the program is stopped at a breakpoint, and Stop - which a Run
// asks for before it starts anything new.
export const debugPaused = () => ui?.paused() ?? false;
export const stopDebugging = () => ui?.stop({ rerun: false });
