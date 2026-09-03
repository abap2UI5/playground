// The playground page.
//
// It owns three things the rest of the code reaches through: the ABAP runtime
// that answers roundtrips, the abaplint registry the editor thinks with, and the
// iframe the app renders in. The iframe asks this page for every roundtrip (see
// frontend-bridge.js); the page hands it to the framework, which runs in a
// worker of this page's (src/shell/runtime-client.mjs), and the frame is only
// a screen.
import "./shell.css";

import {
  canRedo,
  canUndo,
  connectRegistry,
  createEditor,
  currentFile,
  focusProblem,
  format,
  getFiles,
  invalidateAnalysis,
  redo,
  refresh,
  refreshNow,
  reportTranspilerProblems,
  setEditorTheme,
  setFiles,
  undo,
  whenAnalysed,
} from "../editor/editor.mjs";
import { buildRegistry, corpusLanded, declaredObjectName, entryClass, startRegistry } from "../editor/registry.mjs";
import { loadLinter } from "../editor/abap2ui5-lint.mjs";
import { compile } from "../editor/transpile.mjs";
import { checkFileSet, MAIN_FILE, parseName } from "../editor/files.mjs";
import {
  fetchLinkedFiles,
  followNavigation,
  humanUrl,
  linkedSources,
  originOf,
} from "./deep-link.mjs";
import { DEFAULT_FILES, isSample, sampleById } from "../editor/samples.mjs";
import { openExamples, setUpExamples } from "./examples.mjs";
import { render as renderFiles, setUpFiles } from "./files-ui.mjs";
import { setUpInsight, showInsight, updateInsight } from "./insight.mjs";
import { restoreCheckerSettings } from "./checker-settings.mjs";
import { setUpSplitter, setUpTabs } from "./layout.mjs";
import { announceAppHeight, announceReady, announceStatus, startEmbedMessages } from "./embed.mjs";
import { appUrl, copyToClipboard, filesFromLocation, shareUrl } from "./share.mjs";
import { openShare, setUpShareDialog } from "./share-dialog.mjs";
import { clearRoundtrips, recordRoundtrip } from "./roundtrips.mjs";
import { state } from "./state.mjs";
import { STALLED, startRuntime } from "./runtime-client.mjs";
import { readStoredJson, removeStored, writeStoredJson } from "./storage.mjs";
import { isDark, onThemeChange, setUpTheme } from "./theme.mjs";
import { describeError, hideOutput, setStatus, showOutput } from "./ui.mjs";
import { warmUpAppFrame } from "./warm-up.mjs";

// Built rather than written as a literal, so it resolves under a GitHub Pages
// project path as well as at a site root.
const asset = (p) => new URL(p, document.baseURI).href;

const STORAGE_KEY = "abap2ui5-playground:files";

const runButton = document.getElementById("run");
const undoButton = document.getElementById("undo");
const redoButton = document.getElementById("redo");
const formatButton = document.getElementById("format");
const shareButton = document.getElementById("share");
const fullscreenButton = document.getElementById("fullscreen");
const examplesButton = document.getElementById("examples");
const frame = document.getElementById("app");

// Embedded in somebody else's page: no chrome, no sample menu, just the code it
// was given and the app it produces. `?embed=1` in the query, the code in the
// fragment as usual.
const params = new URLSearchParams(window.location.search);
const embedded = params.get("embed") === "1";

// `?view=full` is the app and nothing else - no editor, and no bar either, so
// the tab is the app rather than a playground showing one. That is what the
// Full screen button opens. `?view=app` below keeps its bar on purpose: it is
// furniture in a documentation page, and a demo that cannot be restarted is a
// screenshot - a tab has the browser's own reload and the editor it came from
// one click away.
const bare = params.get("view") === "full";

// `?view=app` drops the editor as well, leaving the running app on its own -
// for the paragraph in a documentation page that wants to show the result
// rather than the code that produced it. The code is still what runs; it is
// just not on screen, so the page stays a playground rather than a screenshot.
const appOnly = bare || params.get("view") === "app";

// Set when a ?src= link could not be followed, so boot can say so once the page
// is far enough along to have somewhere to say it.
let linkFailure;

// Where the editor starts, in order of how deliberate the choice was: a link is
// what somebody was sent, a stored draft is what they were last working on, and
// the sample is the fallback. An embedded playground never restores a draft -
// it shows what the page that embedded it asked for.
async function startingFiles() {
  try {
    const shared = await filesFromLocation(MAIN_FILE);
    if (shared) return { files: checkFileSet(shared), from: "a shared link" };
  } catch {
    // A fragment that will not decode is somebody else's link or a truncated
    // paste. Opening on the sample beats an error page nobody can act on.
  }

  // ?src=<url> - what a documentation page links when it wants to show one of
  // its examples running. Failing here is worth saying out loud: somebody
  // followed a link expecting particular code and did not get it.
  if (linkedSources(params).length > 0) {
    try {
      const linked = checkFileSet(await fetchLinkedFiles(params));
      // An app that calls another app is only half an app on its own. The
      // classes it instantiates are looked for next to it and opened too, so a
      // link to a sample that navigates somewhere actually navigates.
      const alongside = await followNavigation(linked);
      return { files: checkFileSet([...linked, ...alongside]), from: "a link" };
    } catch (e) {
      linkFailure = e;
    }
  }
  if (!embedded) {
    try {
      // A draft that will not parse, or a storage that will not answer, is a
      // draft that is gone - readStoredJson says so with undefined. What is
      // still worth catching here is checkFileSet( ) refusing what it read.
      const stored = readStoredJson(STORAGE_KEY);
      if (stored) return { files: checkFileSet(stored), from: "your last session" };
    } catch {
      // A stored draft the editor cannot hold - a name that stopped being
      // valid, a first file that is not a class. Opening on the sample beats
      // refusing to start.
    }
  }
  return { files: DEFAULT_FILES, from: "sample" };
}

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

async function boot() {
  if (embedded) document.body.classList.add("is-embedded");
  if (appOnly) document.body.classList.add("is-app-only");
  if (bare) document.body.classList.add("is-bare");
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
  // The registry's worker, which fetches the corpus itself and has usually
  // done so by now; picked up here the way the runtime's is.
  startRegistry();
  heard(corpusLanded);

  // What the app frame will load first, fetched into the cache while the
  // corpus parses - see src/shell/warm-up.mjs. After the corpus has landed,
  // not before: until then the network is busy with what the page cannot
  // start without, and these can wait for the stretch where it is not.
  corpusLanded.then(() => warmUpAppFrame(uiTheme())).catch(() => {});

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
  setUpSplitter();
  setUpAbout();
  setUpShareDialog();
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

  const { files } = await startingReady;
  createEditor(document.getElementById("editor"), files, { onChange: remember, dark: isDark() });
  setUpFiles({ onChanged: remember, onOpened: fileOpened });
  setUpInsight();
  // The registry answers from a worker, so what remember( ) and fileOpened( )
  // show is what was last known; this is how the fresh answer reaches the
  // panel, the badge and the fix bar.
  whenAnalysed((problems) => updateInsight(problems));
  // The examples browser hands back either a built-in sample's id or the raw
  // URL of a catalogued class; the URL goes through the same code a ?src=
  // link goes through. It is the one way to a sample - there is no sample
  // menu beside it, and the built-ins are its first group.
  setUpExamples({
    openSample: (id) => loadSample(id, tabs),
    openLinked: (url) => loadLinked(url, tabs),
    // The reader's own drafts (src/shell/drafts.mjs): what is open, to save,
    // and a saved one to open - which runs, the way a sample does.
    currentFiles: () => getFiles(),
    openDraft: (files) => loadDraft(files, tabs),
  });

  try {
    setStatus("loading the ABAP runtime…");
    // The registry first, then the runtime - which is usually up by now, and
    // if it is not, whenReady( ) is what finds out whether it ever will be.
    // Both are already running and both are heard( ), so whichever fails
    // while the other is being awaited still rejects to somebody.
    await registryReady;
    await runtime.whenReady();
    state.runtime = runtime;
    // What the frontend in the app frame reaches for: the roundtrip it would
    // otherwise POST to a backend, and whether the shell has a dialog open -
    // see src/shell/frontend-bridge.js for what the frame does with that.
    window.__z2ui5Playground = {
      // Every roundtrip is kept for the Roundtrips tab on its way through -
      // see src/shell/roundtrips.mjs. Timed around the worker's answer, so
      // the number is the ABAP plus the message hops and not the render.
      roundtrip: async (body) => {
        const started = performance.now();
        try {
          const response = await state.runtime.roundtrip(body);
          recordRoundtrip({ request: body, response, ms: performance.now() - started });
          if (response.location) pointAtDump(response.location, firstLine(response.body));
          return response;
        } catch (e) {
          // A JavaScript error out of the transpiled code, rather than an
          // ABAP exception the framework turned into a dump: the frame's
          // fetch rejects, and the line is still worth pointing at.
          if (e?.location) pointAtDump(e.location, String(e.message ?? e));
          throw e;
        }
      },
      dialogOpen: () => document.querySelector("dialog[open]") !== null,
    };
    const version = `abap2UI5 ${state.runtime.abapVersion()}`;
    document.getElementById("versions").textContent = version;
    document.getElementById("about-versions").textContent = version;

    connectRegistry();
    // The analysis just run had whatever the linter had to say - which is
    // nothing if its chunk was still on its way. When it lands, the kept
    // answer is thrown away and asked for again; if it has landed already,
    // this runs at once and costs one incremental analysis.
    linterReady
      .then(() => {
        invalidateAnalysis();
        updateInsight(refresh());
      })
      .catch((e) => showOutput("abap2UI5 lint", `The abap2UI5 linter could not be loaded: ${String(e?.message ?? e)}`));
  } catch (e) {
    if (e?.name === STALLED) {
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

  for (const control of [runButton, formatButton, shareButton, fullscreenButton, examplesButton]) {
    control.disabled = false;
  }
  showSourceLink();

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
  formatButton.addEventListener("click", () => format());
  shareButton.addEventListener("click", () => share());
  fullscreenButton.addEventListener("click", () => openFullScreen());
  examplesButton.addEventListener("click", () => openExamples());

  // A theme change - the switch in the bar, or the sun going down on a page
  // that follows the system - must not restart the app: somebody has a
  // half-filled form open. UI5 can swap its theme at runtime, so the running
  // frame is told rather than reloaded; a frame that cannot be told keeps the
  // theme it started with until the next Run. The editor is told as well.
  onThemeChange(() => {
    setEditorTheme(isDark());
    applyFrameTheme();
  });

  // Ctrl+S as well as Ctrl+Enter: the hand that has typed in an editor for
  // twenty years presses it, and a browser answers with a dialog for saving
  // the page as HTML, which nobody has ever wanted here.
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "Enter" || e.key === "s" || e.key === "S")) {
      e.preventDefault();
      runAndShow();
    }
  });

  await run();
  // Said once the playground has something to show, not once it has loaded -
  // an embedding page revealing the frame any earlier would reveal a blank one.
  announceReady();

  // After the first run, not before: run() opens with a clear of the output
  // panel, so a message shown earlier would be wiped by the very next line.
  if (linkFailure) {
    setStatus("the link could not be followed - showing the sample instead", true);
    showOutput("Link", String(linkFailure.message || linkFailure));
  }

  keepAssetsForNextTime();
}

// Registers the service worker that makes a second visit cheap - see
// src/shell/sw.js for what it keeps and what it deliberately leaves alone.
//
// Last, once the page is up and the app is running. The worker fills its cache
// by fetching the heavy assets itself, and every one of them is in the
// browser's cache by now because this page has just downloaded them - so doing
// it here costs almost nothing, where doing it during boot would have put those
// fetches next to the ones the visitor is actually waiting on. Nothing on the
// page depends on any of this working.
function keepAssetsForNextTime() {
  if (!("serviceWorker" in navigator)) return;
  // No scope given: a worker's default scope is the directory it was served
  // from, which is the site's own directory at an origin root and under a
  // GitHub Pages project path alike.
  navigator.serviceWorker.register(new URL("sw.js", document.baseURI)).catch(() => {
    // A browser that will not have one - a private window, a policy, an origin
    // that is not secure - loses the second visit's head start and nothing
    // else. There is nothing here to tell anybody about.
  });
}

// The opposite of keepAssetsForNextTime( ): every cache this site wrote and
// the worker that serves from them, gone, so the next load fetches the site
// as it is now. Nothing here can fail in a way worth reporting - a browser
// without either has nothing to discard.
async function discardCachedSite() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.unregister();
  } catch {
    // No worker, or no permission to ask - nothing to throw away.
  }
  try {
    for (const name of await caches.keys()) {
      if (name.startsWith("abap2ui5-playground-")) await caches.delete(name);
    }
  } catch {
    // No Cache API, or a storage that refuses - the reload fetches fresh anyway.
  }
}

// The credits, and what this is. Wired outside boot()'s try/catch and before
// the runtime is awaited, so it still opens on a page whose startup failed -
// that is exactly when somebody wants the link to the issue tracker.
function setUpAbout() {
  const dialog = document.getElementById("about-dialog");
  document.getElementById("about").addEventListener("click", () => dialog.showModal());
  // A click on the backdrop closes it, the way a modal is expected to.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}

const uiTheme = () => (isDark() ? "sap_horizon_dark" : "sap_horizon");

function applyFrameTheme() {
  try {
    const ui5 = frame.contentWindow?.sap?.ui;
    // UI5 1.x and 2.x name this differently, and neither exists until the
    // component has booted.
    const theming = ui5?.require?.("sap/ui/core/Theming");
    if (theming?.setTheme) theming.setTheme(uiTheme());
    else ui5?.getCore?.()?.applyTheme?.(uiTheme());
  } catch {
    // A frame that is mid-load, or a UI5 that does not expose this, keeps the
    // theme it started with. The next Run picks the current one up.
  }
}

// A different file is now on screen: the outline is about that file, and so is
// the link to where it came from, and so is what Undo has to take back.
function fileOpened() {
  showSourceLink();
  reflectHistory();
  updateInsight(refresh());
}

// Undo and Redo follow the open file's history: live while there is an edit
// to take back or to do again, inactive otherwise. Monaco keeps the stack per
// model, so switching files switches what the buttons mean.
function reflectHistory() {
  undoButton.disabled = !canUndo();
  redoButton.disabled = !canRedo();
}

// The way back to where linked code lives, following whichever file is open.
// Live only for files that actually came from a link: over a draft or a
// sample it would be a link to somebody else's page with no relation to what
// is on screen - so there it stays in the bar, inactive, rather than
// disappearing and having the controls beside it shift.
export function showSourceLink() {
  const link = document.getElementById("source-link");
  const origin = originOf(currentFile());
  if (origin === undefined) {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    link.title = "Only code that came from GitHub has a page to go to";
    return;
  }
  link.href = humanUrl(origin);
  link.removeAttribute("aria-disabled");
  link.title = `Open ${currentFile()} where it lives`;
}

function remember(files) {
  renderFiles();
  showSourceLink();
  reflectHistory();
  // The editor has already re-checked by the time this runs (both hang off the
  // same debounce), and the analysis is kept under a key made of the models'
  // version ids - so this reads that result back rather than running a second
  // analysis of text that has not changed since the first.
  updateInsight(refresh());
  if (embedded) return;
  // A sample that was picked and read is not a draft, and is forgotten rather
  // than stored - the rule the checker settings already follow. Kept, it pinned
  // the reader to a frozen copy: the sample was improved in a later deploy and
  // they went on being opened on the old one, findings and all, labelled as
  // their own last session. One keystroke makes it a draft again.
  const current = files ?? getFiles();
  if (isSample(current)) removeStored(STORAGE_KEY);
  else writeStoredJson(STORAGE_KEY, current);
  // A fragment in the address bar is a claim about what the editor holds, and
  // it just stopped being true. Left there, it would also win over this draft
  // on the next reload (a link outranks stored code in startingFiles), quietly
  // rolling the editor back to whatever was shared before the edits.
  if (window.location.hash) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

// A built-in sample, chosen in the samples browser.
function loadSample(id, tabs) {
  const sample = sampleById(id);
  if (!sample) return;
  const hadDraft = replaceWith(sample.files);
  // Picking a sample is a request to see it, so it runs without a second click.
  run().then((started) => {
    if (started) tabs.show("right");
    if (hadDraft) sayDraftIsKept();
  });
}

// A named draft, chosen in the samples browser - the same move as a sample,
// with the same word about the draft it replaced.
function loadDraft(files, tabs) {
  let checked;
  try {
    checked = checkFileSet(files);
  } catch (e) {
    setStatus("the draft could not be opened", true);
    showOutput("Drafts", String(e.message || e));
    return;
  }
  const hadDraft = replaceWith(checked);
  run().then((started) => {
    if (started) tabs.show("right");
    if (hadDraft) sayDraftIsKept();
  });
}

// Puts a set of files in the editor in place of what is there, and answers
// whether what was there was somebody's own work - a draft rather than a
// sample as it was opened - which setFiles( ) has kept in the undo stack.
function replaceWith(files) {
  const hadDraft = !isSample(getFiles());
  setFiles(files.map((f) => ({ ...f })));
  renderFiles();
  return hadDraft;
}

// Said after the run, because run( ) ends by writing "running" over the
// status line - and said at all because a click that replaced an hour's work
// is the one moment the reader has to be told the work is not gone.
function sayDraftIsKept() {
  setStatus("running - your draft is one Undo away");
}

// A catalogued example, chosen in the examples browser. The URL goes down the
// same path a ?src= link goes down - fetched and checked by deep-link.mjs, the
// classes it needs looked for beside it, the first file the app - just without
// the page reload a link would cost, because the registry this page has
// already built serves the new files as well as it served the old.
async function loadLinked(url, tabs) {
  try {
    setStatus("fetching the example…");
    const linked = checkFileSet(await fetchLinkedFiles(new URLSearchParams([["src", url]])));
    const alongside = await followNavigation(linked);
    const hadDraft = replaceWith(checkFileSet([...linked, ...alongside]));
    if (await run()) tabs.show("right");
    if (hadDraft) sayDraftIsKept();
  } catch (e) {
    // The catalogue said the class is there and it was not, or the fetch
    // failed under way. Somebody clicked expecting particular code, so this
    // failure is said out loud - unlike a catalogue that never loaded.
    setStatus("the example could not be opened", true);
    showOutput("Samples", String(e.message || e));
  }
}

// The app on its own, in a tab of its own - the whole window, none of the
// editor around it.
//
// The new tab is a second playground rather than a window onto this one. The
// cheaper thing was there for the taking: it is the same origin, so the app
// could have kept asking this page for its roundtrips through window.opener,
// the way the iframe asks through window.parent. It would also have tied the
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
    setStatus("the app is opening in a new tab");
  } catch (e) {
    tab?.close();
    setStatus("the app could not be opened in a new tab", true);
    showOutput("Full screen", String(e.message || e));
  }
}

// The link first - copied and in the address bar before anything else is on
// screen, because that is what most presses are for - and then the dialog
// with the other ways out (src/shell/share-dialog.mjs).
async function share() {
  try {
    const files = getFiles();
    const url = await shareUrl(files);
    history.replaceState(null, "", url);
    const copied = await copyToClipboard(url);
    setStatus(copied ? "link copied to the clipboard" : "link is in the address bar");
    openShare(files, url, copied);
  } catch (e) {
    setStatus("the link could not be built", true);
    showOutput("Share", String(e.message || e));
  }
}

// A dump, at the line it was raised at. The framework has already answered
// the frontend with the dump and the frame is showing it; this is the half
// the frame cannot do - underline the line in the editor, list it under
// Problems as a runtime error, and put the cursor there - the way a
// transpiler error is pointed at. It goes away with the next edit, like
// that one.
function pointAtDump(location, message) {
  const said = `${location.exception ? `${location.exception}: ` : ""}${message || "the app dumped here"}`;
  reportTranspilerProblems([{ file: location.file, line: location.line, message: said }], "runtime");
  updateInsight(refresh());
  showInsight("problems");
  focusProblem(location.file, location.line, 1);
  setStatus(`the app dumped - ${location.file} line ${location.line}`, true);
}

// The first line of a dump that says something - the framework's dump
// starts with a heading and the request it failed in, and the sentence a
// reader wants is the exception's own text, a few lines down.
function firstLine(body) {
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
  if (parseName(files[0].name)?.kind !== "clas") {
    return `The playground starts the class in the first file, and ${files[0].name} is not a class.`;
  }
  for (const file of files) {
    const expected = parseName(file.name)?.object;
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

// Starts what is in the editor: compile it, register it with the runtime, then
// a new database and a new frame.
//
// The frame is reloaded rather than told to restart, because a reload is the
// only thing that resets everything the frontend keeps outside the model - view
// slots, routing state, the UI5 component itself. The counter in the URL makes
// each run a different document, so the browser cannot serve a cached one and
// the load event is unambiguous.
let running = false;

export async function run() {
  // Ctrl+Enter and the sample menu call this too, so the guard cannot be the
  // Run button being disabled: two runs would race on the frame's src and on
  // the one-shot load listener, and the second reset would land under a frame
  // that is still booting the first.
  if (running) return;
  running = true;
  runButton.disabled = true;
  // Whatever the last run had to say about itself is no longer true.
  hideOutput();
  try {
    const files = getFiles();

    const structural = structuralProblem(files);
    if (structural) {
      setStatus("the playground cannot start this", true);
      showOutput("ABAP", structural);
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
      setStatus(`${errors.length} error${errors.length > 1 ? "s" : ""} in the ABAP - fix them and run again`, true);
      // The errors are already in the panel, one clickable row each, saying
      // which checker spoke. Writing them into the Log as well would put the
      // same list twice into one panel and show the poorer copy - so this
      // brings the reader to the list instead of retyping it.
      showInsight("problems");
      focusProblem(errors[0].file, errors[0].range.start.line + 1, errors[0].range.start.character + 1);
      return;
    }

    setStatus("compiling…");
    const chunks = await compile(files);
    state.runtime.defineClasses(chunks.map(({ name, js, lines }) => ({ name, js, lines })));

    setStatus("starting the app…");
    await state.runtime.resetDatabase();
    // A run is a fresh app; what the last one said to its frontend is over.
    clearRoundtrips();

    state.runCounter += 1;
    const src = new URL("app/index.html", document.baseURI);
    src.searchParams.set("app_start", entryClass(files));
    src.searchParams.set("run", String(state.runCounter));
    // UI5 reads sap-ui-* from the query and it wins over the bootstrap tag, so
    // the app follows the same light or dark the rest of the page does. Both
    // themes are built into dist/app; a third would have to be added there.
    src.searchParams.set("sap-ui-theme", uiTheme());

    // Bounded, because everything in run() hangs off this one event: if the
    // frame never fires it, `running` would stay true and Run would be dead
    // until a full reload. Thirty seconds is an eternity for a same-origin
    // document - reaching it means the load is not coming.
    await new Promise((resolve, reject) => {
      const gaveUp = setTimeout(() => reject(new Error("The app frame did not load.")), 30000);
      frame.addEventListener(
        "load",
        () => {
          clearTimeout(gaveUp);
          resolve();
        },
        { once: true },
      );
      frame.src = src.href;
    });
    setStatus("running");
    // After the load event, so the app has rendered and has a height to report.
    if (appOnly) announceAppHeight(frame);
    // Answered rather than returned blank, because on a narrow screen the
    // caller brings the app forward - and every path out of here above this
    // line is one where there is no app to bring: nothing compiled, or the
    // problems list is what the reader now needs to be looking at.
    return true;
  } catch (e) {
    setStatus("the app could not be started", true);
    showOutput("Run", String(e.message || e));
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
        focusProblem(first.file, first.range.start.line + 1, 1);
      }
    }
  } finally {
    running = false;
    runButton.disabled = false;
  }
}

boot();
