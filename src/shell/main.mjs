// The playground page.
//
// It owns three things the rest of the code reaches through: the ABAP runtime
// that answers roundtrips, the abaplint registry the editor thinks with, and the
// iframe the app renders in. The iframe asks this page for every roundtrip (see
// frontend-bridge.js), so the framework runs here, in the top window, and the
// frame is only a screen.
import "./shell.css";

import {
  connectRegistry,
  createEditor,
  currentFile,
  focusProblem,
  format,
  getFiles,
  refresh,
  setFiles,
} from "../editor/editor.mjs";
import { buildRegistry, declaredObjectName, entryClass } from "../editor/registry.mjs";
import { compile } from "../editor/transpile.mjs";
import { checkFileSet, MAIN_FILE, parseName } from "../editor/files.mjs";
import {
  fetchLinkedFiles,
  followNavigation,
  humanUrl,
  linkedSources,
  originOf,
} from "./deep-link.mjs";
import { DEFAULT_FILES, isSample, SAMPLES, sampleById } from "../editor/samples.mjs";
import { openExamples, setUpExamples } from "./examples.mjs";
import { render as renderFiles, setUpFiles } from "./files-ui.mjs";
import { setUpInsight, showInsight, updateInsight } from "./insight.mjs";
import { restoreCheckerSettings } from "./checker-settings.mjs";
import { setUpSplitter, setUpTabs } from "./layout.mjs";
import { announceAppHeight, announceReady, announceStatus, startEmbedMessages } from "./embed.mjs";
import { appUrl, copyToClipboard, filesFromLocation, shareUrl } from "./share.mjs";
import { state } from "./state.mjs";
import { readStoredJson, removeStored, writeStoredJson } from "./storage.mjs";
import { hideOutput, setStatus, showOutput } from "./ui.mjs";

// The framework bundle is 8 MB and built by a separate step, so it is not part
// of this bundle - it is fetched at run time. The URL is built rather than
// written as a literal so the bundler leaves the import alone, and so it
// resolves under a GitHub Pages project path as well as at a site root.
const asset = (p) => new URL(p, document.baseURI).href;

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

const STORAGE_KEY = "abap2ui5-playground:files";

const runButton = document.getElementById("run");
const formatButton = document.getElementById("format");
const shareButton = document.getElementById("share");
const fullscreenButton = document.getElementById("fullscreen");
const examplesButton = document.getElementById("examples");
const sampleSelect = document.getElementById("samples");
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
  // Two independent slow starts: the transpiled framework (a download and a
  // parse) and the ABAP corpus the editor checks against. Neither needs the
  // other, so they run together - and the corpus half does not stop at its
  // download. Parsing what arrives is the expensive part of it, several seconds
  // of processor against a megabyte and a half of network, and it starts the
  // moment the JSON lands rather than after the framework has finished
  // arriving. That is the difference between the two costs adding up and the
  // longer one covering the shorter.
  //
  // And they are started here rather than after startingFiles( ), which is
  // where they used to be. That await is instant for a draft or a sample and
  // is two network round trips to GitHub for a ?src= link - the fetch of the
  // linked class, then the fetch of the classes beside it - which is the path
  // every Run button in the documentation takes. The preload tags in
  // index.html had these bytes moving with the document already; what was
  // still waiting on the link was every bit of processor work behind them.
  const runtimeReady = heard(import(/* @vite-ignore */ asset("runtime/framework.mjs")));
  const corpusReady = heard(
    fetch(asset("editor/corpus.json")).then((r) => {
      if (!r.ok) throw new Error(`corpus.json: ${r.status}`);
      return r.json();
    }),
  );

  setUpSplitter();
  setUpAbout();
  const tabs = setUpTabs(appOnly);

  // The files, as a promise the registry build can hold: the corpus parse does
  // not need them until it has finished parsing the corpus itself.
  const startingReady = heard(startingFiles());

  const registryReady = heard(
    corpusReady.then(async (corpus) => {
      setStatus("reading the abap2UI5 sources…");
      await buildRegistry(
        corpus,
        startingReady.then((s) => s.files),
        (done, total) => {
          setStatus(`checking the sources… ${Math.round((done / total) * 100)}%`);
        },
      );
      // Whatever is left to wait for is the framework still on its way. Saying
      // so beats leaving the line reading 100% with nothing apparently
      // happening.
      setStatus("loading the ABAP runtime…");
    }),
  );

  const { files, from } = await startingReady;
  createEditor(document.getElementById("editor"), files, { onChange: remember });
  setUpFiles({ onChanged: remember, onOpened: fileOpened });
  setUpInsight();
  // The examples browser hands back either a built-in sample's id or the raw
  // URL of a catalogued class; the URL goes through the same code a ?src=
  // link goes through.
  setUpExamples({
    openSample: (id) => {
      sampleSelect.value = id;
      loadSample(id, tabs);
    },
    openLinked: (url) => loadLinked(url, tabs),
  });

  fillSampleMenu(from);

  try {
    setStatus("loading the ABAP runtime…");
    // Awaited together rather than one after the other, because both are
    // already running: awaiting them in sequence would leave whichever failed
    // second rejecting with nobody listening yet.
    const [runtime] = await Promise.all([runtimeReady, registryReady]);
    state.runtime = runtime;
    // What the frontend in the app frame reaches for: the roundtrip it would
    // otherwise POST to a backend, and whether the shell has a dialog open -
    // see src/shell/frontend-bridge.js for what the frame does with that.
    window.__z2ui5Playground = {
      roundtrip: (body) => state.runtime.roundtrip(body),
      dialogOpen: () => document.querySelector("dialog[open]") !== null,
    };
    const version = `abap2UI5 ${state.runtime.abapVersion()}`;
    document.getElementById("versions").textContent = version;
    document.getElementById("about-versions").textContent = version;

    connectRegistry();
  } catch (e) {
    setStatus("the playground could not start", true);
    showOutput("Startup", String(e.stack || e));
    return;
  }

  for (const control of [runButton, formatButton, shareButton, fullscreenButton, examplesButton, sampleSelect]) {
    control.disabled = false;
  }
  showSourceLink();

  runButton.addEventListener("click", () => run());
  formatButton.addEventListener("click", () => format());
  shareButton.addEventListener("click", () => share());
  fullscreenButton.addEventListener("click", () => openFullScreen());
  examplesButton.addEventListener("click", () => openExamples());
  sampleSelect.addEventListener("change", () => loadSample(sampleSelect.value, tabs));

  // A theme change must not restart the app - somebody has a half-filled form
  // open and the sun went down. UI5 can swap its theme at runtime, so the
  // running frame is told rather than reloaded; a frame that cannot be told
  // keeps the theme it started with until the next Run.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyFrameTheme());

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      run();
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

const uiTheme = () => (prefersDark() ? "sap_horizon_dark" : "sap_horizon");

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
// the link to where it came from.
function fileOpened() {
  showSourceLink();
  updateInsight(refresh());
}

// The way back to where linked code lives, following whichever file is open.
// Only for files that actually came from a link: over a draft or a sample it
// would be a link to somebody else's page with no relation to what is on
// screen.
export function showSourceLink() {
  const link = document.getElementById("source-link");
  const origin = originOf(currentFile());
  link.hidden = origin === undefined;
  if (origin === undefined) return;
  link.href = humanUrl(origin);
  link.textContent = "on GitHub";
  link.title = `Open ${currentFile()} where it lives`;
}

function remember(files) {
  renderFiles();
  showSourceLink();
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

// The sample menu. When the editor did not start on a sample, the menu opens on
// a disabled entry saying where the code did come from - picking a sample then
// replaces it, and the menu never claims that edited code is still the sample.
function fillSampleMenu(from) {
  if (from !== "sample") {
    const placeholder = new Option(`from ${from}`, "");
    placeholder.disabled = true;
    sampleSelect.add(placeholder);
  }
  for (const sample of SAMPLES) {
    sampleSelect.add(new Option(`${sample.title} — ${sample.note}`, sample.id));
  }
  sampleSelect.value = from === "sample" ? SAMPLES[0].id : "";
}

function loadSample(id, tabs) {
  const sample = sampleById(id);
  if (!sample) return;
  setFiles(sample.files.map((f) => ({ ...f })));
  renderFiles();
  // Picking a sample is a request to see it, so it runs without a second click.
  run().then(() => tabs.show("right"));
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
    setFiles(checkFileSet([...linked, ...alongside]).map((f) => ({ ...f })));
    renderFiles();
    // The menu stops claiming the editor holds one of its samples - the same
    // move fillSampleMenu makes when the page opens on somebody's link.
    let placeholder = [...sampleSelect.options].find((o) => o.value === "");
    if (!placeholder) {
      placeholder = new Option("", "");
      placeholder.disabled = true;
      sampleSelect.add(placeholder, 0);
    }
    placeholder.text = "from the examples browser";
    sampleSelect.value = "";
    await run();
    tabs.show("right");
  } catch (e) {
    // The catalogue said the class is there and it was not, or the fetch
    // failed under way. Somebody clicked expecting particular code, so this
    // failure is said out loud - unlike a catalogue that never loaded.
    setStatus("the example could not be opened", true);
    showOutput("Examples", String(e.message || e));
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

async function share() {
  try {
    const url = await shareUrl(getFiles());
    history.replaceState(null, "", url);
    const copied = await copyToClipboard(url);
    setStatus(copied ? "link copied to the clipboard" : "link is in the address bar");
  } catch (e) {
    setStatus("the link could not be built", true);
    showOutput("Share", String(e.message || e));
  }
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
    const problems = refresh();
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
    state.runtime.defineClasses(chunks.map((c) => c.js));

    setStatus("starting the app…");
    await state.runtime.resetDatabase();

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
  } catch (e) {
    setStatus("the app could not be started", true);
    showOutput("Run", String(e.message || e));
  } finally {
    running = false;
    runButton.disabled = false;
  }
}

boot();
