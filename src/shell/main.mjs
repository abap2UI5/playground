// The playground page.
//
// It owns the ABAP runtime and the iframe the app renders in. The iframe asks
// this page for every roundtrip (see frontend-bridge.js), so the framework runs
// here, in the top window, and the frame is only a screen.
import { state } from "./state.mjs";
import { showOutput, setStatus } from "./ui.mjs";

// The framework bundle is 8 MB and built by a separate step, so it is not part
// of this bundle - it is fetched at run time. The URL is built rather than
// written as a literal so the bundler leaves the import alone, and so it
// resolves under a GitHub Pages project path as well as at a site root.
async function loadRuntime() {
  const url = new URL("runtime/framework.mjs", document.baseURI).href;
  return import(/* @vite-ignore */ url);
}

const runButton = document.getElementById("run");
const frame = document.getElementById("app");

async function boot() {
  const started = performance.now();
  try {
    state.runtime = await loadRuntime();
  } catch (e) {
    setStatus(`the ABAP runtime failed to load: ${e.message}`, true);
    showOutput("Runtime", String(e.stack || e));
    return;
  }
  const ms = Math.round(performance.now() - started);
  document.getElementById("versions").textContent = `abap2UI5 ${state.runtime.abapVersion()}`;
  setStatus(`ready in ${ms} ms`);

  // Everything the iframe is allowed to ask of this page. Same-origin, so it
  // reads this straight off window.parent.
  window.__z2ui5Playground = {
    roundtrip: (body) => state.runtime.roundtrip(body),
  };

  runButton.disabled = false;
  runButton.addEventListener("click", () => run(state.appClass));
  await run(state.appClass);
}

// Starts the app fresh: a new database, then a new frame.
//
// The frame is reloaded rather than told to restart, because a reload is the
// only thing that resets everything the frontend keeps outside the model -
// view slots, routing state, the UI5 component itself. The counter in the URL
// makes each run a different document, so the browser cannot serve a cached one
// and the load event is unambiguous.
export async function run(appClass) {
  runButton.disabled = true;
  setStatus(`starting ${appClass}…`);
  try {
    await state.runtime.resetDatabase();

    if (!state.runtime.hasClass(appClass)) {
      setStatus(`${appClass} is not a class the runtime knows`, true);
      return;
    }

    state.runCounter += 1;
    const src = new URL("app/index.html", document.baseURI);
    src.searchParams.set("app_start", appClass);
    src.searchParams.set("run", String(state.runCounter));

    await new Promise((resolve) => {
      frame.addEventListener("load", resolve, { once: true });
      frame.src = src.href;
    });
    setStatus(`running ${appClass}`);
  } catch (e) {
    setStatus(`could not start ${appClass}`, true);
    showOutput("Run", String(e.stack || e));
  } finally {
    runButton.disabled = false;
  }
}

boot();
