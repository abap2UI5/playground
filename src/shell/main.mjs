// The playground page.
//
// It owns three things the rest of the code reaches through: the ABAP runtime
// that answers roundtrips, the abaplint registry the editor thinks with, and the
// iframe the app renders in. The iframe asks this page for every roundtrip (see
// frontend-bridge.js); the page hands it to the framework, which runs in a
// worker of this page's (src/shell/runtime-client.mjs), and the frame is only
// a screen.
//
// This module is the boot and the bar. What boot( ) puts together lives
// beside it: which page this is (page.mjs), what the editor opens on
// (starting-files.mjs), Run and the app frame (run.mjs) with what the status
// line rests on between runs (run-status.mjs), the Auto switch and the Run
// button's state (autorun.mjs), what goes into the editor over what is there
// and what is kept of it (file-sets.mjs), the frame's roundtrips and the AI
// rooms' hooks (agent-hooks.mjs), and the service worker (site-cache.mjs).
import "./shell.css";

import {
  canRedo,
  canUndo,
  connectRegistry,
  createEditor,
  currentFile,
  format,
  getFiles,
  invalidateAnalysis,
  openFile,
  preloadEditor,
  redo,
  refresh,
  refreshNow,
  setEditorTheme,
  undo,
  whenAnalysed,
  analysisPending,
} from "../editor/editor.mjs";
import { buildRegistry, corpusLanded, startRegistry } from "../editor/registry.mjs";
import { loadLinter } from "../editor/abap2ui5-lint.mjs";
import { loadSampleFiles } from "../editor/samples.mjs";
import { humanUrl, originOf } from "./deep-link.mjs";
import { writeOpenFile } from "./persistence.mjs";
import { render as renderFiles, setUpFiles } from "./files-ui.mjs";
import { setUpInsight, updateInsight } from "./insight.mjs";
import { restoreCheckerSettings } from "./checker-settings.mjs";
import { setUpSplitter, setUpTabs, setUpToolbarMenu } from "./layout.mjs";
import { keepSiteLinksCurrent, rememberHere } from "./site-memory.mjs";
import { setUpSearch } from "./search-box.mjs";
import { announceEdited, announceReady, setUpEmbeddedEditor, startEmbedMessages } from "./embed.mjs";
import { appUrl, copyToClipboard, shareUrl } from "./share.mjs";
import { isUntouchedStarter } from "./ai-starter.mjs";
import { state } from "./state.mjs";
import { STALLED, startRuntime } from "./runtime-client.mjs";
import { removeStored, writeStoredJson } from "./storage.mjs";
import { isDark, onThemeChange, setUpTheme } from "./theme.mjs";
import { setUpExtra } from "./extra.mjs";
import { closeOnBackdrop, describeError, setStatus, showOutput } from "./ui.mjs";
import { warmUpAppFrame } from "./warm-up.mjs";
import { aiPage, appOnly, cameFromCatalogue, catalogueQuery, embedded, keepsDrafts, params, frameIsolated, pilotPage } from "./page.mjs";
import { FROM_LAST_SESSION, startingFiles } from "./starting-files.mjs";
import { autorunAfterChange, markBooted, setUpAutorun } from "./autorun.mjs";
import { applyFrameTheme, isRunning, isRunWaiting, lastRun, run, setRunContext, uiTheme } from "./run.mjs";
import { reflectCodeErrors, sayBriefly } from "./run-status.mjs";
import { keepDraft, loadDraft, loadLinked, loadSample, linkedFiles, markOpened } from "./file-sets.mjs";
import { AI_STORAGE_KEY, carriedFiles, offerFrameBridge, setUpPilotHooks, setUpStudio } from "./agent-hooks.mjs";
import { discardCachedSite, keepAssetsForNextTime, servedFromCache } from "./site-cache.mjs";
import { lessonChanged, startGuides } from "./guides.mjs";
// Compare/Reset against the original, and the bar's UI5 floor (their own modules).
import { reflectOriginal, setUpOriginal, unchangedRawUrl } from "./original.mjs";
import { setUpUi5Floor } from "./ui5-floor.mjs";

const runButton = document.getElementById("run");
const autorunButton = document.getElementById("autorun");
const undoButton = document.getElementById("undo");
const redoButton = document.getElementById("redo");
const formatButton = document.getElementById("format");
const shareButton = document.getElementById("share");
const fullscreenButton = document.getElementById("fullscreen");
const examplesButton = document.getElementById("examples");

// FOUR CHUNKS THE SHELL DOES NOT CARRY. The studio's room (src/shell/chat.mjs)
// and the Pilot's (src/shell/pilot.mjs) are wanted on their own pages and
// nowhere else, so each is an import( ) started here, on its page, the moment
// this module runs - its document preloads the chunk (writeAiPage,
// writePilotPage in tools/build-site.mjs), so it travels with the bundle -
// and awaited at the top of boot( ), before anything that could reach for
// it. Everywhere else `chat` and `pilot` stay null and every call site is a
// `?.`. The samples browser (src/shell/examples.mjs) and the Share dialog
// (src/shell/share-dialog.mjs, with export.mjs and zip.mjs) are wanted on a
// click: each is imported and set up the first time it is opened, and the
// samples browser's chunk is asked for once the page is idle after boot, so
// the first click does not wait on it. Together they were a third of the
// shell's bundle, evaluated on every page before the first paint of the
// toolbar.
let chat = null;
let pilot = null;
const chatChunk = aiPage && !embedded ? import("./chat.mjs") : null;
const pilotChunk = pilotPage && !embedded ? import("./pilot.mjs") : null;
let examplesChunk = null;
let shareChunk = null;
// The Share dialog, set up when it is first opened (share( ) below).
const shareReady = () =>
  (shareChunk ??= import("./share-dialog.mjs").then((m) => {
    m.setUpShareDialog({ unchangedRawUrl });
    return m;
  }));

// Keeps a promise from being an unhandled rejection while nothing is awaiting
// it yet. The ones in boot( ) below are started at the top of it and awaited
// several statements later, and a failure in that window - a corpus that 404s,
// a framework bundle that will not parse - would otherwise reach the console as
// an unhandled rejection before the code that reports it properly ever runs.
// The original promise still rejects for the real awaiter; this only says that
// somebody is listening.
const heard = (promise) => {
  promise.catch(() => {});
  return promise;
};

// The Anthropic key an earlier version of the AI chat kept in localStorage.
// chat.mjs takes it out - but only on the studio's own page, and the page
// where a link's app can read this origin's storage (a view's core:HTML, in
// a frame on this origin - page.mjs, frameIsolated) is the playground,
// embedded or not. So it goes on every page, before any linked code has run.
const LEGACY_KEY = "abap2ui5-playground:anthropic-key";

async function boot() {
  removeStored(LEGACY_KEY);
  // The room of this page, if it has one - see the four chunks above.
  if (chatChunk) chat = await chatChunk;
  if (pilotChunk) pilot = await pilotChunk;
  setRunContext({ pilot });
  if (embedded) document.body.classList.add("is-embedded");
  if (appOnly) document.body.classList.add("is-app-only");
  // Where the playground is furniture in somebody else's page, the panel stays
  // out of the way - until something is written to the log, which is the one
  // thing that may take the screen unasked.
  if (embedded || appOnly) document.getElementById("insight").classList.add("is-tucked");
  startEmbedMessages();

  // What the two Config tabs were last set to. Before the corpus is fetched,
  // because abaplint's half decides how the corpus is parsed - restoring it
  // afterwards would mean parsing nine hundred objects twice, which is the one
  // cost the Config tab exists to warn about.
  //
  // Never in an embedded playground, for the same reason it never restores a
  // draft: what somebody's documentation page shows has to be the same for
  // every reader, and a rule switched on last week is not something to
  // discover through an example that suddenly disagrees with its own text.
  if (!embedded) restoreCheckerSettings();

  // Started before anything at all is awaited, because nothing about them
  // depends on the rest of this function.
  //
  // Two independent slow starts: the transpiled framework and the ABAP corpus
  // the editor checks against. The framework is a worker (src/shell/
  // runtime-client.mjs), started by index.html before this bundle had even
  // arrived, and evaluating it - the better part of a second, several on a
  // phone - happens on that worker's thread; what is picked up here is the
  // handle. The corpus half does not stop at its download either: parsing
  // what arrives is the expensive part of it, several seconds of processor
  // against a megabyte and a half of network, and it starts the moment the
  // JSON lands. The two used to share this thread, and the framework's
  // evaluation - one synchronous block - sat in front of the parse: the corpus
  // had landed at a fifth of a second and abaplint could not start on it
  // until the framework was done. Now they overlap.
  //
  // And they are started here rather than after startingFiles( ), which is
  // where they used to be. That await is instant for a draft or a sample and
  // is two network round trips to GitHub for a ?src= link - the fetch of the
  // linked class, then the fetch of the classes beside it - which is the path
  // every Run button in the documentation takes. The preload tag in
  // index.html had the corpus moving with the document already; what was
  // still waiting on the link was every bit of processor work behind it.
  const runtime = startRuntime();
  heard(runtime.ready);
  // Monaco, which is a chunk of its own now: asked for here, before the
  // awaits, on every page that will show the editor - and on no other. An
  // app-only page keeps the files in src/editor/file-store.mjs instead and
  // never fetches it.
  if (!appOnly) heard(preloadEditor());
  // The registry's worker, which fetches the corpus itself and has usually
  // done so by now; picked up here the way the runtime's is.
  startRegistry();
  heard(corpusLanded);

  // What the app frame will load first, fetched into the cache while the
  // corpus parses - see src/shell/warm-up.mjs. After the corpus has landed,
  // not before: until then the network is busy with what the page cannot
  // start without, and these can wait for the stretch where it is not.
  // Not where the frame is isolated (page.mjs): a frame on an opaque origin
  // reads nothing from the HTTP cache these fetches fill.
  if (!frameIsolated) corpusLanded.then(() => warmUpAppFrame(uiTheme())).catch(() => {});

  // The piece of the page bundle that rides in the same stretch: the abap2UI5
  // linter, which the first analysis needs - split off assets/shell.mjs so
  // the editor is on screen before it has been downloaded, let alone
  // evaluated. It is picked up again below, once there is an analysis to
  // re-run.
  const linterReady = heard(loadLinter());

  // Before the editor is created, which asks which theme to start in; an
  // embedded playground follows its reader's system rather than a choice
  // made in some other tab (see theme.mjs).
  setUpTheme({ restore: !embedded });
  // The menu the switch is in opens on its own, being a <details>; this only
  // closes it on a click anywhere else and on Escape (extra.mjs).
  setUpExtra();
  // The toolbar's own overflow menu, which only a phone shows (layout.mjs).
  setUpToolbarMenu();
  // Samples and Documentation in the bar, pointed at the page each of those
  // sites was last left on, and at how far down it the reader was
  // (site-memory.mjs) - now, and again whenever that can have moved while this
  // page stayed open. Skipped when embedded, where the bar is not on screen.
  if (!embedded) keepSiteLinksCurrent();
  // The other three bars step BACK to this page when it is still in the tab's
  // history (site-memory.mjs), so that the browser can hand it back alive -
  // app, worker and all - instead of this boot running again. Whether it does
  // is the browser's call, and when it declined, the one place it says why is
  // notRestoredReasons on the arrival. The only console line in the shell:
  // there is nothing a reader can do about it and nothing on the page to say
  // it in, and the person who needs it is reading the console anyway.
  const arrival = performance.getEntriesByType?.("navigation")?.[0];
  if (arrival?.type === "back_forward" && arrival.notRestoredReasons) {
    console.info("playground: rebuilt rather than restored from the back/forward cache", arrival.notRestoredReasons);
  }
  // ...and this page written down as well, which it did not used to be. A
  // reader who opens a SAMPLE here has code that is not a draft - a sample
  // that was picked and read is deliberately not stored (see keepDraft( ) in
  // file-sets.mjs) - so pressing Documentation and then Playground threw it
  // away and started them on the default sample. The URL is what carries it,
  // so the URL is what is written: on the way out, which is when it is final,
  // and again when the tab is hidden, because pagehide is not promised on
  // every route out of a page.
  //
  // Not when embedded (furniture in somebody else's page) and not in an
  // app-only view (a running app, not a place to come back to).
  if (!embedded && !appOnly && !aiPage && !pilotPage) {
    const writeHere = () => rememberHere("playground");
    writeHere();
    addEventListener("pagehide", writeHere);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") writeHere();
    });
  }
  // The search box beside them: one box over the documentation and all ~770
  // samples, over the index the documentation publishes (search-box.mjs).
  // Not when embedded - an embedded playground is furniture in somebody
  // else's page, and a dialog that covers it belongs to nobody.
  if (!embedded) setUpSearch();
  // Never on the Pilot's page: a change to the files there is an app opened
  // beside the others, and a run would restart every one of them.
  // Not on the studio's page either: its toolbar, and with it the switch, is
  // hidden there, and a restored Auto ran the model's half-finished turn on
  // every pause (a slow read_sample after a write_file) - a second compile
  // and frame reload for each change, with no way for the reader to see why.
  setUpAutorun({
    restore: !embedded && !pilotPage && !aiPage,
    run,
    running: isRunning,
    waiting: isRunWaiting,
    lastRunText: lastRun,
  });
  setUpSplitter();
  setUpAbout();
  const tabs = setUpTabs(appOnly);

  // The files, as a promise the registry build can hold: the corpus parse does
  // not need them until it has finished parsing the corpus itself.
  const startingReady = heard(startingFiles());

  const registryReady = heard(
    (async () => {
      setStatus("reading the abap2UI5 sources…");
      await buildRegistry(
        startingReady.then((s) => s.files),
        (done, total) => {
          setStatus(`checking the sources… ${Math.round((done / total) * 100)}%`);
        },
      );
      // Whatever is left to wait for is the framework still on its way. Saying
      // so beats leaving the line reading 100% with nothing apparently
      // happening.
      setStatus("loading the ABAP runtime…");
    })(),
  );

  const starting = await startingReady;
  const { files, from, openFile: shownBefore } = starting;
  setRunContext({ startedFrom: from });
  await createEditor(document.getElementById("editor"), files, { onChange: remember, dark: isDark(), editor: !appOnly });
  // A restored draft opens on the file that was on screen (persistence.mjs).
  if (shownBefore) openFile(shownBefore);
  // What a link or the default sample put in is not the reader's work until
  // they change it (see file-sets.mjs); a restored draft is.
  if (from !== FROM_LAST_SESSION) markOpened();
  // Embed hook (src/shell/embed.mjs): ?readonly=1, ?lines= and the code the
  // embedding page gave, kept for its "edited" message and its Reset.
  if (embedded) setUpEmbeddedEditor(params, { run: () => run() });
  // A theme change - the switch in the bar, or the sun going down on a page
  // that follows the system - must not restart the app: somebody has a
  // half-filled form open. UI5 can swap its theme at runtime, so the running
  // frame is told rather than reloaded; a frame that cannot be told keeps the
  // theme it started with until the next Run. The editor is told as well -
  // from the moment it exists, not from the end of boot: a switch flipped
  // during the seconds of corpus parse used to leave Monaco in the old theme,
  // and a boot that failed never listened at all.
  onThemeChange(() => {
    setEditorTheme(isDark());
    applyFrameTheme();
  });
  setUpFiles({ onOpened: fileOpened });
  setUpInsight();
  // The registry answers from a worker, so what remember( ) and fileOpened( )
  // show is what was last known; this is how the fresh answer reaches the
  // panel, the badge and the fix bar - and the status line.
  whenAnalysed((problems) => checked(problems));
  // The examples browser hands back either a built-in sample's id or the raw
  // URL of a catalogued class; the URL goes through the same code a ?src=
  // link goes through. It is the one way to a sample - there is no sample
  // menu beside it, and the built-ins are its first group.
  // A chunk, imported and set up on the first open - see the four chunks
  // above - and asked for once the page is idle after boot, below, so the
  // first click finds it there.
  const examplesHandlers = {
    // On the Pilot's page a pick goes to the Pilot, which opens it in place
    // of the app on screen or beside it (src/shell/pilot.mjs).
    openSample: (id) => (pilotPage ? pilot?.pilotPicked(loadSampleFiles(id)) : loadSample(id, tabs)),
    openLinked: (url) => (pilotPage ? pilot?.pilotPicked(carriedFiles(url) ?? linkedFiles(url)) : loadLinked(url, tabs)),
    // The reader's own drafts (src/shell/drafts.mjs): what is open, to save,
    // and a saved one to open - which runs, the way a sample does.
    currentFiles: () => getFiles(),
    // On the Pilot's page a draft is an app like any other pick, in place
    // or beside: run as the playground runs it, it restarted every tab.
    openDraft: (files) => (pilotPage ? pilot?.pilotPicked(files) : loadDraft(files, tabs)),
  };
  const examplesReady = () =>
    (examplesChunk ??= import("./examples.mjs").then((m) => {
      m.setUpExamples(examplesHandlers);
      return m;
    }));
  const openExamples = () => examplesReady().then((m) => m.openExamples());

  try {
    setStatus("loading the ABAP runtime…");
    // The registry first, then the runtime - which is usually up by now, and
    // if it is not, whenReady( ) is what finds out whether it ever will be.
    // Both are already running and both are heard( ), so whichever fails
    // while the other is being awaited still rejects to somebody.
    await registryReady;
    await runtime.whenReady();
    state.runtime = runtime;
    offerFrameBridge({ room: pilot ?? chat, chat, pilot });
    const version = `abap2UI5 ${state.runtime.abapVersion()}`;
    document.getElementById("versions").textContent = version;
    document.getElementById("about-versions").textContent = version;

    connectRegistry();
    // The analysis just run had whatever the linter had to say - which is
    // nothing if its chunk was still on its way. When it lands, the kept
    // answer is thrown away and asked for again; if it has landed already,
    // this runs at once and costs one incremental analysis.
    linterReady
      .then(async () => {
        invalidateAnalysis();
        // The fresh answer, not the emptied one invalidateAnalysis( ) left.
        checked(await refreshNow());
      })
      .catch((e) => showOutput("abap2UI5 lint", `The abap2UI5 linter could not be loaded: ${String(e?.message ?? e)}`));
  } catch (e) {
    // Only where a service worker serves the page is there a cached copy to
    // throw away; without one, saying it was discarded was untrue and the
    // reload asked for changed nothing.
    if (e?.name === STALLED && servedFromCache()) {
      // A runtime that loaded and never spoke is a copy from another build,
      // and the copy lives in this browser: the service worker's cache, or
      // the worker itself, which would serve the same bytes again on every
      // visit. Both are thrown away here, so that the reload asked for is a
      // first visit again - see src/shell/sw.js for how the mix came about,
      // and why the worker no longer keeps one.
      await discardCachedSite();
      setStatus("the ABAP runtime did not start - the site's cached copy was discarded, please reload", true);
      showOutput("Startup", describeError(e));
      return;
    }
    setStatus("the playground could not start", true);
    showOutput("Startup", describeError(e));
    return;
  }

  for (const control of [autorunButton, formatButton, shareButton, fullscreenButton, examplesButton]) {
    control.disabled = false;
  }
  // Run is the one control with more than "the page has started" to say about
  // itself - autorun may already have it.
  markBooted();
  showSourceLink();
  setUpOriginal();
  setUpUi5Floor();

  if (chat) setUpStudio(chat);
  if (pilot) setUpPilotHooks(pilot, { openSamples: () => openExamples() });

  // A click on Run is a request to see the app, so on a narrow screen it brings
  // the app forward - the same move picking a sample makes, and at desk width
  // show( ) only marks the tab because both panes are already on screen. Not
  // when the run did not get that far: the panel it left open, the problems or
  // the log, is exactly what the reader has to be looking at.
  const runAndShow = () => run().then((started) => started && tabs.show("right"));

  runButton.addEventListener("click", runAndShow);
  undoButton.addEventListener("click", () => {
    undo();
    reflectHistory();
  });
  redoButton.addEventListener("click", () => {
    redo();
    reflectHistory();
  });
  // Format says what it did, the way "Fix them" does: it rewrites somebody's
  // source, across every file that is open, and a button that silently
  // changes three files is a button people stop pressing.
  const sayFormatted = (formatted) => setStatus(
    formatted === 0
      ? "already formatted"
      : `formatted ${formatted} file${formatted === 1 ? "" : "s"} - Ctrl+Z takes it back`,
  );
  // Shift+Alt+F runs the same formatter through Monaco's provider
  // (src/editor/providers.mjs) and reports through the same line.
  document.addEventListener("abap2ui5-formatted", (e) => {
    sayFormatted(e.detail?.formatted ?? 0);
    reflectHistory();
  });
  formatButton.addEventListener("click", async () => {
    try {
      const { formatted } = await format();
      reflectHistory();
      sayFormatted(formatted);
    } catch (e) {
      // A throw inside abaplint's printer, in the worker: said, rather than an
      // unhandled rejection behind a button that apparently did nothing.
      setStatus("the code could not be formatted", true);
      showOutput("Format", String(e?.message ?? e));
    }
  });
  shareButton.addEventListener("click", () => share());
  fullscreenButton.addEventListener("click", () => openFullScreen());
  examplesButton.addEventListener("click", () => openExamples());
  // The samples browser's chunk, fetched once the page is idle - so the first
  // click opens the dialog rather than waiting on a download.
  (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1000)))(() => heard(examplesReady()));

  // Ctrl+S as well as Ctrl+Enter: the hand that has typed in an editor for
  // twenty years presses it, and a browser answers with a dialog for saving
  // the page as HTML, which nobody has ever wanted here.
  // Not from inside a dialog: Ctrl+S in the Share dialog's textarea, or
  // Ctrl+Enter in the samples browser's search, would start a run behind the
  // modal the reader is looking at.
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "Enter" || e.key === "s" || e.key === "S")) {
      if (e.target instanceof Element && e.target.closest("dialog")) return;
      // Not on the Pilot's page, whose Run is Restart: Ctrl+Enter sent the
      // message AND ran - a fresh database under every app as the turn
      // began. Nor from the studio's chat, where it is "send".
      if (pilotPage || (aiPage && e.target instanceof Element && e.target.closest("#chat"))) {
        // Ctrl+S is still not the browser's "save page as".
        if (e.key !== "Enter") e.preventDefault();
        return;
      }
      e.preventDefault();
      runAndShow();
    }
  });

  if (aiPage && getFiles().every(isUntouchedStarter)) {
    // The studio starts on a class with an empty main( ): nothing to run
    // yet, and the placeholder says where the app will appear. run( ) takes
    // it away the first time an app starts.
    const what = document.querySelector(".app-placeholder-what");
    if (what) what.textContent = "Your app appears here as soon as Claude has built it.";
    document.querySelector(".app-placeholder-help")?.setAttribute("hidden", "");
    setStatus("ready - describe the app you want");
  } else {
    await run();
  }
  // The frame has something to show, so the placeholder that stood over it
  // during the boot goes - for good: a later run replaces the app in place,
  // and a run that fails is said in the status line and the panel.
  if (!aiPage) document.getElementById("app-placeholder")?.setAttribute("hidden", "");
  // Said once the playground has something to show, not once it has loaded -
  // an embedding page revealing the frame any earlier would reveal a blank one.
  announceReady();

  // Guided first steps (guides.mjs): the hint strip on a first visit and the
  // lesson bar on the learning path, each a chunk asked for only now - after
  // the first run, so the boot never waits on them. A lesson opens the way
  // the samples browser opens it.
  startGuides(starting, {
    openSample: examplesHandlers.openSample,
    openLinked: examplesHandlers.openLinked,
    openSamples: openExamples,
  });

  // After the first run, not before: run() opens with a clear of the output
  // panel, so a message shown earlier would be wiped by the very next line.
  if (starting.declined) {
    setStatus("the linked code was not opened - showing the sample instead");
  }
  if (starting.failure) {
    // What is on screen instead is the stored draft when there is one, not
    // always the sample - the sentence used to say "the sample" regardless.
    setStatus(
      `the link could not be followed - showing ${from === FROM_LAST_SESSION ? "your last session" : "the sample"} instead`,
      true,
    );
    showOutput("Link", String(starting.failure.message || starting.failure));
  }

  keepAssetsForNextTime();
}

// A fresh analysis of the code on screen: the panel, the badge and the fix
// bar - and the status line, which says so when the code no longer compiles
// while the app from before the change goes on running (run-status.mjs). Not
// on the Pilot's page, whose code is not on screen.
function checked(problems) {
  updateInsight(problems);
  if (!pilotPage) reflectCodeErrors(problems);
}

// The credits, and what this is. Wired outside boot()'s try/catch and before
// the runtime is awaited, so it still opens on a page whose startup failed -
// that is exactly when somebody wants the link to the issue tracker.
function setUpAbout() {
  const dialog = document.getElementById("about-dialog");
  document.getElementById("about").addEventListener("click", () => dialog.showModal());
  document.getElementById("about-from-placeholder")?.addEventListener("click", () => dialog.showModal());
  // `?` opens it too - the key a stranger presses on a page with a keyboard
  // list. Only where a question mark is not a character: not in the editor,
  // not in a field, not while a dialog already has the screen.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element
        && e.target.closest(".monaco-editor, input, textarea, select, [contenteditable=\"true\"], dialog")) return;
    e.preventDefault();
    if (!dialog.open) dialog.showModal();
  });
  // A click on the backdrop closes it, the way a modal is expected to.
  closeOnBackdrop(dialog);
}

// A different file is now on screen: the outline is about that file, and so is
// the link to where it came from, and so is what Undo has to take back.
function fileOpened() {
  // Which file is on screen is part of the draft, kept where the draft is.
  if (keepsDrafts) writeOpenFile(currentFile(), getFiles());
  showSourceLink();
  reflectHistory();
  checked(refresh());
}

// Undo and Redo follow the open file's history: live while there is an edit
// to take back or to do again, inactive otherwise. Monaco keeps the stack per
// model, so switching files switches what the buttons mean.
function reflectHistory() {
  undoButton.disabled = !canUndo();
  redoButton.disabled = !canRedo();
}

// Where this code came from - and the whole point of the button is that there
// is somewhere to go back TO.
//
// Two origins, and they want different destinations. A link somebody pasted
// leads to the file on GitHub: the repository around it, the neighbouring
// files, the history - and so does a sample the page carries, which is a file
// in abap2UI5/samples (starting-files.mjs, file-sets.mjs). A row on the sample
// catalogue leads back to the CATALOGUE, because somebody who came from a list
// of 770 samples to run one of them is not done with the list - and `back`
// carries the filters they had narrowed it to, so they land on their search
// rather than at the top of it. The catalogue sets both parameters
// (src/catalogue/catalogue.mjs).
//
// Live only for files that actually came from somewhere: over a draft, a
// shared link or the AI's code there is no page with any relation to what is
// on screen - so there it stays in the bar, inactive, rather than
// disappearing and having the controls beside it shift. And it says why when
// pointed at: it used to look merely broken.
export function showSourceLink() {
  const link = document.getElementById("source-link");
  const origin = originOf(currentFile());
  if (origin === undefined) {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    link.title = "No source to open - only a sample or a file opened from GitHub has a page there";
    link.textContent = "Source";
    return;
  }
  link.removeAttribute("aria-disabled");
  if (cameFromCatalogue) {
    /* The way back sits BESIDE the source link now, not in its place: a reader
     * who came from the catalogue used to have no route to the class on
     * GitHub from here. Same origin and same tab - a way back is not a second
     * window to end up with. */
    const back = document.getElementById("back-link");
    back.href = `samples/${catalogueQuery}`;
    back.hidden = false;
  }
  link.href = humanUrl(origin);
  link.target = "_blank";
  link.textContent = "Source";
  link.title = `Open ${currentFile()} where it lives`;
}

// The editor's change handler: every debounced change to the ABAP - a
// keystroke, a file added or closed, a set of files opened over the old one.
function remember(files) {
  // Embed hook: tells an embedding page when its example has been changed.
  if (embedded) announceEdited(files ?? getFiles());
  renderFiles();
  showSourceLink();
  reflectHistory();
  lessonChanged();
  reflectOriginal();
  autorunAfterChange();
  // The editor has already re-checked by the time this runs (both hang off the
  // same debounce), and the analysis is kept under a key made of the models'
  // version ids - so this reads that result back rather than running a second
  // analysis of text that has not changed since the first.
  //
  // Only when nothing newer is on its way: an analysis under way answers
  // through whenAnalysed( ) in a moment, and drawing the panel now as well
  // drew it twice (three times with Outline open) per pause in the typing -
  // the first time with the problems from before the change.
  const known = refresh();
  if (!analysisPending()) checked(known);
  // Neither an embedding nor the AI Studio keeps a draft: the one shows what
  // its page asked for, the other starts on the same minimal class every time and
  // must not write over the playground's own work. The AI Pilot neither: it
  // operates an app rather than editing one.
  if (embedded || pilotPage) return;
  // The AI Studio keeps a draft of its own, under its own key: what the model
  // built is work, and a reload lost it (together with the chat). Kept apart
  // from the playground's draft so the studio never writes over that, and
  // never restored by itself - the studio starts on the minimal class every
  // time, and the chat's welcome offers the last build back (chat.mjs).
  if (aiPage) {
    const built = files ?? getFiles();
    if (!built.every(isUntouchedStarter)) writeStoredJson(AI_STORAGE_KEY, built);
    return;
  }
  keepDraft(files ?? getFiles());
  // A fragment in the address bar is a claim about what the editor holds, and
  // it just stopped being true. Left there, it would also win over this draft
  // on the next reload (a link outranks stored code in startingFiles), quietly
  // rolling the editor back to whatever was shared before the edits.
  // A ?src= link is the same claim made by the query, and it outranks the
  // draft the same way: kept, a reload - or the bar's Playground item, which
  // reopens the URL written down here - fetched the linked class again and
  // hid the edits made since, until the next keystroke overwrote them in
  // storage too. The rest of the query (from, back, view) still holds.
  const query = new URLSearchParams(window.location.search);
  const linked = query.has("src") || query.has("gist");
  query.delete("src");
  query.delete("gist");
  if (window.location.hash || linked) {
    const rest = query.toString();
    history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
  }
}

// The app on its own, in a tab of its own - the whole window, none of the
// editor around it.
//
// The new tab is a second playground rather than a window onto this one. The
// cheaper thing was there for the taking: the app could have kept asking this
// page for its roundtrips through window.opener, the way the iframe asks its
// parent (frame-link.mjs). It would also have tied the
// app to the tab that opened it - the next Run here resets the database under
// it, and closing this tab would kill it mid-form. A tab that carries its own
// code boots on its own and then owes nothing to anybody.
async function openFullScreen() {
  // Opened before the code is encoded, not after. Encoding is asynchronous, and
  // a window.open that lands after an await is a pop-up as far as the browser
  // is concerned rather than something somebody clicked on.
  const tab = window.open("", "_blank");
  try {
    const url = await appUrl(getFiles());
    if (!tab) {
      // Blocked. Nothing is wrong with the link - it just has to be allowed.
      setStatus("the browser blocked the new tab - allow pop-ups for this page", true);
      return;
    }
    tab.location.replace(url);
    sayBriefly("the app is opening in a new tab");
  } catch (e) {
    tab?.close();
    setStatus("the app could not be opened in a new tab", true);
    showOutput("Full screen", String(e.message || e));
  }
}

// The link first - copied and in the address bar before anything else is on
// screen, because that is what most presses are for - and then the dialog
// with the other ways out (src/shell/share-dialog.mjs). The status line
// says it only for a moment (run-status.mjs): left standing, "link copied"
// read as the state of the page until the next thing anybody did.
async function share() {
  try {
    const files = getFiles();
    const url = await shareUrl(files);
    history.replaceState(null, "", url);
    const copied = await copyToClipboard(url);
    sayBriefly(copied ? "link copied to the clipboard" : "link is in the address bar");
    (await shareReady()).openShare(files, url, copied);
  } catch (e) {
    setStatus("the link could not be built", true);
    showOutput("Share", String(e.message || e));
  }
}

// The net under boot( ).
//
// Its own try/catch covers the two slow starts - the runtime and the registry
// - and nothing else. Everything around that (the editor, the file strip, the
// panel, the dialogs, the examples browser) is code that cannot fail on the
// machine it was written on and does fail on somebody else's, and a throw
// there left the page reading "loading the ABAP runtime…" for ever, with
// nothing but a stack in a console nobody has open. That is how this was
// reported: a service worker was serving one build's assets/shell.mjs under
// the next build's index.html, and the older bundle reached for a control the
// newer document no longer has.
//
// So a failure anywhere in boot( ) is said out loud - and where a service
// worker is serving this page, that mix is the prime suspect, so the cached
// site goes the way it goes for a runtime that never spoke (see the STALLED
// branch above) and the reader is asked for the one thing that repairs it. A
// page nothing is serving from a cache keeps its message and its stack, and
// says nothing about a cache it does not have.
boot().catch(async (e) => {
  if (servedFromCache()) {
    await discardCachedSite();
    setStatus("the playground could not start - the site's cached copy was discarded, please reload", true);
  } else {
    setStatus("the playground could not start", true);
  }
  showOutput("Startup", describeError(e));
});
