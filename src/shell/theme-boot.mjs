// Light or dark, before anything else has run - the one copy of the scripts
// every document on this site carries INLINE for the theme.
//
// Every document here applies the stored choice before the first paint (the
// playground's index.html, the catalogue's, every page tools/sample-pages.mjs
// writes, the 404 among them), and the static ones wire the switch in the
// bar's menu without a bundle. Those used to be five hand copies of one rule
// and one key - two lines in each <head>, the catalogue's setUpTheme( ) and
// setUpExtra( ), MENU_SCRIPT in the page writer - each with a comment asking
// to be kept in step with the others. They are written once now, here, and
// the build puts the very same text into each document: build-site.mjs into
// the two index.html files (the __THEME_BOOT__ and __THEME_MENU__ markers),
// sample-pages.mjs into its pages. A rule changed here is changed everywhere
// on the next build, and the policy's script hashes (tools/html.mjs) are
// taken from what was written, so they follow on their own.
//
// Strings rather than functions turned into strings: what lands in the page
// is exactly what is read here, comments and all, and the documentation's
// build over in abap2UI5/docs borrows the menu script from a sample page and
// hashes it too, so its text is a surface and is kept readable.
//
// src/shell/theme.mjs is the playground's own switch - the same key, the same
// rule, but a module with listeners (the editor and the app frame follow it)
// and the embed's no-restore rule, which no static page needs. It imports
// THEME_KEY from here, so the key at least is one constant for all of them.

export const THEME_KEY = "abap2ui5-playground:theme";

/* The stored choice, applied as `data-theme` on <html> before the first paint:
 * a page that painted light and turned dark a second later, once a bundle had
 * been evaluated, would be a flash on every visit. A choice is applied; no
 * choice follows the system. Never in an embedded playground (`?embed=1`),
 * where theme.mjs never restores one either - a demo in somebody's
 * documentation follows that page's reader's system; on a page that is never
 * embedded the test simply never matches. localStorage throws where it is
 * refused (see storage.mjs), hence the try. */
export const THEME_BOOT = `  try {
    if (!/[?&]embed=1(&|$)/.test(location.search)) {
      var t = localStorage.getItem(${JSON.stringify(THEME_KEY)});
      if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
    }
  } catch (e) { /* a browser that refuses storage still gets the system theme */ }`;

/* The bar's menu and the theme switch inside it, wired, for the documents
 * that have no bundle of their own to do it with - every sample page and the
 * 404 - and the catalogue, which has one but has no reason to carry a second
 * copy of the same lines in it. The menu is a <details> and opens on its own;
 * this closes it on a click anywhere else and on Escape. The switch: a choice
 * that equals the system is forgotten rather than stored, so a page switched
 * back follows the system again - the rule theme.mjs keeps for the playground.
 *
 * At the end of the body rather than in the head: it needs the bar to exist,
 * and nothing is painted differently by it - the stored theme was applied
 * before the first paint by THEME_BOOT. */
export const THEME_MENU = `  (function () {
    var extra = document.getElementById("extra");
    if (extra) {
      document.addEventListener("click", function (e) {
        if (extra.open && !extra.contains(e.target)) extra.open = false;
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && extra.open) { extra.open = false; extra.querySelector("summary").focus(); }
      });
    }
    var button = document.getElementById("theme");
    if (!button) return;
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var system = function () { return media.matches ? "dark" : "light"; };
    var tell = function () {
      button.setAttribute("aria-checked", String((document.documentElement.dataset.theme || system()) === "dark"));
    };
    tell();
    button.addEventListener("click", function () {
      var now = document.documentElement.dataset.theme || system();
      var next = now === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      tell();
      try {
        if (next === system()) localStorage.removeItem(${JSON.stringify(THEME_KEY)});
        else localStorage.setItem(${JSON.stringify(THEME_KEY)}, next);
      } catch (e) { /* a browser that refuses storage still gets the switch, just not the memory */ }
    });
    /* Read again when the page comes back from the back/forward cache or
       another tab flips it - the playground's theme.mjs does the same. */
    var resync = function () {
      var stored = null;
      try { stored = localStorage.getItem(${JSON.stringify(THEME_KEY)}); } catch (e) { /* blocked storage */ }
      if (stored === "dark" || stored === "light") document.documentElement.dataset.theme = stored;
      else delete document.documentElement.dataset.theme;
      tell();
    };
    addEventListener("pageshow", function (e) { if (e.persisted) resync(); });
    addEventListener("storage", function (e) { if (e.key === ${JSON.stringify(THEME_KEY)} || e.key === null) resync(); });
    /* And when the system flips the theme under a page that follows it. */
    if (media.addEventListener) media.addEventListener("change", tell);
  })();`;

/* Either one as the element a document carries. */
export const inlineScript = (text) => `<script>\n${text}\n</script>`;
