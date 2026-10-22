// What the page offers the parties beside the reader: the app frames, which
// ask this page for every roundtrip they would otherwise POST to a backend
// (by message - serveFrames( ) in frame-link.mjs, frontend-bridge.js on the
// frame's side), and the AI rooms -
// the AI Studio (chat.mjs) and the AI Pilot (pilot.mjs) - which work on the
// same editor and press the same Run through the hooks set up here.
import { getFiles, invalidateAnalysis, openFile, refreshNow } from "../editor/editor.mjs";
import { abaplintSettings, applyAbaplintSettings, entryClass } from "../editor/registry.mjs";
import { keepAbaplintSettings } from "./checker-settings.mjs";
import { problemsChanged } from "./insight-common.mjs";
import { compile } from "../editor/transpile.mjs";
import { checkFileSet } from "../editor/files.mjs";
import { carriedSampleFiles } from "../editor/samples.mjs";
import { updateInsight } from "./insight.mjs";
import { recordRoundtrip, roundtripList } from "./roundtrips.mjs";
import { state } from "./state.mjs";
import { RUNAWAY } from "./runtime-client.mjs";
import { readStoredJson, removeStored } from "./storage.mjs";
import { currentLog, setStatus, showOutput } from "./ui.mjs";
import { aiPage, frame, pilotPage } from "./page.mjs";
import { caretMayMove, firstLine, isRunning, lastTests, pointAtDump, run, uiTheme, withRunLock } from "./run.mjs";
import { linkedFiles, replaceWith } from "./file-sets.mjs";
import { frameApi, serveFrames } from "./frame-link.mjs";

// The AI Studio's last build (see remember( ) in main.mjs, and chat.mjs).
export const AI_STORAGE_KEY = "abap2ui5-playground:ai-files";

// The draft id a frame's request is on - none for an app start.
function draftOf(body) {
  try {
    return JSON.parse(body)?.value?.S_FRONT?.ID || null;
  } catch {
    return null;
  }
}

// Whether the focus is somewhere text is typed into on this page - a field,
// a textarea, the editor (Monaco's own input is inside .monaco-editor).
const NOT_TYPED_INTO = new Set(["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"]);
function typingHere() {
  const at = document.activeElement;
  if (!(at instanceof HTMLElement)) return false;
  if (at instanceof HTMLTextAreaElement || at.isContentEditable || at.closest(".monaco-editor")) return true;
  return at instanceof HTMLInputElement && !NOT_TYPED_INTO.has(at.type);
}

// What the frontend in an app frame asks this page for: the roundtrip it
// would otherwise POST to a backend, and whether the shell has a dialog
// open - see src/shell/frontend-bridge.js for what the frame does with
// that, and frame-link.mjs for how it is asked. `room` is the AI room of
// this page, if it has one, as the frame's other party.
export function offerFrameBridge({ room, chat, pilot }) {
  serveFrames({
    // Every roundtrip is kept for the Roundtrips tab on its way through -
    // see src/shell/roundtrips.mjs. Timed around the worker's answer, so
    // the number is the ABAP plus the message hops and not the render.
    roundtrip: async (body, from) => {
      // An app from a Run that has been replaced: a timer or a click in the
      // old frame in the moment before the new document arrives ran against
      // the new Run's fresh database, and was listed as the new Run's first
      // roundtrip. Refused instead - that frame is on its way out. A frame
      // that says nothing (an older bridge script) is served as before.
      const runNumber = from ? new URL(from, document.baseURI).searchParams.get("run") : null;
      if (runNumber !== null && runNumber !== String(state.runCounter)) {
        // A step of the AI Pilot parked for this frame goes with it: left
        // parked, it was handed to the new document's app start and sent
        // in its place - an event on a draft the fresh database never held.
        room?.takePilotRequest(from)?.reject(new Error("the app was restarted before this step reached it - look again"));
        throw new Error("this app was replaced by a newer Run");
      }
      // The AI's act (src/shell/pilot.mjs, src/shell/chat.mjs - whichever
      // room this page is): the frame was made to send a roundtrip so that
      // it renders the answer, and what goes to the framework is the
      // model's request in place of the frame's. Every answer, the
      // reader's clicks included, is shown to the model after.
      let parked = room?.takePilotRequest(from) ?? null;
      // Only ever in place of a request on a running app: an app start (no
      // draft id - the frame reloaded, or a Run) is the frame's own.
      if (parked && !draftOf(body)) {
        parked.reject(new Error("the app started again before this step reached it - look again"));
        parked = null;
      }
      if (parked) body = parked.body;
      const started = performance.now();
      try {
        const response = await state.runtime.roundtrip(body);
        recordRoundtrip({ request: body, response, ms: performance.now() - started });
        room?.sawRoundtrip(body, response, from);
        parked?.resolve(response);
        if (response.location) pointAtDump(response.location, firstLine(response.body), caretMayMove());
        return response;
      } catch (e) {
        // A JavaScript error out of the transpiled code, rather than an
        // ABAP exception the framework turned into a dump: the frame's
        // fetch rejects, and the line is still worth pointing at.
        parked?.reject(e);
        // Listed like an answer that failed: the AI's run waits for the
        // first roundtrip and read "none arrived within ten seconds",
        // with nothing in the status or the Log to say why.
        const failed = { status: 500, body: `${e?.name === RUNAWAY ? "" : "JavaScript error in the app: "}${String(e?.message ?? e)}` };
        if (e?.console) failed.console = e.console;
        recordRoundtrip({ request: body, response: failed, ms: performance.now() - started });
        // And to the AI Pilot's mirror of that tab, which otherwise never
        // heard of the start and waited half a minute for it.
        room?.sawRoundtrip(body, failed, from);
        if (e?.location) pointAtDump(e.location, String(e.message ?? e), caretMayMove());
        // ABAP that did not finish, stopped by the runtime's watchdog: the
        // frame only sees a failed request, so the page says what happened.
        if (e?.name === RUNAWAY) {
          setStatus("the app was stopped - its ABAP did not finish", true);
          showOutput("Run", String(e.message));
        }
        throw e;
      }
    },
    // Whether the frame should leave the focus alone right now: told to the
    // frames whenever it changes, and the frontend checks it before every
    // focus( ) (frontend-bridge.js). While a
    // dialog is open - the bar's search panel counts: it is modal too
    // (search-box.mjs makes the page under it inert), and an app rendering
    // while it was open took the focus and the rest of the search with it.
    // And while somebody is typing on this page: an app's first render
    // focuses a field of its own, so the app autorun started, or the one
    // the AI ran, took the editor's or the chat's next keystrokes. Once the
    // reader is in the app the frame holds the focus, and nothing here
    // stops it.
    holdFocus: () => document.querySelector("dialog[open], .search-scrim:not([hidden])") !== null || typingHere(),
    // Files dropped on the app in a frame, on the AI Pilot's page or the AI
    // Studio's: they go to that page's chat (pilot.mjs, chat.mjs).
    // Elsewhere a frame keeps the browser's own answer to a drop.
    dropFiles: pilotPage ? (files) => pilot?.pilotDropped(files) : aiPage ? (files) => chat?.chatDropped(files) : undefined,
  });
}

// Run, for the AI chat - and everything a person would look at afterwards,
// as data: the status line, the problems, the tests, the roundtrips the app
// started with, and the Log. ai-agent.mjs turns it into what the model reads.
//
// A run already under way (autorun, set off by the very edit the model just
// made) is waited out rather than skipped, so the report is about the code
// as it is now. After the frame has loaded, the first roundtrip is waited for
// as well: that is the app's start, and the dump the model needs to see, if
// there is one, arrives with it.
async function runForAgent() {
  while (isRunning()) await new Promise((resolve) => setTimeout(resolve, 100));
  const started = await run();
  // Up to thirty seconds, as the Pilot waits for a tab (pilot.mjs): the
  // studio's first app is a whole UI5 boot after the placeholder, and ten
  // seconds on a slow machine read as "none arrived" - an error that was
  // none, and the model spent turns fixing it. Over once the frame has
  // rendered (the bridge's busy( ) says so) or an answer is in.
  let starting = false;
  if (started) {
    const until = performance.now() + 30000;
    const rendering = () => {
      try {
        return frameApi(frame)?.busy() !== false;
      } catch {
        return true;
      }
    };
    while (roundtripList().length === 0 && performance.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    starting = roundtripList().length === 0 && rendering();
  }
  const status = document.getElementById("status");
  return {
    started: Boolean(started),
    // Still booting when the wait ran out - not an app that answered nothing.
    starting,
    status: status.textContent,
    // Waited for: a run that stopped before its own refreshNow( ) (a
    // structural problem) left refresh( ) answering for the text from before
    // the model's change, and the model chased problems that were gone.
    problems: await refreshNow(),
    tests: lastTests(),
    // Only a run that started has roundtrips of its own: one that stopped
    // before the fresh database left the LAST run's list in place, and the
    // model read "first roundtrip: HTTP 200" and the old app's view under a
    // status saying this one did not start.
    roundtrips: started ? roundtripList() : [],
    log: currentLog(),
  };
}

// The AI Pilot's further apps (src/shell/pilot.mjs): `files` go into the
// editor beside what is there (a file of the same name is replaced), `first`
// names the file Run is to start from now on, and the whole set is checked,
// compiled and defined - the same steps as run( ) up to the classes, and not
// one step further: no fresh database, no Run counted, no frame reloaded. The
// runtime defines a set of classes as a whole (defineClasses( ) puts back what
// the last set shadowed), which is why the apps already open are compiled
// again with the new one rather than the new one alone.
function addAppFiles(files, { first } = {}) {
  return withRunLock(async () => {
    // The set as it was, put back when the new one does not compile: left in,
    // the broken files made every later open and every Restart fail the same
    // way, on a page whose editor is hidden - only a reload got out of it.
    const before = getFiles().map((f) => ({ ...f }));
    const putBack = async () => {
      try {
        replaceWith(before, { asOpened: false });
        updateInsight(await refreshNow());
      } catch {
        // the old set was accepted once and is accepted again
      }
    };
    try {
      let next = getFiles().map((f) => ({ ...f }));
      for (const file of files) {
        const at = next.findIndex((f) => f.name === file.name);
        if (at === -1) next.push({ ...file });
        else next[at] = { ...file };
      }
      if (first) {
        const lead = next.find((f) => f.name === first);
        if (lead) next = [lead, ...next.filter((f) => f !== lead)];
      }
      replaceWith(checkFileSet(next), { asOpened: false });
      const problems = await refreshNow();
      updateInsight(problems);
      const errors = problems.filter((i) => i.severity === 1 && i.source === "abaplint");
      if (errors.length > 0) {
        await putBack();
        return { started: false, status: `${errors.length} error${errors.length > 1 ? "s" : ""} in the ABAP`, problems };
      }
      const { chunks } = await compile(getFiles());
      await state.runtime.defineClasses(chunks.map(({ name, js, lines }) => ({ name, js, lines })));
      return { started: true, status: "running", problems };
    } catch (e) {
      await putBack();
      return { started: false, status: String(e?.message ?? e), problems: [] };
    }
  });
}

// One of the samples the page carries, by the raw URL the samples browser
// hands over for its catalogue row: the AI Pilot opens the copy the page
// carries rather than fetching it (a promise of the files, or undefined).
export const carriedFiles = (url) => carriedSampleFiles(String(url).split("/").pop().replace(/\.clas\.abap$/, ""));

// The AI chat (src/shell/chat.mjs, src/shell/ai-agent.mjs): the model works
// on the same editor and presses the same Run, through these. Only on the
// studio's own page - the playground carries no way into it.
export function setUpStudio(chat) {
  chat.setUpChat(
    {
      files: () => getFiles(),
      // Through replaceWith( ), like a sample: written into the models that
      // are open (undoable), the strip redrawn, the draft stored by the
      // change handler. checkFileSet( ) refuses a set the editor cannot hold.
      // Not "as opened": what the model wrote is work, and is stored like
      // typed code.
      setFiles: (files) => replaceWith(checkFileSet(files), { asOpened: false }),
      run: () => runForAgent(),
      show: (name) => openFile(name),
      // The last build this browser stored, for the welcome's "open it
      // again" - checked the way a draft is, so a set the editor cannot
      // hold is no build to offer.
      lastBuild: () => {
        try {
          const stored = readStoredJson(AI_STORAGE_KEY);
          return stored ? checkFileSet(stored) : undefined;
        } catch {
          return undefined;
        }
      },
      forgetLastBuild: () => removeStored(AI_STORAGE_KEY),
      // The release the syntax check holds the code to - abaplint's
      // `version`, the Config tab's setting - which the chat header offers
      // as the reader's target system (target-system.mjs) and the model is
      // told before every request. Set the way the Config tab's Apply sets
      // it: the corpus parsed again, kept for the next visit, the problems
      // counted afresh.
      abapRelease: () => abaplintSettings().version,
      setAbapRelease: async (version, progress) => {
        const next = { ...abaplintSettings(), version };
        await applyAbaplintSettings(next, progress);
        keepAbaplintSettings(next);
        invalidateAnalysis();
        problemsChanged(await refreshNow());
      },
    },
    // The studio is the page: it opens at once, and there is no playground
    // under it to leave to.
    { startOpen: true },
  );
}

// The AI Pilot (src/shell/pilot.mjs): the model operates the app in the
// frame. It opens the samples the way the samples browser does and
// restarts the app the way Run does - these, and nothing else.
export function setUpPilotHooks(pilot, { openSamples }) {
  pilot.setUpPilot({
    files: () => getFiles(),
    run: () => runForAgent(),
    // A catalogued class by its raw URL, and the classes it needs beside it -
    // the ?src= path, as loadLinked( ) takes it.
    fetchLinked: (url) => linkedFiles(url),
    // Further apps, beside the one Run starts: their files go into the
    // editor beside the others and everything is compiled and defined
    // again - WITHOUT a fresh database and without counting a Run, so the
    // apps already open keep their state and their frames stay current.
    addFiles: (files, options) => addAppFiles(files, options),
    // The address a Pilot frame loads an app from - Run's own, plus the
    // frame's name, which tells the bridge whose roundtrip it is.
    frameSrc: (cls, params = {}) => {
      const src = new URL("app/index.html", document.baseURI);
      src.searchParams.set("app_start", cls);
      src.searchParams.set("run", String(state.runCounter));
      for (const [key, value] of Object.entries(params)) src.searchParams.set(key, value);
      src.searchParams.set("sap-ui-theme", uiTheme());
      return src.href;
    },
    mainFrame: frame,
    // One of the samples the page carries, by its class - no network; a
    // promise of its files, since the sample's chunk may not have landed.
    carried: (cls) => carriedSampleFiles(cls),
    openSamples,
    frame: () => frameApi(frame),
    appClass: () => entryClass(getFiles()),
  });
}
