// Light or dark, for the whole page: the bar and the panels, the editor and
// the app in its frame.
//
// The page follows the system until the switch says otherwise - the ☾/☀
// button at the right of each tool's bar (the playground's workbench, the AI
// App Builder's and the AI Agent's bar; one on screen at a time), under the
// key the sample catalogue's switch uses, and it behaves the same way: a
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
// evaluated, is a flash on every visit - so that script repeats the read. It
// is THEME_BOOT in theme-boot.mjs, written into the document by the build,
// and the key read here is the one that file exports: the two cannot drift.
//
// An embedded playground never restores a choice: a demo in somebody's
// documentation page follows that page's reader's system, the same as it
// never restores a draft or a checker setting.
import { readStored, removeStored, writeStored } from "./storage.mjs";
import { THEME_KEY } from "./theme-boot.mjs";

const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set();
const system = () => (media.matches ? "dark" : "light");
const stored = () => {
  const value = readStored(THEME_KEY);
  return value === "dark" || value === "light" ? value : null;
};

// null while the page follows the system.
let choice = null;
/** @type {HTMLElement[]} */
let switchButtons = [];

export const isDark = () => (choice ?? system()) === "dark";

// Called whenever the page's theme may have changed - a click on the switch,
// or the system changing under a page that follows it. Readers ask isDark( ).
export const onThemeChange = (fn) => listeners.add(fn);

export function setUpTheme({ restore = true } = {}) {
  choice = restore ? stored() : null;
  switchButtons = [...document.querySelectorAll("[data-theme-switch]")];
  for (const button of switchButtons) button.addEventListener("click", () => toggleTheme());
  media.addEventListener("change", () => {
    if (!choice) changed();
  });
  // The switch is shared by every page on this origin, and two ways bring
  // this page back without reading it again: the back/forward cache (the bar
  // hands the playground back alive on purpose) and another
  // tab flipping it. Either way the stored choice is read again, and the
  // editor and the app frame follow through the listeners.
  if (restore) {
    const resync = () => {
      const now = stored();
      if (now !== choice) {
        choice = now;
        changed();
      }
    };
    addEventListener("pageshow", (e) => { if (e.persisted) resync(); });
    addEventListener("storage", (e) => { if (e.key === THEME_KEY || e.key === null) resync(); });
  }
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
  const dark = isDark();
  for (const button of switchButtons) {
    button.setAttribute("aria-checked", String(dark));
    // A switch is named for what it turns on and says whether it is on; named
    // for the action ("Switch to light"), a screen reader heard
    // "Switch to light, on" while the page was dark. The tooltip keeps the
    // action, for the eye; the glyph is the theme it switches to.
    button.setAttribute("aria-label", "Dark theme");
    button.title = dark ? "Switch to light theme" : "Switch to dark theme";
    const glyph = button.querySelector(".icon-glyph") ?? button;
    glyph.textContent = dark ? "☀" : "☾";
  }
}

// After a click, or after the system changed under a page that follows it -
// the switch shows the new state either way, stored or not.
function changed() {
  apply();
  for (const fn of listeners) fn();
}
