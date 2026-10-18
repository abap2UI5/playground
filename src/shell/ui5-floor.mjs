// "Check against UI5" - the bar's select over the abap2UI5 linter's floor.
//
// The same setting the abap2UI5 lint tab edits as JSON (`ui5`), not a second
// one: a change here goes through applyLinterSettings( ) and is kept by
// checker-settings.mjs exactly as an Apply in the tab is, and each face
// follows what the other applied (onLinterSettings( )). The default stays
// 1.71, the floor abap2UI5 holds its own apps to; the list is the releases a
// reader is likely to be asked about, and "latest" is the release this site
// carries - the one the linter's metadata was built from. A floor typed into
// the tab that is not on the list is shown as itself.
import { invalidateAnalysis, refreshNow } from "../editor/editor.mjs";
import { applyLinterSettings, linterSettings, onLinterSettings } from "../editor/abap2ui5-lint.mjs";
import { keepLinterSettings } from "./checker-settings.mjs";
import { problemsChanged } from "./insight-common.mjs";
import { UI5_VERSION } from "./ui5-libraries.mjs";
import { setStatus } from "./ui.mjs";

const LATEST = UI5_VERSION.split(".").slice(0, 2).join(".");
const RELEASES = ["1.71", "1.84", "1.96", "1.108", "1.120"];

let select;

function reflect(ui5) {
  const known = [...RELEASES, LATEST];
  const options = known.map((v) => new Option(v === LATEST ? `latest (${v})` : v, v));
  if (!known.includes(ui5)) options.push(new Option(ui5, ui5));
  select.replaceChildren(...options);
  select.value = ui5;
}

async function change() {
  const ui5 = select.value;
  try {
    applyLinterSettings({ ...linterSettings(), ui5 });
    keepLinterSettings(linterSettings());
  } catch (e) {
    setStatus(String(e?.message ?? e), true);
    return;
  }
  // The text did not change, the floor did: the kept analysis is keyed on
  // the text, so it is thrown away and asked for again - what Apply does.
  invalidateAnalysis();
  const problems = await refreshNow();
  problemsChanged(problems);
  setStatus(`checked against UI5 ${ui5} - ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
}

// Called once the page has started.
export function setUpUi5Floor() {
  select = document.getElementById("ui5-floor");
  if (!select) return;
  reflect(linterSettings().ui5);
  onLinterSettings((now) => reflect(now.ui5));
  select.addEventListener("change", change);
  select.disabled = false;
}
