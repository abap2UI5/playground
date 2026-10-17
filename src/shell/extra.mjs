// The menu behind the bar's last button - light or dark, the project's tools
// and its repositories. It is a <details>, so it opens and closes on its own;
// this only closes it the two ways a menu is expected to close and a <details>
// does not: a click anywhere outside it, and Escape, which also hands focus
// back to the button. The sample catalogue and the per-sample pages carry
// the same lines inline (THEME_MENU in src/shell/theme-boot.mjs, written into
// them by the build); this one also closes the menu on a click into the app
// frame, which only this page has.
export function setUpExtra() {
  const extra = document.getElementById("extra");
  if (!extra) return;
  document.addEventListener("click", (e) => {
    if (extra.open && !extra.contains(e.target)) extra.open = false;
  });
  // A click into the app frame is no click in this document - the menu stayed
  // open over the app. The window losing the focus to a frame of its own is
  // what such a click looks like from here.
  addEventListener("blur", () => {
    if (extra.open && document.activeElement?.tagName === "IFRAME") extra.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && extra.open) {
      extra.open = false;
      extra.querySelector("summary").focus();
    }
  });
}
