// The menu behind the bar's last button - light or dark, the project's tools
// and its repositories. It is a <details>, so it opens and closes on its own;
// this only closes it the two ways a menu is expected to close and a <details>
// does not: a click anywhere outside it, and Escape, which also hands focus
// back to the button. The sample catalogue carries the same lines
// (setUpExtra() in src/catalogue/catalogue.mjs) and the per-sample pages an
// inline copy (tools/sample-pages.mjs).
export function setUpExtra() {
  const extra = document.getElementById("extra");
  if (!extra) return;
  document.addEventListener("click", (e) => {
    if (extra.open && !extra.contains(e.target)) extra.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && extra.open) {
      extra.open = false;
      extra.querySelector("summary").focus();
    }
  });
}
