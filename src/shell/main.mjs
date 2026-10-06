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
  openFile,
  redo,
  refresh,
  refreshNow,
  reportTranspilerProblems,
  setEditorTheme,
  setFiles,
  undo,
  whenAnalysed,
  analysisPending,
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
  forgetOrigins,
  originOf,
} from "./deep-link.mjs";
import { DEFAULT_FILES, isSample, SAMPLES, sampleById } from "../editor/samples.mjs";
import { openExamples, setUpExamples } from "./examples.mjs";
import { render as renderFiles, setUpFiles } from "./files-ui.mjs";
import { setTestResults, setUpInsight, showInsight, updateInsight } from "./insight.mjs";
import { restoreCheckerSettings } from "./checker-settings.mjs";
import { setUpSplitter, setUpTabs } from "./layout.mjs";
import { keepSiteLinksCurrent, rememberHere } from "./site-memory.mjs";
import { setUpSearch } from "./search-box.mjs";
import { announceAppHeight, announceReady, announceStatus, startEmbedMessages } from "./embed.mjs";
import { appUrl, copyToClipboard, filesFromLocation, shareUrl } from "./share.mjs";
import { openShare, setUpShareDialog } from "./share-dialog.mjs";
import { clearRoundtrips, recordRoundtrip, roundtripList } from "./roundtrips.mjs";
import { chatDropped, setUpChat } from "./chat.mjs";
import { pilotDropped, pilotPicked, pilotRan, sawRoundtrip, setUpPilot, takePilotRequest } from "./pilot.mjs";
import { AI_FILE, AI_STARTER, isUntouchedStarter } from "./ai-starter.mjs";
import { state } from "./state.mjs";
import { RUNAWAY, STALLED, startRuntime } from "./runtime-client.mjs";
import { readStored, readStoredJson, removeStored, writeStored, writeStoredJson } from "./storage.mjs";
import { isDark, onThemeChange, setUpTheme } from "./theme.mjs";
import { setUpExtra } from "./extra.mjs";
import { closeOnBackdrop, currentLog, describeError, hideOutput, setStatus, showOutput } from "./ui.mjs";
import { warmUpAppFrame } from "./warm-up.mjs";

// Built rather than written as a literal, so it resolves under a GitHub Pages
// project path as well as at a site root.
const asset = (p) => new URL(p, document.baseURI).href;

const STORAGE_KEY = "abap2ui5-playground:files";

const runButton = document.getElementById("run");
const autorunButton = document.getElementById("autorun");
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

// The AI Studio's page (ai/index.html, written by tools/build-site.mjs from
// this document): the studio opens on its own, on the minimal class of
// ai-starter.mjs, and what is built there is neither restored from nor stored
// over the playground's own draft. The playground itself has no way into the studio while it is being
// built - its address is the door.
const aiPage = document.documentElement.dataset.page === "ai";

// The AI Pilot's page (pilot/index.html, written the same way): a chat in
// which Claude operates the running app while the reader watches - see
// src/shell/pilot.mjs. It opens on what a link carries, else on the default
// sample, and like the studio it neither restores nor stores the
// playground's draft.
const pilotPage = document.documentElement.dataset.page === "pilot";

/* Opened from the sample catalogue - see showSourceLink( ). `back` is that
 * page's own query string, passed through so the reader lands on the search
 * they had narrowed the list to. It is rebuilt through URLSearchParams rather
 * than pasted into the href, so nothing a link carries escapes into the
 * markup: what comes back out is a query string and only ever that. */
const cameFromCatalogue = params.get("from") === "catalogue";
const catalogueQuery = (() => {
  const back = params.get("back") || "";
  if (back === "") return "";
  const clean = new URLSearchParams(back).toString();
  return clean === "" ? "" : `?${clean}`;
})();

// The app and nothing else - no editor, and no bar over it either, so what is
// on screen is the app rather than a playground showing one. Two names for it,
// because they are two different asks with the same answer: `?view=full` is
// what the Full screen button opens, and `?view=app` is the paragraph in a
// documentation page that wants to show the result rather than the code that
// produced it. The code is still what runs; it is just not on screen, so the
// page stays a playground rather than a screenshot.
//
// The bar used to stay in `?view=app` on the theory that a demo which cannot
// be restarted is a screenshot. It is not: an embedded demo runs by itself,
// and everything the bar offered next to it - Run again, the source, undo -
// is a click away in "Open in the playground", which the page around the
// frame already prints. What it did instead was put a strip of somebody
// else's furniture across the top of a documentation page. The one thing that
// still brings it back is trouble (`has-trouble`): in this view the status
// line is the only channel there is, so a link that could not be followed has
// to have somewhere to say so.
const appOnly = params.get("view") === "app" || params.get("view") === "full";

// Set when a ?src= link could not be followed, or the code in a shared link
// could not be read, so boot can say so once the page is far enough along to
// have somewhere to say it.
let linkFailure;

// Where the editor starts, in order of how deliberate the choice was: a link is
// what somebody was sent, a stored draft is what they were last working on, and
// the sample is the fallback. An embedded playground never restores a draft -
// it shows what the page that embedded it asked for.
async function startingFiles() {
  if (aiPage) return { files: [{ name: AI_FILE, source: AI_STARTER }], from: "a minimal class" };
  try {
    const shared = await filesFromLocation(MAIN_FILE);
    if (shared) return { files: checkFileSet(shared), from: "a shared link" };
  } catch (e) {
    // A fragment that will not decode is somebody else's link or a truncated
    // paste. Opening on the sample beats an error page nobody can act on -
    // and saying so beats opening on the sample as if that were the link:
    // the Share dialog promises the sender that a torn link "says so".
    linkFailure = new Error(
      `The code in this link could not be read - a pasted link may have been cut short. ${e?.message || e}`,
    );
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
  if (!embedded && !pilotPage) {
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

// The Anthropic key an earlier version of the AI chat kept in localStorage.
// chat.mjs takes it out - but only on the studio's own page, and the pages
// where a link's ABAP runs and can read this origin's storage (a view's
// core:HTML, a WRITE '@KERNEL …') are this one, embedded or not, and the
// Pilot's. So it goes on every page, before any linked code has run.
const LEGACY_KEY = "abap2ui5-playground:anthropic-key";

async function boot() {
  removeStored(LEGACY_KEY);
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
  // The menu the switch is in opens on its own, being a <details>; this only
  // closes it on a click anywhere else and on Escape (extra.mjs).
  setUpExtra();
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
  // that was picked and read is deliberately not stored (see remember( )
  // below) - so pressing Documentation and then Playground threw it away and
  // started them on the default sample. The URL is what carries it, so the URL
  // is what is written: on the way out, which is when it is final, and again
  // when the tab is hidden, because pagehide is not promised on every route
  // out of a page.
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
  setUpAutorun({ restore: !embedded && !pilotPage });
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

  const { files, from } = await startingReady;
  startedFrom = from;
  createEditor(document.getElementById("editor"), files, { onChange: remember, dark: isDark() });
  // What a link or the default sample put in is not the reader's work until
  // they change it (see `opened`); a restored draft is.
  if (from !== "your last session") opened = JSON.stringify(getFiles());
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
  // panel, the badge and the fix bar.
  whenAnalysed((problems) => updateInsight(problems));
  // The examples browser hands back either a built-in sample's id or the raw
  // URL of a catalogued class; the URL goes through the same code a ?src=
  // link goes through. It is the one way to a sample - there is no sample
  // menu beside it, and the built-ins are its first group.
  setUpExamples({
    // On the Pilot's page a pick goes to the Pilot, which opens it in place
    // of the app on screen or beside it (src/shell/pilot.mjs).
    openSample: (id) => (pilotPage ? pilotPicked(sampleById(id)?.files) : loadSample(id, tabs)),
    openLinked: (url) => (pilotPage ? pilotPicked(carriedFiles(url) ?? linkedFiles(url)) : loadLinked(url, tabs)),
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
      roundtrip: async (body, from) => {
        // An app from a Run that has been replaced: a timer or a click in the
        // old frame in the moment before the new document arrives ran against
        // the new Run's fresh database, and was listed as the new Run's first
        // roundtrip. Refused instead - that frame is on its way out. A frame
        // that says nothing (an older bridge script) is served as before.
        const run = from ? new URL(from, document.baseURI).searchParams.get("run") : null;
        if (run !== null && run !== String(state.runCounter)) throw new Error("this app was replaced by a newer Run");
        // The AI Pilot's act (src/shell/pilot.mjs): the frame was made to send
        // a roundtrip so that it renders the answer, and what goes to the
        // framework is the Pilot's request in place of the frame's. Every
        // answer, the reader's clicks included, is shown to the Pilot after.
        const pilot = takePilotRequest(from);
        if (pilot) body = pilot.body;
        const started = performance.now();
        try {
          const response = await state.runtime.roundtrip(body);
          recordRoundtrip({ request: body, response, ms: performance.now() - started });
          sawRoundtrip(body, response, from);
          pilot?.resolve(response);
          if (response.location) pointAtDump(response.location, firstLine(response.body), caretMayMove());
          return response;
        } catch (e) {
          // A JavaScript error out of the transpiled code, rather than an
          // ABAP exception the framework turned into a dump: the frame's
          // fetch rejects, and the line is still worth pointing at.
          pilot?.reject(e);
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
      // The bar's search panel counts: it is modal too (search-box.mjs makes
      // the page under it inert), and an app rendering while it was open -
      // the first render of a Run - took the focus, and the rest of the
      // search was typed into the app.
      dialogOpen: () => document.querySelector("dialog[open], .search-scrim:not([hidden])") !== null,
      // Files dropped on the app in a frame, on the AI Pilot's page or the AI
      // Studio's: they go to that page's chat (pilot.mjs, chat.mjs).
      // Elsewhere a frame keeps the browser's own answer to a drop.
      dropFiles: pilotPage ? (files) => pilotDropped(files) : aiPage ? (files) => chatDropped(files) : undefined,
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
      .then(async () => {
        invalidateAnalysis();
        // The fresh answer, not the emptied one invalidateAnalysis( ) left.
        updateInsight(await refreshNow());
      })
      .catch((e) => showOutput("abap2UI5 lint", `The abap2UI5 linter could not be loaded: ${String(e?.message ?? e)}`));
  } catch (e) {
    // Only where a service worker serves the page is there a cached copy to
    // throw away; without one, saying it was discarded was untrue and the
    // reload asked for changed nothing.
    if (e?.name === STALLED && navigator.serviceWorker?.controller) {
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
  booted = true;
  reflectRunButton();
  showSourceLink();

  // The AI chat (src/shell/chat.mjs, src/shell/ai-agent.mjs): the model works
  // on the same editor and presses the same Run, through these. Only on the
  // studio's own page - the playground carries no way into it.
  if (aiPage && !embedded) {
    setUpChat(
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
      },
      // The studio is the page: it opens at once, and there is no playground
      // under it to leave to.
      { startOpen: true },
    );
  }

  // The AI Pilot (src/shell/pilot.mjs): the model operates the app in the
  // frame. It opens the samples the way the samples browser does and
  // restarts the app the way Run does - these, and nothing else.
  if (pilotPage && !embedded) {
    setUpPilot({
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
      // One of the samples the page carries, by its class - no network.
      carried: (cls) => carriedClass(cls),
      openSamples: () => openExamples(),
      frame: () => frame.contentWindow?.__z2ui5PlaygroundPilot,
      appClass: () => entryClass(getFiles()),
    });
  }

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

  // Ctrl+S as well as Ctrl+Enter: the hand that has typed in an editor for
  // twenty years presses it, and a browser answers with a dialog for saving
  // the page as HTML, which nobody has ever wanted here.
  // Not from inside a dialog: Ctrl+S in the Share dialog's textarea, or
  // Ctrl+Enter in the samples browser's search, would start a run behind the
  // modal the reader is looking at.
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "Enter" || e.key === "s" || e.key === "S")) {
      if (e.target instanceof Element && e.target.closest("dialog")) return;
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

  // After the first run, not before: run() opens with a clear of the output
  // panel, so a message shown earlier would be wiped by the very next line.
  if (linkFailure) {
    // What is on screen instead is the stored draft when there is one, not
    // always the sample - the sentence used to say "the sample" regardless.
    setStatus(
      `the link could not be followed - showing ${startedFrom === "your last session" ? "your last session" : "the sample"} instead`,
      true,
    );
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

// Where this code came from - and the whole point of the button is that there
// is somewhere to go back TO.
//
// Two origins, and they want different destinations. A link somebody pasted
// leads to the file on GitHub: the repository around it, the neighbouring
// files, the history. A row on the sample catalogue leads back to the
// CATALOGUE, because somebody who came from a list of 770 samples to run one
// of them is not done with the list - and `back` carries the filters they had
// narrowed it to, so they land on their search rather than at the top of it.
// The catalogue sets both parameters (src/catalogue/catalogue.mjs).
//
// Live only for files that actually came from a link: over a draft or a
// sample of this page's own it would be a link to somebody else's page with no
// relation to what is on screen - so there it stays in the bar, inactive,
// rather than disappearing and having the controls beside it shift.
export function showSourceLink() {
  const link = document.getElementById("source-link");
  const origin = originOf(currentFile());
  if (origin === undefined) {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    link.title = "Only code that came from GitHub has a page to go to";
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

function remember(files) {
  renderFiles();
  showSourceLink();
  reflectHistory();
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
  if (!analysisPending()) updateInsight(known);
  // Neither an embedding nor the AI Studio keeps a draft: the one shows what
  // its page asked for, the other starts on the same minimal class every time and
  // must not write over the playground's own work. The AI Pilot neither: it
  // operates an app rather than editing one.
  if (embedded || aiPage || pilotPage) return;
  // A sample that was picked and read is not a draft, and is forgotten rather
  // than stored - the rule the checker settings already follow. Kept, it pinned
  // the reader to a frozen copy: the sample was improved in a later deploy and
  // they went on being opened on the old one, findings and all, labelled as
  // their own last session. One keystroke makes it a draft again.
  const current = files ?? getFiles();
  // A sample that was picked and read is not a draft and is not stored. What
  // was stored BEFORE it is left where it is: a sample brings its own class
  // name now, so opening one disposes the model the reader's work was in and
  // Undo cannot reach it any more. The stored copy is then the only way back,
  // and deleting it here threw away the very thing the status line promises.
  // One keystroke in the sample makes it a draft and takes its place.
  // Nor are files exactly as a link or the samples browser put them in: a
  // catalogued sample is not one isSample( ) knows, and opening one from the
  // browser used to write it straight over the stored draft - while the
  // status line promised that draft "comes back if you reload".
  // While replaceWith( ) is putting them in: setFiles( ) reports the change
  // before `opened` can be set to what it put there, and a catalogued sample
  // or a named draft was stored over the draft in that one call.
  const pristine = openingAsOpened || (opened !== undefined && JSON.stringify(current) === opened);
  if (!isSample(current) && !pristine) writeStoredJson(STORAGE_KEY, current);
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
  const linked = query.has("src");
  query.delete("src");
  if (window.location.hash || linked) {
    const rest = query.toString();
    history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
  }
}

// Which pick in the samples browser is the latest. A catalogue example is
// fetched, so a slow one picked first could land AFTER a sample picked
// second - and replace it in the editor and run it, the reader having asked
// for the other. Each pick takes a number; a fetch that comes back to find a
// newer one drops what it fetched.
let latestPick = 0;

// One of the samples the page carries, chosen in the samples browser.
function loadSample(id, tabs) {
  const sample = sampleById(id);
  if (!sample) return;
  latestPick++;
  forgetOrigins();
  const keptHow = replaceWith(sample.files);
  // Picking a sample is a request to see it, so it runs without a second click.
  runWhenFree().then((started) => {
    if (!started) return;
    tabs.show("right");
    if (keptHow) sayDraftIsKept(keptHow);
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
  latestPick++;
  forgetOrigins();
  const keptHow = replaceWith(checked);
  runWhenFree().then((started) => {
    if (!started) return;
    tabs.show("right");
    if (keptHow) sayDraftIsKept(keptHow);
  });
}

// Puts a set of files in the editor in place of what is there, and answers what
// happened to what was there: whether it was somebody's own work - a draft
// rather than a sample as it was opened - and whether Undo can still reach it.
//
// It can only reach a file that is still open. setFiles( ) writes the new
// source into a model whose file it can reuse, which is an undoable edit; a
// file that is not in the new set is disposed, and its history with it. That
// used to be the rare case, because every sample the playground carried was
// called zcl_playground.clas.abap. The samples come out of abap2UI5/samples
// now and bring their own class names, so it is the ordinary one - which is
// why the sentence below is chosen rather than fixed, and why remember( )
// leaves a stored draft alone when a sample goes in over it.
function replaceWith(files, { asOpened = true } = {}) {
  const before = getFiles();
  // Somebody's own work - not a sample, and not files left exactly as they
  // were opened.
  const hadDraft = !isSample(before) && JSON.stringify(before) !== opened;
  const undoable = before.every((f) => files.some((n) => n.name === f.name));
  openingAsOpened = asOpened;
  try {
    setFiles(files.map((f) => ({ ...f })));
  } finally {
    openingAsOpened = false;
  }
  opened = asOpened ? JSON.stringify(getFiles()) : undefined;
  renderFiles();
  return hadDraft && (undoable ? "undo" : "reload");
}

// The files as the last load put them in, as text - a sample, a catalogued
// class, a named draft, a link. Until they are changed they are not a draft
// of the reader's, and remember( ) does not store them over the one there is.
let opened;
// Set while replaceWith( ) writes files that are "as opened" into the
// editor - see remember( ).
let openingAsOpened = false;
// Where the editor's starting files came from (startingFiles( )).
let startedFrom;

// Run, once the run under way (if any) has finished. A sample opened while
// another one was still starting went into the editor, and its run returned
// at once because one was under way: the editor held one sample and the
// frame ran the other, with "running" in the status line.
async function runWhenFree() {
  while (running) await new Promise((resolve) => setTimeout(resolve, 100));
  return run();
}

// Said after the run, because run( ) ends by writing "running" over the
// status line - and said at all because a click that replaced an hour's work
// is the one moment the reader has to be told the work is not gone. Only
// after a run that started: one that stopped on an abaplint error or a
// transpiler refusal has said so in red, and "running - ..." over it was
// both untrue and the end of the only sentence that mattered.
function sayDraftIsKept(how) {
  setStatus(
    how === "undo" ? "running - your draft is one Undo away" : "running - your draft comes back if you reload",
  );
}

// A catalogued example, chosen in the examples browser. The URL goes down the
// same path a ?src= link goes down - fetched and checked by deep-link.mjs, the
// classes it needs looked for beside it, the first file the app - just without
// the page reload a link would cost, because the registry this page has
// already built serves the new files as well as it served the old.
async function loadLinked(url, tabs) {
  const pick = ++latestPick;
  try {
    setStatus("fetching the example…");
    const linked = checkFileSet(await fetchLinkedFiles(new URLSearchParams([["src", url]])));
    const alongside = await followNavigation(linked);
    if (pick !== latestPick) return;
    const keptHow = replaceWith(checkFileSet([...linked, ...alongside]));
    if (await runWhenFree()) {
      tabs.show("right");
      if (keptHow) sayDraftIsKept(keptHow);
    }
  } catch (e) {
    if (pick !== latestPick) return;
    // The catalogue said the class is there and it was not, or the fetch
    // failed under way. Somebody clicked expecting particular code, so this
    // failure is said out loud - unlike a catalogue that never loaded.
    setStatus("the example could not be opened", true);
    showOutput("Samples", String(e.message || e));
  }
}

// One of the samples the page carries, by its class - no network.
const carriedClass = (cls) => SAMPLES.find((s) => s.files[0].name === `${cls.toLowerCase()}.clas.abap`)?.files;
// ...and by the raw URL the samples browser hands over for its catalogue row:
// the AI Pilot opens the copy the page carries rather than fetching it.
const carriedFiles = (url) => carriedClass(String(url).split("/").pop().replace(/\.clas\.abap$/, ""));

// A catalogued class by its raw URL and the classes it needs beside it, as
// files - the ?src= path without the run.
async function linkedFiles(url) {
  const linked = checkFileSet(await fetchLinkedFiles(new URLSearchParams([["src", url]])));
  return checkFileSet([...linked, ...(await followNavigation(linked))]);
}

// The AI Pilot's further apps (src/shell/pilot.mjs): `files` go into the
// editor beside what is there (a file of the same name is replaced), `first`
// names the file Run is to start from now on, and the whole set is checked,
// compiled and defined - the same steps as run( ) up to the classes, and not
// one step further: no fresh database, no Run counted, no frame reloaded. The
// runtime defines a set of classes as a whole (defineClasses( ) puts back what
// the last set shadowed), which is why the apps already open are compiled
// again with the new one rather than the new one alone.
async function addAppFiles(files, { first } = {}) {
  while (running) await new Promise((resolve) => setTimeout(resolve, 100));
  running = true;
  reflectRunButton();
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
      return { started: false, status: `${errors.length} error${errors.length > 1 ? "s" : ""} in the ABAP`, problems };
    }
    const { chunks } = await compile(getFiles());
    await state.runtime.defineClasses(chunks.map(({ name, js, lines }) => ({ name, js, lines })));
    return { started: true, status: "running", problems };
  } catch (e) {
    return { started: false, status: String(e?.message ?? e), problems: [] };
  } finally {
    running = false;
    reflectRunButton();
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
function pointAtDump(location, message, moveCaret = true) {
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
const caretMayMove = () => !(quietRun !== undefined && quietRun === state.runCounter && roundtripList().length <= 1);

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
  const first = parseName(files[0].name);
  if (first?.kind !== "clas" || first.include) {
    return `The playground starts the class in the first file, and ${files[0].name} is not a class.`;
  }
  for (const file of files) {
    const parsed = parseName(file.name);
    // A test include declares local test classes, not the object; abaplint
    // checks what is in it.
    if (parsed?.include) continue;
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

// ------------------------------------------------------------------ autorun
//
// Run, pressed for you. Off by default; the switch beside Run says which it
// is, and while it is on Run itself is inactive - there is nothing left for
// it to do - and every change to the ABAP starts the app again once the
// typing has stopped.
//
// Off by default because a run is not free and not invisible: a compile, a
// fresh database and a full reload of the app frame, which throws away
// whatever was on screen. Somebody halfway through a form in their own app
// does not want that on a keystroke; somebody watching a view take shape
// wants nothing else. So it is a choice, and it is one click.
//
// Stored only while it differs from the default, and never restored in an
// embedded playground - the rule the theme and the checker settings follow
// (src/shell/theme.mjs), for the same reason: a demo in somebody's
// documentation page has to read the same to every reader.
const AUTORUN_KEY = "abap2ui5-playground:autorun";

// Long enough that a word being typed is one run rather than six, short
// enough that a pause reads as "and now show me". The editor's own change
// debounce is 150ms and hangs off the same keystrokes, so what this waits for
// is the analysis having settled as well.
const AUTORUN_DELAY = 700;

let autorun = false;
let autorunTimer;
// Until boot( ) has finished there is no runtime to run against, and Run has
// been disabled since index.html was parsed. It is one of three reasons the
// button may be inactive, which is why they are decided together below.
let booted = false;

function setUpAutorun({ restore }) {
  autorun = restore && readStored(AUTORUN_KEY) === "on";
  autorunButton.addEventListener("click", () => {
    autorun = !autorun;
    if (autorun) writeStored(AUTORUN_KEY, "on");
    else removeStored(AUTORUN_KEY);
    reflectAutorun();
    // Switching it on is a request to see the code as it stands - whatever was
    // typed while it was off has not been run, and a switch that shows nothing
    // until the next keystroke looks like a switch that does nothing. Off, the
    // change already waiting is dropped rather than run behind the reader's
    // back.
    // During a Run, run( ) only returns - and the change waiting was dropped
    // with Run left disabled ("autorun has the job"). autorunAfterChange( )
    // waits for the Run to end and runs it then.
    if (autorun) {
      if (running) autorunAfterChange();
      else run();
    } else clearTimeout(autorunTimer);
  });
  reflectAutorun();
}

function reflectAutorun() {
  autorunButton.setAttribute("aria-checked", String(autorun));
  const said = autorun
    ? "Autorun is on - every change runs by itself"
    : "Autorun: run every change as it is typed";
  autorunButton.title = said;
  autorunButton.setAttribute("aria-label", said);
  runButton.title = autorun ? said : "Run (Ctrl+Enter)";
  reflectRunButton();
}

// Three reasons Run may be inactive - the page has not started, a run is
// already under way, autorun has the job - and one button. Decided in one
// place, because they used to be written by whichever of them moved last: a
// run finishing under autorun handed the button back.
function reflectRunButton() {
  runButton.disabled = !booted || running || autorun;
}

// Every debounced change to the ABAP comes through remember( ), which calls
// this: a keystroke, a file added or closed, a set of files opened over the
// old one.
//
// Not before boot( ) has finished: there is no runtime to run against yet,
// and boot's own first run takes whatever was typed meanwhile. And not for
// text that has just been run - opening a sample or a draft writes the
// models, the editor's change debounce fires during the run that opening
// started, and without the comparison that one change was a second compile,
// database reset and frame reload of the same text 700ms later.
function autorunAfterChange() {
  if (!autorun || !booted) return;
  clearTimeout(autorunTimer);
  autorunTimer = setTimeout(() => {
    // A run already under way owns the frame and the database, and run( )
    // would answer a second one by returning. So the change that arrived
    // during it is run after it rather than dropped.
    if (running) autorunAfterChange();
    else if (JSON.stringify(getFiles()) !== lastRunText) run({ quiet: true });
  }, AUTORUN_DELAY);
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
// The files the last run started from, as text - see autorunAfterChange( ).
let lastRunText;
// The Run autorun started on its own, by its number, while it is the current
// one - see run( ) and caretMayMove( ).
let quietRun;
// What the last run's unit tests said, for runForAgent( ).
let lastTestResults = [];

// `quiet` is a run nobody asked for: autorun's, 700ms after the typing
// stopped. It says what it found like any other - the status line, the
// underlines, the Problems list - but it leaves the caret where the reader is
// typing. Moving it to the first error, as a pressed Run does, sent the next
// keystrokes there: an unfinished statement is an abaplint error, so every
// pause in the middle of one pulled the caret out of the line being written
// (to the top of the file, or into another file) and typed the rest into it.
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
  // A run supersedes the one autorun was about to start - pressing Run (or
  // opening a sample, which runs on its own) while the timer is counting down
  // must not be followed by a second run of the same text.
  clearTimeout(autorunTimer);
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
    // window.__z2ui5Playground roundtrip refuses a frame of an earlier Run by
    // this number, and counted only before the database reset it let the old
    // app's timer run the NEW classes through the whole test phase - a dump
    // that was not the new app's, left on screen after it started. Counted
    // after compile, so code that does not compile leaves the old app working.
    state.runCounter += 1;
    quietRun = quiet ? state.runCounter : undefined;
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

    // Bounded, because everything in run() hangs off this one event: if the
    // frame never fires it, `running` would stay true and Run would be dead
    // until a full reload. Thirty seconds is an eternity for a same-origin
    // document - reaching it means the load is not coming.
    await new Promise((resolve, reject) => {
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
        let arriving = false;
        try {
          arriving = frame.contentWindow.location.href === src.href && frame.contentDocument?.readyState !== "complete";
        } catch {
          // Another origin (an error page): not arriving.
        }
        if (arriving && Date.now() - started < 180000) {
          gaveUp = setTimeout(check, 10000);
          return;
        }
        frame.removeEventListener("load", loaded);
        reject(new Error("The app frame did not load."));
      };
      gaveUp = setTimeout(check, 30000);
      frame.addEventListener("load", loaded, { once: true });
      // The address of this run, readable whatever navigated the frame.
      frame.dataset.src = src.href;
      // A REPLACE, not a navigation that pushes: setting `src` on an iframe
      // adds an entry to the TAB's history, so after a few Runs the Back
      // button stepped through old app frames instead of leaving the page,
      // and past Chromium's fifty entries the page the reader came from -
      // the one the bar's step back returns to - fell off the end. The
      // first load has nothing to replace; it sets `src` as before.
      const current = frame.contentWindow;
      let replaced = false;
      try {
        if (current && current.location.href !== "about:blank") {
          current.location.replace(src.href);
          replaced = true;
        }
      } catch {
        // A frame on another origin (an error page) - set src instead.
      }
      if (!replaced) frame.src = src.href;
    });
    // A load is not an app. Offline on a first visit (no worker yet) the
    // frame's document arrived from the HTTP cache but sap-ui-core.js did
    // not, or Chrome's own error page loaded - both fire `load`, and the
    // status said "running" over a blank frame.
    let booted = false;
    try {
      booted = Boolean(frame.contentWindow.sap?.ui);
    } catch {
      // An error page is another origin: not booted.
    }
    if (!booted) throw new Error("The app frame loaded without UI5 - is the network down? Run again once it is back.");
    // An app is on screen: whatever placeholder stood over the frame goes -
    // after boot's first run, or in the AI Studio, after the first app the
    // model built.
    document.getElementById("app-placeholder")?.setAttribute("hidden", "");
    if (testsFailed > 0) {
      const total = tests.reduce((n, t) => n + t.methods.length, 0);
      setStatus(`running - ${testsFailed} of ${total} test${total === 1 ? "" : "s"} failed`, true);
      showInsight("tests");
    } else {
      setStatus("running");
    }
    // After the load event, so the app has rendered and has a height to report.
    if (appOnly) announceAppHeight(frame);
    // The AI Pilot's further apps start again with this Run - same fresh
    // database, new Run number (src/shell/pilot.mjs).
    if (pilotPage) pilotRan();
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
        if (!quiet) focusProblem(first.file, first.range.start.line + 1, 1);
      }
    }
  } finally {
    running = false;
    reflectRunButton();
  }
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
  while (running) await new Promise((resolve) => setTimeout(resolve, 100));
  const started = await run();
  if (started) {
    const until = performance.now() + 10000;
    while (roundtripList().length === 0 && performance.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const status = document.getElementById("status");
  return {
    started: Boolean(started),
    status: status.textContent,
    // Waited for: a run that stopped before its own refreshNow( ) (a
    // structural problem) left refresh( ) answering for the text from before
    // the model's change, and the model chased problems that were gone.
    problems: await refreshNow(),
    tests: lastTestResults,
    // Only a run that started has roundtrips of its own: one that stopped
    // before the fresh database left the LAST run's list in place, and the
    // model read "first roundtrip: HTTP 200" and the old app's view under a
    // status saying this one did not start.
    roundtrips: started ? roundtripList() : [],
    log: currentLog(),
  };
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
  if (navigator.serviceWorker?.controller) {
    await discardCachedSite();
    setStatus("the playground could not start - the site's cached copy was discarded, please reload", true);
  } else {
    setStatus("the playground could not start", true);
  }
  showOutput("Startup", describeError(e));
});
