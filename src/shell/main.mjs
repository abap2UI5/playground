// The playground page.
//
// It owns three things the rest of the code reaches through: the ABAP runtime
// that answers roundtrips, the abaplint registry the editor thinks with, and the
// iframe the app renders in. The iframe asks this page for every roundtrip (see
// frontend-bridge.js), so the framework runs here, in the top window, and the
// frame is only a screen.
import "./shell.css";

import { connectRegistry, createEditor, focusProblem, format, getFiles, refresh, setFiles } from "../editor/editor.mjs";
import { declaredObjectName, entryClass } from "../editor/registry.mjs";
import { checkFileSet, MAIN_FILE, parseName } from "../editor/files.mjs";
import { fetchLinkedFiles, linkedSources } from "./deep-link.mjs";
import { DEFAULT_FILES, SAMPLES, sampleById } from "../editor/samples.mjs";
import { render as renderFiles, setUpFiles } from "./files-ui.mjs";
import { setUpSplitter, setUpTabs } from "./layout.mjs";
import { copyToClipboard, filesFromLocation, shareUrl } from "./share.mjs";
import { state } from "./state.mjs";
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
const sampleSelect = document.getElementById("samples");
const frame = document.getElementById("app");

// Embedded in somebody else's page: no chrome, no sample menu, just the code it
// was given and the app it produces. `?embed=1` in the query, the code in the
// fragment as usual.
const params = new URLSearchParams(window.location.search);
const embedded = params.get("embed") === "1";

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
      return { files: checkFileSet(await fetchLinkedFiles(params)), from: "a link" };
    } catch (e) {
      linkFailure = e;
    }
  }
  if (!embedded) {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (stored) return { files: checkFileSet(stored), from: "your last session" };
    } catch {
      // A draft that will not parse is a draft that is gone.
    }
  }
  return { files: DEFAULT_FILES, from: "sample" };
}

async function boot() {
  if (embedded) document.body.classList.add("is-embedded");

  setUpSplitter();
  const tabs = setUpTabs();

  const { files, from } = await startingFiles();
  createEditor(document.getElementById("editor"), files, { onChange: remember });
  setUpFiles({ onChanged: remember });

  fillSampleMenu(from);

  // Two independent slow starts: the transpiled framework (a download and a
  // parse) and the ABAP corpus the editor checks against. Neither needs the
  // other, so they run together.
  const runtimeReady = import(/* @vite-ignore */ asset("runtime/framework.mjs"));
  const corpusReady = fetch(asset("editor/corpus.json")).then((r) => {
    if (!r.ok) throw new Error(`corpus.json: ${r.status}`);
    return r.json();
  });

  try {
    setStatus("loading the ABAP runtime…");
    state.runtime = await runtimeReady;
    window.__z2ui5Playground = { roundtrip: (body) => state.runtime.roundtrip(body) };
    document.getElementById("versions").textContent = `abap2UI5 ${state.runtime.abapVersion()}`;

    setStatus("reading the abap2UI5 sources…");
    const corpus = await corpusReady;

    const { buildRegistry } = await import("../editor/registry.mjs");
    await buildRegistry(corpus, files, (done, total) => {
      setStatus(`checking the sources… ${Math.round((done / total) * 100)}%`);
    });
    connectRegistry();
  } catch (e) {
    setStatus("the playground could not start", true);
    showOutput("Startup", String(e.stack || e));
    return;
  }

  for (const control of [runButton, formatButton, shareButton, sampleSelect]) control.disabled = false;

  runButton.addEventListener("click", () => run());
  formatButton.addEventListener("click", () => format());
  shareButton.addEventListener("click", () => share());
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

  // After the first run, not before: run() opens with a clear of the output
  // panel, so a message shown earlier would be wiped by the very next line.
  if (linkFailure) {
    setStatus("the link could not be followed - showing the sample instead", true);
    showOutput("Link", String(linkFailure.message || linkFailure));
  }
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

function remember(files) {
  renderFiles();
  if (embedded) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files ?? getFiles()));
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

    const errors = refresh().filter((i) => i.severity === 1);
    if (errors.length > 0) {
      setStatus(`${errors.length} error${errors.length > 1 ? "s" : ""} in the ABAP - fix them and run again`, true);
      showOutput(
        "ABAP",
        errors
          .map((i) => `${files.length > 1 ? `${i.file} ` : ""}line ${i.range.start.line + 1}: ${i.message}`)
          .join("\n"),
      );
      focusProblem(errors[0].file, errors[0].range.start.line + 1, errors[0].range.start.character + 1);
      return;
    }

    setStatus("compiling…");
    const { compile } = await import("../editor/transpile.mjs");
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

    await new Promise((resolve) => {
      frame.addEventListener("load", resolve, { once: true });
      frame.src = src.href;
    });
    setStatus("running");
  } catch (e) {
    setStatus("the app could not be started", true);
    showOutput("Run", String(e.message || e));
  } finally {
    running = false;
    runButton.disabled = false;
  }
}

boot();
