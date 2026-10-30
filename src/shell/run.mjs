// Run: the code in the editor, compiled, defined in the runtime, tested, and
// started as a fresh app in the frame - and what the page says about how
// that went. Also the app frame's theme, and a dump pointed at in the editor,
// which are the two other things the page does to the app it started.
//
// One run at a time (`running`), shared with the AI Pilot's further apps
// (withRunLock( )), and the Run button told whenever that changes - the
// button's state is autorun.mjs's, because Auto is one of the reasons for it.
import {
  focusProblem,
  getFiles,
  refresh,
  refreshNow,
  reportTranspilerProblems,
} from "../editor/editor.mjs";
import { declaredObjectName, entryClass } from "../editor/registry.mjs";
import { compile } from "../editor/transpile.mjs";
import { parseName } from "../editor/files.mjs";
import { setTestResults, showInsight, updateInsight } from "./insight.mjs";
import { announceAppHeight, announceProblems } from "./embed.mjs";
import { clearRoundtrips, roundtripList } from "./roundtrips.mjs";
import { markLinkedCodeRan } from "./linked-code.mjs";
import { state } from "./state.mjs";
import { RUNAWAY } from "./runtime-client.mjs";
import { isDark } from "./theme.mjs";
import { hideOutput, setStatus, showOutput } from "./ui.mjs";
import { appOnly, frame, pilotPage } from "./page.mjs";
import { fromALink } from "./starting-files.mjs";
import { cancelAutorun, reflectRunButton } from "./autorun.mjs";
import { linkOf, navigate, tellFrames } from "./frame-link.mjs";
import { clearAppStale, markAppStale, runStarting, sayRunning } from "./run-status.mjs";

// What run( ) needs of the page that boot( ) only knows later: the AI Pilot's
// room, when this is its page, and where the editor's first files came from.
let context = { pilot: null, startedFrom: undefined };
export const setRunContext = (given) => {
  context = { ...context, ...given };
};

// The frame used to be reloaded on every Run, because a reload was the only
// thing that reset everything the frontend keeps outside the model - view
// slots, routing state, the UI5 component itself. The frontend's component
// tears all of that down in its exit( ) now (it is built to be re-launched
// in a living page), so a frame that is up is told to restart in place
// (restart( ) in frontend-bridge.js, asked by message): the component destroyed
// and created again on the new Run's address, the UI5 core, the libraries
// and the theme kept - which is most of what a Run used to wait for. The
// first Run, and any frame whose bridge has not spoken (an error page), not
// booted, or not yet loaded, loads the document as before; so does one
// whose restart fails. The counter in the address is the same either way: it is what a
// late roundtrip from the app being replaced is refused by.
let running = false;
// The files the last run started from, as text - see autorunAfterChange( ).
let lastRunText;
// The Run autorun started on its own, by its number, while it is the current
// one - see run( ) and caretMayMove( ).
let quietRun;
// What the last run's unit tests said, for runForAgent( ).
let lastTestResults = [];
// Whether a run has put an app in the frame - which is what a run that then
// stops leaves there, and has to say is not the code on screen.
let appUp = false;

export const isRunning = () => running;
export const lastRun = () => lastRunText;
export const lastTests = () => lastTestResults;

export const uiTheme = () => (isDark() ? "sap_horizon_dark" : "sap_horizon");

// A theme change - the switch in the bar, or the sun going down on a page that
// follows the system - must not restart the app: somebody has a half-filled
// form open. UI5 can swap its theme at runtime, so the running frame is told
// rather than reloaded - every app frame of the page, by message (a frame
// that is mid-load keeps the theme its address gave it; the next Run picks
// the current one up).
export function applyFrameTheme() {
  tellFrames({ type: "theme", theme: uiTheme() });
}

// Run, once the run under way (if any) has finished. A sample opened while
// another one was still starting went into the editor, and its run returned
// at once because one was under way: the editor held one sample and the
// frame ran the other, with "running" in the status line.
//
// Calls that wait share one run: two picks while a run is under way both
// find the editor holding the second, and each waiting to run it on its own
// ran the same text twice - the app the reader had started using reset under
// them by a run nobody asked for. Both still hear how that one run went, so
// the first pick's word about the draft it replaced is still said.
let waitingRun;
export const isRunWaiting = () => waitingRun !== undefined;
export function runWhenFree() {
  if (!running) return run();
  waitingRun ??= (async () => {
    while (running) await new Promise((resolve) => setTimeout(resolve, 100));
    waitingRun = undefined;
    return run();
  })();
  return waitingRun;
}

// The same lock run( ) holds, for work that changes the classes without being
// a Run - the AI Pilot's further apps (agent-hooks.mjs): waits out a run
// under way, keeps the next one out until `work` is done.
export async function withRunLock(work) {
  while (running) await new Promise((resolve) => setTimeout(resolve, 100));
  running = true;
  reflectRunButton();
  try {
    return await work();
  } finally {
    running = false;
    reflectRunButton();
  }
}

// A dump, at the line it was raised at. The framework has already answered
// the frontend with the dump and the frame is showing it; this is the half
// the frame cannot do - underline the line in the editor, list it under
// Problems as a runtime error, and put the cursor there - the way a
// transpiler error is pointed at. It goes away with the next edit, like
// that one.
export function pointAtDump(location, message, moveCaret = true) {
  const said = `${location.exception ? `${location.exception}: ` : ""}${message || "the app dumped here"}`;
  reportTranspilerProblems([{ file: location.file, line: location.line, message: said }], "runtime");
  updateInsight(refresh());
  showInsight("problems");
  if (moveCaret) focusProblem(location.file, location.line, 1);
  setStatus(`the app dumped - ${location.file} line ${location.line}`, true);
}

// Whether a dump may take the caret to its line. Not when it is the answer to
// the first roundtrip of an app autorun started: that roundtrip is the app
// starting, while the reader is still typing in the editor (see run( )). A
// dump from a click in the app later on is the reader's own doing, and is
// pointed at as always.
export const caretMayMove = () => !(quietRun !== undefined && quietRun === state.runCounter && roundtripList().length <= 1);

// The first line of a dump that says something - the framework's dump
// starts with a heading and the request it failed in, and the sentence a
// reader wants is the exception's own text, a few lines down.
export function firstLine(body) {
  const lines = String(body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("---") && !l.startsWith("Request failed in app"));
  return lines[0] ?? "";
}

// What has to be true before the transpiler is worth asking. Each of these
// would otherwise surface as an abaplint message about a filename, which means
// nothing to somebody looking at an editor.
function structuralProblem(files) {
  if (files.length === 0) return "There is nothing to run.";
  const first = parseName(files[0].name);
  if (first?.kind !== "clas" || first.include) {
    return `The playground starts the class in the first file, and ${files[0].name} is not a class.`;
  }
  for (const file of files) {
    const parsed = parseName(file.name);
    // A test include declares local test classes, not the object; abaplint
    // checks what is in it. A table's two files are no ABAP at all.
    if (parsed?.include || parsed?.kind === "tabl") continue;
    const expected = parsed?.object;
    const declared = declaredObjectName(file.source);
    if (declared === undefined) {
      return `${file.name} declares no global class or interface.`;
    }
    if (declared !== expected) {
      return `${file.name} has to declare ${expected}, not ${declared} - the name and the file go together.`;
    }
  }
  return undefined;
}

// Asks the frame to start the new Run's app without reloading its document
// - see frontend-bridge.js. Answers false wherever that cannot be asked: the
// first Run (no document yet), a frame whose bridge never spoke (an error
// page), one that never booted UI5 or has not finished loading; and false
// again when the frame refused or took too long, after which the caller
// reloads it as before. Thirty seconds, like the load it stands in for. What
// the frame reports when asked is what decides (frame-link.mjs).
async function restartInPlace(frame, src) {
  const link = linkOf(frame);
  // Asked, not taken from the last report: the frame reports on a 100ms
  // tick, and right after a document load the last one can be from before
  // UI5 or the bridge's restart were there - a frame that could restart
  // would be reloaded. The bridge reports before it answers, so after this
  // the state is the frame's as of now; a frame that does not answer is
  // decided by what it last said.

  await link.refresh();
  const was = link.state;
  try {
    if (!was?.ui5 || !was.restarts || was.readyState !== "complete" || new URL(was.href).pathname !== src.pathname) return false;
  } catch {
    return false;
  }
  try {
    await link.call("restart", [src.href], 30000);
    frame.dataset.src = src.href;
    return true;
  } catch (e) {
    showOutput("Run", `The app frame could not restart in place and is reloaded instead: ${String(e?.message ?? e)}`);
    return false;
  }
}

// Loads the Run's address into the frame and waits for it - the path for the
// first Run and for any frame restartInPlace( ) could not ask.
//
// Bounded, because everything in run() hangs off this one event: if the
// frame never fires it, `running` would stay true and Run would be dead
// until a full reload. Thirty seconds is an eternity for a same-origin
// document - reaching it means the load is not coming.
function loadFrame(src) {
  return new Promise((resolve, reject) => {
    const loaded = () => {
      clearTimeout(gaveUp);
      resolve();
    };
    // Taken off again when it gives up, or the next run's load would fire
    // this one as well - one more stale listener per timed-out run.
    //
    // Thirty seconds, unless the frame is visibly still arriving: on a slow
    // first visit (Slow 3G, nothing cached) the frame's first load is two
    // megabytes, the run gave up on it at thirty seconds and the app came
    // up forty-five seconds later under "the app could not be started".
    // A frame that is on this run's address and still loading is given
    // more time, ten seconds at a turn, up to three minutes in all.
    const started = Date.now();
    let gaveUp;
    const check = () => {
      // What the frame's bridge last said of itself (an error page says
      // nothing: not arriving).
      const now = linkOf(frame).state;
      const arriving = now?.href === src.href && now.readyState !== "complete";
      if (arriving && Date.now() - started < 180000) {
        gaveUp = setTimeout(check, 10000);
        return;
      }
      frame.removeEventListener("load", loaded);
      reject(new Error("The app frame did not load."));
    };
    gaveUp = setTimeout(check, 30000);
    frame.addEventListener("load", loaded, { once: true });
    // A REPLACE, not a navigation that pushes (navigate( ) in
    // frame-link.mjs): past Chromium's fifty entries of old app frames the
    // page the reader came from - the one the bar's step back returns to -
    // fell off the end of the tab's history. The address of this run goes
    // into data-src, readable whatever navigated the frame.
    navigate(frame, src.href);
  });
}

// A run that stopped leaves the last app in the frame - said on the frame
// itself (run-status.mjs). Not on the Pilot's page, whose frames are its
// tabs and whose Restart is said in its own chat.
function stopped(why) {
  if (appUp && !pilotPage) markAppStale(why);
}

// Starts what is in the editor: compile it, register it with the runtime, then
// a new database and a new app in the frame.
//
// `quiet` is a run nobody asked for: autorun's, 700ms after the typing
// stopped. It says what it found like any other - the status line, the
// underlines, the Problems list - but it leaves the caret where the reader is
// typing. Moving it to the first error, as a pressed Run does, sent the next
// keystrokes there: an unfinished statement is an abaplint error, so every
// pause in the middle of one pulled the caret out of the line being written
// (to the top of the file, or into another file) and typed the rest into it.
//
// Answers true when an app started - on a narrow screen the caller brings the
// app forward then, and only then.
export async function run({ quiet = false } = {}) {
  // Ctrl+Enter and the sample menu call this too, so the guard cannot be the
  // Run button being disabled: two runs would race on the frame's src and on
  // the one-shot load listener, and the second reset would land under a frame
  // that is still booting the first.
  if (running) return;
  running = true;
  // Whatever the last run's tests said is not about this one: a run that
  // stops before its tests (an abaplint error, a transpiler refusal) used to
  // hand runForAgent( ) the results of the run before it.
  lastTestResults = [];
  cancelAutorun();
  runStarting();
  reflectRunButton();
  // Whatever the last run had to say about itself is no longer true.
  hideOutput();
  try {
    const files = getFiles();
    lastRunText = JSON.stringify(files);

    const structural = structuralProblem(files);
    if (structural) {
      setStatus("the playground cannot start this", true);
      showOutput("ABAP", structural);
      stopped("the code on screen cannot be started");
      return;
    }

    // abaplint only: its errors mean the ABAP does not compile, so there is
    // nothing to start. An abap2UI5 finding means the opposite - the app runs
    // and is wrong somewhere - and the fastest way to understand one of those
    // is to look at the app it produced. Blocking Run on it would hide the
    // evidence. They are underlined in the editor and listed under Problems.
    // Waited for, not read back: Run decides on the text as it is now, and
    // the registry answers from a worker.
    const problems = await refreshNow();
    updateInsight(problems);
    const errors = problems.filter((i) => i.severity === 1 && i.source === "abaplint");
    if (errors.length > 0) {
      announceProblems(errors);
      setStatus(`${errors.length} error${errors.length > 1 ? "s" : ""} in the ABAP - fix them and run again`, true);
      stopped("the code on screen has errors");
      // The errors are already in the panel, one clickable row each, saying
      // which checker spoke. Writing them into the Log as well would put the
      // same list twice into one panel and show the poorer copy - so this
      // brings the reader to the list instead of retyping it.
      showInsight("problems");
      if (!quiet) focusProblem(errors[0].file, errors[0].range.start.line + 1, errors[0].range.start.character + 1);
      return;
    }

    setStatus("compiling…");
    const { chunks, tests } = await compile(files);
    // Waited for: the worker evaluates each chunk with `new Function`, and a
    // chunk V8 refuses, or one that throws while defining itself, is the
    // error to show. Left unawaited it was an "Uncaught (in promise)" in the
    // console, and the run went on to start an app whose class was never
    // defined - a dump about a missing class, in place of the real cause.
    //
    // The Run is counted here, the moment the classes change: the
    // frames' roundtrip (agent-hooks.mjs) refuses a frame of an earlier Run by
    // this number, and counted only before the database reset it let the old
    // app's timer run the NEW classes through the whole test phase - a dump
    // that was not the new app's, left on screen after it started. Counted
    // after compile, so code that does not compile leaves the old app working.
    state.runCounter += 1;
    quietRun = quiet ? state.runCounter : undefined;
    // The page started on code a link brought, and this is where it starts
    // to run: from here on the page is not a safe place for a secret
    // (src/shell/linked-code.mjs). For the visit - a script it started
    // outlives the files being replaced.
    if (fromALink(context.startedFrom)) markLinkedCodeRan();
    await state.runtime.defineClasses(chunks.map(({ name, js, lines }) => ({ name, js, lines })));

    // The unit tests in the test includes, before the app: a run is compile,
    // test, start - the order a developer works in - and a failing test is
    // no reason to withhold the app, which is the fastest way to see what
    // the test is about. The results go to the Tests tab; failures bring it
    // forward and are said in the status line after the app is up.
    let testsFailed = 0;
    if (tests.length > 0) {
      setStatus("running the tests…");
      let results;
      try {
        results = await state.runtime.runUnitTests(tests);
      } catch (e) {
        // A JavaScript error out of a test - a read through an initial
        // reference - stopped the runner itself, and took the whole run with
        // it: no Tests row, no app. The tests are reported as not run, the
        // Log says why, and the app starts, as it does for a failed test.
        if (e?.name === RUNAWAY) throw e;
        results = tests.flatMap((t) =>
          t.methods.map((method) => ({
            class: t.class.toUpperCase(),
            testclass: t.testclass,
            method,
            passed: false,
            status: "ERROR",
            expected: "",
            actual: "",
            message: String(e?.message ?? e),
            microseconds: 0,
            frame: "",
            location: e?.location,
          })),
        );
        showOutput("Tests", `The tests could not be run to the end: ${String(e?.message ?? e)}`);
      }
      setTestResults(results);
      lastTestResults = results;
      testsFailed = results.filter((r) => !r.passed).length;
    } else {
      setTestResults([]);
      lastTestResults = [];
    }

    setStatus("starting the app…");
    // (The Run was counted before the classes were defined - see above - so
    // the old app cannot reach the database while it is being reset either.)
    await state.runtime.resetDatabase();
    // A run is a fresh app; what the last one said to its frontend is over.
    clearRoundtrips();

    const src = new URL("app/index.html", document.baseURI);
    src.searchParams.set("app_start", entryClass(files));
    src.searchParams.set("run", String(state.runCounter));
    // UI5 reads sap-ui-* from the query and it wins over the bootstrap tag, so
    // the app follows the same light or dark the rest of the page does. Both
    // themes are built into dist/app; a third would have to be added there.
    src.searchParams.set("sap-ui-theme", uiTheme());

    // In place where the frame can: same document, same origin, UI5 up, the
    // bridge offering it. The address of the Run is recorded the same way,
    // and `src` is the reload's fallback when the restart is refused.
    if (!(await restartInPlace(frame, src))) await loadFrame(src);
    // A load is not an app. Offline on a first visit (no worker yet) the
    // frame's document arrived from the HTTP cache but sap-ui-core.js did
    // not, or Chrome's own error page loaded - both fire `load`, and the
    // status said "running" over a blank frame.
    // The frame's bridge says so once UI5 is up; an error page says nothing,
    // and is given five seconds to.
    const booted = await linkOf(frame).up(5000);
    if (!booted) throw new Error("The app frame loaded without UI5 - is the network down? Run again once it is back.");
    // An app is on screen: whatever placeholder stood over the frame goes -
    // after boot's first run, or in the AI Studio, after the first app the
    // model built - and so does the word that it was the last one.
    document.getElementById("app-placeholder")?.setAttribute("hidden", "");
    appUp = true;
    clearAppStale();
    if (testsFailed > 0) {
      const total = tests.reduce((n, t) => n + t.methods.length, 0);
      sayRunning(`running - ${testsFailed} of ${total} test${total === 1 ? "" : "s"} failed`, true);
      showInsight("tests");
    } else {
      sayRunning("running");
    }
    // After the load event, so the app has rendered and has a height to report.
    if (appOnly) announceAppHeight(frame);
    // The AI Pilot's further apps start again with this Run - same fresh
    // database, new Run number (src/shell/pilot.mjs).
    context.pilot?.pilotRan();
    // Answered rather than returned blank, because on a narrow screen the
    // caller brings the app forward - and every path out of here above this
    // line is one where there is no app to bring: nothing compiled, or the
    // problems list is what the reader now needs to be looking at.
    return true;
  } catch (e) {
    setStatus("the app could not be started", true);
    showOutput("Run", String(e.message || e));
    stopped("the code on screen did not start");
    // What the transpiler refused, at the lines it named: underlined and in
    // the Problems list, the way the checkers' findings are - the Log has
    // the full text, but a line is where somebody looks.
    if (e.problems?.length > 0) {
      reportTranspilerProblems(e.problems);
      const problems = refresh();
      updateInsight(problems);
      const first = problems.find((p) => p.source === "transpiler");
      if (first) {
        showInsight("problems");
        if (!quiet) focusProblem(first.file, first.range.start.line + 1, 1);
      }
    }
  } finally {
    running = false;
    reflectRunButton();
  }
}
