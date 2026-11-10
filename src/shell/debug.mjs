// The debugger, as the rest of the page sees it - kept small on purpose:
// this module is in the shell entry, on every page, and the debugger itself
// (its tab, the breakpoints, stepping, the variables) is a chunk,
// src/shell/debugger.mjs, fetched once the playground's own page is up.
//
// Only the playground's own page offers it. An embed, an app-only page and
// the AI pages run the plain build: a stop nobody can see or continue would
// hang a documentation page, and the AI's Run waits for the app to start.
// There `BREAK-POINT` is the JavaScript `debugger;` it always was.
import { appOnly, keepsDrafts } from "./page.mjs";
import { blockHead, empty, redraw, redrawIf } from "./insight-common.mjs";
import * as editor from "../editor/editor.mjs";
import { readStoredJson, removeStored, writeStoredJson } from "./storage.mjs";
import { setStatus } from "./ui.mjs";
import { state } from "./state.mjs";

export const offersDebugger = keepsDrafts && !appOnly;

let ui;
let loading;

// Fetches the chunk and hands it what it needs of the page (the chunk rule
// in docs/design/load-time.md: it imports no shell module). Called once the
// runtime is up; `showInsight` brings the panel's Debugger tab forward.
export function setUpDebugger(showInsight) {
  if (!offersDebugger) return Promise.resolve();
  const tab = document.querySelector('[data-insight="debug"]');
  tab?.removeAttribute("hidden");
  loading ??= import("./debugger.mjs").then((m) => {
    ui = m.setUpDebugger({
      runtime: () => state.runtime,
      editor,
      redraw,
      redrawIf,
      showTab: () => showInsight("debug"),
      empty,
      blockHead,
      setStatus,
      storage: {
        read: readStoredJson,
        write: (key, value) => (value === null ? removeStored(key) : writeStoredJson(key, value)),
      },
      dot: document.getElementById("debug-dot"),
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
export const compileOptions = () => ({ debug: offersDebugger });
let lastCompiled;
export const debugCompiled = (result) => {
  lastCompiled = result;
  ui?.compiled(result);
};

// Whether the program is stopped at a breakpoint, and Stop - which a Run
// asks for before it starts anything new.
export const debugPaused = () => ui?.paused() ?? false;
export const stopDebugging = () => ui?.stop();
