// What the status line says between runs, and what the app frame says about
// the app in it.
//
// The status line is written by everybody (ui.mjs, setStatus( )), and most of
// it is the word of the moment: "compiling…", "formatted 2 files". What it
// comes back to is the RESTING sentence - "running" after a run that
// started an app - and two things made that sentence untrue without anything
// on screen changing:
//
// - The code. Deleting the full stop at the end of a statement put markers
//   in the editor and a red count on the Problems tab, and the line beside
//   Run still said "running" - which it was, the code from before the edit.
//   So once an app is up, the line follows the abaplint errors in the code on
//   screen and says how many there are, and goes back to the resting
//   sentence when they are gone. Only abaplint's errors: they are what stops
//   Run (run.mjs), and an abap2UI5 finding is an app that runs.
// - A Run that stopped. abaplint's errors, a class the transpiler refused or
//   an app that would not start all leave the PREVIOUS app in the frame,
//   fully alive, with nothing to say it is not the code in the editor. The
//   frame is dimmed and labelled until a run starts an app again - dimmed and
//   not covered, because the old app is still worth using: it is often the
//   quickest way to see what the edit was meant to change.
import { setStatus } from "./ui.mjs";

const statusEl = () => document.getElementById("status");

// The sentence the line rests on while an app is running, and whether the
// last run left one running at all.
let resting = { text: "", isError: false };
let appRunning = false;
// What the code on screen has, as the last analysis said.
let codeErrors = 0;
// The sentence this module wrote, so it is only ever replaced by itself.
let saidErrors;
// The errors sentence waiting for a word of the moment to be read.
let errorsTimer;

const errorsSentence = (n) => `running - the code on screen has ${n} error${n === 1 ? "" : "s"}`;

/** A run has started: until it says how it went, no app is the resting one. */
export function runStarting() {
  clearTimeout(errorsTimer);
  appRunning = false;
  saidErrors = undefined;
}

/** A run started an app: `text` is what the line rests on from now on. */
export function sayRunning(text = "running", isError = false) {
  appRunning = true;
  resting = { text, isError };
  saidErrors = undefined;
  setStatus(text, isError);
}

/** Whether an app the last run started is running. */
export const isAppRunning = () => appRunning;

// Counted the way Run counts them, so the line and Run never disagree.
export const abaplintErrors = (problems) =>
  (problems ?? []).filter((p) => p.severity === 1 && p.source === "abaplint").length;

/** A fresh analysis of the code on screen. Says the errors over the resting
 *  sentence - never over an error somebody else said (a dump, a failed run),
 *  which is the more urgent of the two - and takes them away again. */
export function reflectCodeErrors(problems) {
  codeErrors = abaplintErrors(problems);
  clearTimeout(errorsTimer);
  if (!appRunning) return;
  const el = statusEl();
  const ours = saidErrors !== undefined && el.textContent === saidErrors;
  if (codeErrors > 0) {
    if (!ours && el.classList.contains("error")) return;
    // Over the resting sentence or its own at once; over a word of the
    // moment ("formatted 2 files - Ctrl+Z takes it back") only once that has
    // been read - the analysis lands a moment after every edit, Format's
    // included, and wiped the word before anybody saw it.
    if (ours || el.textContent === resting.text || el.textContent === "") {
      saidErrors = errorsSentence(codeErrors);
      setStatus(saidErrors);
    } else {
      const word = el.textContent;
      errorsTimer = setTimeout(() => {
        if (statusEl().textContent !== word || statusEl().classList.contains("error")) return;
        if (!appRunning || codeErrors === 0) return;
        saidErrors = errorsSentence(codeErrors);
        setStatus(saidErrors);
      }, BRIEFLY_MS);
    }
  } else if (ours) {
    saidErrors = undefined;
    setStatus(resting.text, resting.isError);
  }
}

// What the line comes back to after a word of the moment.
function restingNow() {
  if (appRunning && codeErrors > 0) {
    saidErrors = errorsSentence(codeErrors);
    return { text: saidErrors, isError: false };
  }
  return undefined;
}

// A word of the moment: said, and taken away again after a few seconds unless
// something else has been said meanwhile. "link copied to the clipboard" used
// to stand in the line until the next action, which read as though the copy
// were still happening - or as the state of the app.
const BRIEFLY_MS = 4000;
let brieflyTimer;
export function sayBriefly(text, isError = false) {
  const el = statusEl();
  const before = { text: el.textContent, isError: el.classList.contains("error") };
  setStatus(text, isError);
  clearTimeout(brieflyTimer);
  brieflyTimer = setTimeout(() => {
    if (statusEl().textContent !== text) return;
    const back = restingNow() ?? (appRunning ? resting : before);
    setStatus(back.text, back.isError);
  }, BRIEFLY_MS);
}

// ------------------------------------------------------------ the app frame

const appFrame = () => document.querySelector(".app-frame");

/** The app in the frame is not the code on screen: `why` says how. */
export function markAppStale(why) {
  const box = appFrame();
  const badge = document.getElementById("app-stale");
  if (!box || !badge) return;
  box.classList.add("is-stale");
  badge.textContent = `This is the last app that ran - ${why}`;
  badge.hidden = false;
}

/** A run started an app: the frame is the code on screen again. */
export function clearAppStale() {
  appFrame()?.classList.remove("is-stale");
  const badge = document.getElementById("app-stale");
  if (badge) badge.hidden = true;
}
