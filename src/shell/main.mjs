// The playground page.
//
// It owns three things the rest of the code reaches through: the ABAP runtime
// that answers roundtrips, the abaplint registry the editor thinks with, and the
// iframe the app renders in. The iframe asks this page for every roundtrip (see
// frontend-bridge.js), so the framework runs here, in the top window, and the
// frame is only a screen.
import "./shell.css";

import { connectRegistry, createEditor, format, getSource, refresh, setSource } from "../editor/editor.mjs";
import { buildRegistry, declaredClassName, USER_CLASS } from "../editor/registry.mjs";
import { DEFAULT_SOURCE, SAMPLES, sampleById } from "../editor/samples.mjs";
import { setUpSplitter, setUpTabs } from "./layout.mjs";
import { copyToClipboard, shareUrl, sourceFromLocation } from "./share.mjs";
import { state } from "./state.mjs";
import { setStatus, showOutput } from "./ui.mjs";

// The framework bundle is 8 MB and built by a separate step, so it is not part
// of this bundle - it is fetched at run time. The URL is built rather than
// written as a literal so the bundler leaves the import alone, and so it
// resolves under a GitHub Pages project path as well as at a site root.
const asset = (p) => new URL(p, document.baseURI).href;

const SOURCE_KEY = "abap2ui5-playground:source";

const runButton = document.getElementById("run");
const formatButton = document.getElementById("format");
const shareButton = document.getElementById("share");
const sampleSelect = document.getElementById("samples");
const frame = document.getElementById("app");

// Where the editor starts, in order of how deliberate the choice was: a shared
// link is what somebody was sent, the stored draft is what they were last
// working on, and the sample is the fallback.
async function startingSource() {
  try {
    const shared = await sourceFromLocation();
    if (shared) return { source: shared, from: "a shared link" };
  } catch {
    // A fragment that will not decode is somebody else's link or a truncated
    // paste. Opening on the sample beats an error page nobody can act on.
  }
  const stored = localStorage.getItem(SOURCE_KEY);
  if (stored) return { source: stored, from: "your last session" };
  return { source: DEFAULT_SOURCE, from: "sample" };
}

async function boot() {
  setUpSplitter();
  const tabs = setUpTabs();

  const { source, from } = await startingSource();
  createEditor(document.getElementById("editor"), source, {
    onChange: (value) => localStorage.setItem(SOURCE_KEY, value),
  });

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

    await buildRegistry(corpus, source, (done, total) => {
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

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });

  await run();
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
  setSource(sample.source);
  localStorage.setItem(SOURCE_KEY, sample.source);
  // Picking a sample is a request to see it, so it runs without a second click.
  run().then(() => tabs.show("right"));
}

async function share() {
  try {
    const url = await shareUrl(getSource());
    history.replaceState(null, "", url);
    const copied = await copyToClipboard(url);
    setStatus(copied ? "link copied to the clipboard" : "link is in the address bar");
  } catch (e) {
    setStatus("the link could not be built", true);
    showOutput("Share", String(e.message || e));
  }
}

// Starts the class in the editor: compile it, register it with the runtime,
// then a new database and a new frame.
//
// The frame is reloaded rather than told to restart, because a reload is the
// only thing that resets everything the frontend keeps outside the model - view
// slots, routing state, the UI5 component itself. The counter in the URL makes
// each run a different document, so the browser cannot serve a cached one and
// the load event is unambiguous.
export async function run() {
  runButton.disabled = true;
  try {
    // Checked before the diagnostics, because a class under a different name
    // makes abaplint report a filename mismatch - true, and no help at all to
    // somebody who is looking at an editor and not at a file.
    const declared = declaredClassName(getSource());
    if (declared !== USER_CLASS) {
      setStatus(`the playground runs ${USER_CLASS}`, true);
      showOutput(
        "ABAP",
        `The playground runs one class, and it has to be called ${USER_CLASS}.\n` +
          (declared ? `This one is called ${declared}.` : "No global class declaration was found."),
      );
      return;
    }

    const issues = refresh();
    const errors = issues.filter((i) => i.severity === 1);
    if (errors.length > 0) {
      setStatus(`${errors.length} error${errors.length > 1 ? "s" : ""} in the ABAP - fix them and run again`, true);
      showOutput(
        "ABAP",
        errors.map((i) => `line ${i.range.start.line + 1}: ${i.message}`).join("\n"),
      );
      return;
    }

    setStatus("compiling…");
    const { compile } = await import("../editor/transpile.mjs");
    const js = await compile(getSource());
    state.runtime.defineClass(js);

    setStatus("starting the app…");
    await state.runtime.resetDatabase();

    state.runCounter += 1;
    const src = new URL("app/index.html", document.baseURI);
    src.searchParams.set("app_start", USER_CLASS);
    src.searchParams.set("run", String(state.runCounter));

    await new Promise((resolve) => {
      frame.addEventListener("load", resolve, { once: true });
      frame.src = src.href;
    });
    setStatus("running");
  } catch (e) {
    setStatus("the app could not be started", true);
    showOutput("Run", String(e.message || e));
  } finally {
    runButton.disabled = false;
  }
}

boot();
