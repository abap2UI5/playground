// Light or dark, for the whole page: the bar and the panels, the editor and
// the app in its frame.
//
// The page follows the system until the switch in the menu behind the bar's
// last button says otherwise - the same switch the sample catalogue's bar
// keeps there, under the same key, and it behaves the same way: a
// choice is kept between visits, and a choice that equals what the system
// says anyway is forgotten rather than stored, so a page that was switched
// back agrees with the system again from then on and follows it when it
// changes. That is the rule every stored setting here
// follows (see checker-settings.mjs), and for the same reason: a stored copy
// of the default is a preference nobody expressed.
//
// The choice is applied as `data-theme` on <html>, which is what shell.css
// keys its palette on beside the media query. The inline script at the top of
// index.html applies a stored choice before the first paint - a bar that
// paints light and turns dark a second later, once this bundle has been
// evaluated, is a flash on every visit - so that script repeats the read with
// the key below written into it. Keep the two in step.
//
// An embedded playground never restores a choice: a demo in somebody's
// documentation page follows that page's reader's system, the same as it
// never restores a draft or a checker setting.
import { readStored, removeStored, writeStored } from "./storage.mjs";

export const THEME_KEY = "abap2ui5-playground:theme";

const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set();
const system = () => (media.matches ? "dark" : "light");
const stored = () => {
  const value = readStored(THEME_KEY);
  return value === "dark" || value === "light" ? value : null;
};

// null while the page follows the system.
let choice = null;
let switchButton;

export const isDark = () => (choice ?? system()) === "dark";

// Called whenever the page's theme may have changed - a click on the switch,
// or the system changing under a page that follows it. Readers ask isDark( ).
export const onThemeChange = (fn) => listeners.add(fn);

export function setUpTheme({ restore = true } = {}) {
  choice = restore ? stored() : null;
  switchButton = document.getElementById("theme");
  switchButton?.addEventListener("click", () => toggleTheme());
  media.addEventListener("change", () => {
    if (!choice) changed();
  });
  apply();
}

export function toggleTheme() {
  const next = isDark() ? "light" : "dark";
  if (next === system()) {
    choice = null;
    removeStored(THEME_KEY);
  } else {
    choice = next;
    writeStored(THEME_KEY, next);
  }
  changed();
}

function apply() {
  const root = document.documentElement;
  if (choice) root.dataset.theme = choice;
  else delete root.dataset.theme;
  if (!switchButton) return;
  const dark = isDark();
  switchButton.setAttribute("aria-checked", String(dark));
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  switchButton.setAttribute("aria-label", label);
  switchButton.title = label;
}

// After a click, or after the system changed under a page that follows it -
// the switch shows the new state either way, stored or not.
function changed() {
  apply();
  for (const fn of listeners) fn();
}
