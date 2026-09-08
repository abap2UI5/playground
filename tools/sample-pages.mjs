// One static page per sample, under dist/samples/<class>/ - plus the list of
// all of them at dist/samples/all/ and dist/sitemap.xml.
//
// WHY THEY EXIST. The catalogue at /samples/ is one URL with 770 samples drawn
// into it by JavaScript. That is right for somebody searching and useless for
// somebody searching THE WEB: there is no address for "the abap2UI5 port of
// sap.m.Wizard", so there is nothing for a search engine to return, and the
// three repository pages it replaced were the same shape - a masthead and an
// empty <section id="results">. Nothing was lost in the move; nothing was ever
// there. These pages are the address: one per sample, real text in the HTML,
// and nothing a crawler has to run to see any of it - the scripts on a page
// are the theme read, the bar's menu and its switch, the site memory and the
// demo loader below, and none of them writes a word of it.
//
// WHAT MAKES THEM WORTH INDEXING rather than 770 pages of nothing: each one
// carries what only this catalogue knows - the demo kit's own description of
// the sample, every control the class BUILDS (the linter's answer, not the
// name it is filed under), the libraries those come from, the minimum UI5
// release and what made it that, whether it runs in the browser and what it
// needs when it does not - and links out to the ABAP, to the documentation and
// into the playground. A page that only repeated its title would deserve the
// thin-content treatment it would get.
//
// AND THE SAMPLE RUNNING, above the class it is written in: a demo box that
// mounts the playground in an iframe, in this page, with this sample's ABAP in
// it. The loader is the one any documentation page embeds
// (src/embed/abap2ui5-embed.js), so these pages are the first reader of the kit
// this site ships - and, like every other page that embeds it, they get the
// press-to-start rule with it: a playground is a whole ABAP runtime plus an
// abaplint parse of nine hundred sources, and 770 pages that booted one on
// sight would be 770 pages nobody waits for. That box is also why the page no
// longer opens with a row of buttons - "Run it in the browser" runs it in the
// page now, the link out to the full playground rides on the box, and GitHub
// and the documentation are facts, in the facts.
//
// The box shows the APP and nothing else (`data-view="app"`): no editor, no
// toolbar, no status line - a page that already prints the whole class two
// screens down does not need a second copy of it inside a frame, and a strip
// of somebody else's furniture across the top of it is furniture, not answer.
// What the box is for is "what does this look like when it runs", and that is
// all it now shows. The editor is one click away on the box, in the full
// playground, which is where somebody who wants to change a line goes anyway.
//
// And, at the bottom, THE CLASS ITSELF - the thing the page is about, printed
// rather than linked to (tools/sample-sources.mjs fetches it,
// tools/abap-highlight.mjs colours it here at build time, because these pages
// carry no highlighter of their own). A reader who came to find out how a
// sample does what it does was one click away from the answer on GitHub and is
// now none; a search for a call nobody wrote a sentence about -
// `client->nav_app_leave( )`, a property name, an event - has something to
// match. A class that could not be fetched simply has no block: the facts
// above it are the page either way.
//
// WHERE THEY ARE LINKED FROM, which is what makes them reachable at all: every
// card on the catalogue page (its title is a link now), the full list at
// samples/all/ that the catalogue's footer points to, each page's "more in
// this group", and dist/sitemap.xml. A page in a sitemap and in no link is a
// page a crawler is entitled to ignore.
//
// robots.txt is deliberately NOT written: this site is a project page under
// abap2ui5.github.io/playground/, and a crawler only reads /robots.txt at the
// domain root, which belongs to another repository. The sitemap is discovered
// by being submitted, or not at all - the links above are what actually does
// the work.
//
// Everything here is written from apps.json, which is built from three
// repositories' committed files. That is external data: every value is escaped
// on the way into the markup, every link is dropped unless it is https, and a
// class name that is not a plain ABAP name gets no directory - a path is not a
// thing to build out of somebody else's JSON.
import fs from "fs";
import path from "path";
import { isSapui5Only } from "../src/shell/ui5-libs.mjs";
import { highlightAbapLines } from "./abap-highlight.mjs";
import { fetchSampleSources } from "./sample-sources.mjs";

/* Where the site is published. Only these pages need to know: a canonical
 * link and a sitemap are absolute by definition, and everything else on this
 * site is relative so it can be served under any path (tests/subpath.spec.js).
 * PG_SITE_URL overrides it for a fork published somewhere else. */
export const SITE = (process.env.PG_SITE_URL || "https://abap2ui5.github.io/playground/").replace(/\/*$/, "/");

/* Where this deployment sits on its origin - "/playground/". Only the 404
 * needs it: every other page here is reached at a known depth and links
 * relatively, which is what lets the whole site be served from anywhere. */
const BASE = new URL(SITE).pathname;

const log = (m) => console.log(`build-catalogue: ${m}`);

/* WHAT A LINK TO ONE OF THESE PAGES LOOKS LIKE SOMEWHERE ELSE. A sample page
 * had `og:type`, a title, a description and a url and nothing else, so Slack,
 * LinkedIn and a search result drew a card with no picture and no site behind
 * it; the full list and the catalogue had none of it at all. Same block for
 * all three, from the same title and description the page already carries -
 * there is nothing here a reader of the page does not already see.
 *
 * One image for 774 pages, at /playground/og-image.png. A card rendered per
 * sample would be 774 images to build and to keep in step with a title that is
 * already in the page. */
const social = ({ title, description, url, type = "article" }) => `<meta property="og:type" content="${type}">
<meta property="og:site_name" content="abap2UI5">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE}og-image.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="abap2UI5 - Build UI5 Apps Purely in ABAP">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}og-image.png">`;

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* A link this page is willing to print. Anything that is not an https URL is
 * not a link here - the alternative is putting whatever a repository committed
 * into an href. */
const safe = (url) => (/^https:\/\/[^\s"'<>]+$/.test(String(url ?? "")) ? String(url) : undefined);

/* The directory a sample gets. ABAP class names and nothing else, lower case,
 * so a path is never anything but a name this file recognised. */
const dirOf = (cls) => {
  const name = String(cls ?? "").toLowerCase();
  return /^[a-z][a-z0-9_]{2,60}$/.test(name) ? name : undefined;
};

/* The sample this port rebuilds, RUNNING, in SAP's own demo kit. "What did the
 * original do" is the first question a port raises, and the demo kit answers it
 * the way this page does - the sample on screen, with the view, the controller
 * and the data it is made of one tab along. It used to be the repository folder
 * behind that sample instead, which answered the same question with a directory
 * listing and made a reader assemble the sample in their head.
 *
 * The demo kit addresses a sample under the ENTITY it belongs to, and that is
 * not derivable from the sample id: seventy of the ports are filed under an
 * entity in another namespace (sap.m.sample.ContainerNoPadding belongs to
 * sap.ui.core.ContainerPadding), so the link needs both facts and a row missing
 * either gets none. Nor does a SAPUI5-only sample get one: sdk.openui5.org is
 * OpenUI5's demo kit, and it never showed a sample that was not in OpenUI5. */
const openui5Sample = (entity, id) => {
  const parts = /^([a-z]\w*(?:\.[a-z]\w*)*)\.sample\.(?:[A-Za-z]\w*)(?:\.[A-Za-z]\w*)*$/.exec(String(id ?? ""));
  if (parts === null || isSapui5Only(parts[1])) return undefined;
  /* A dotted UI5 name and nothing else - the entity goes into a path, and a
   * path is not a thing to build out of somebody else's JSON. */
  if (!/^[a-z]\w*(?:\.[A-Za-z]\w*)+$/.test(String(entity ?? ""))) return undefined;
  return `https://sdk.openui5.org/entity/${entity}/sample/${id}`;
};

const cut = (text, max) => {
  const one = String(text ?? "").replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).replace(/[\s,;:.-]+$/, "")}…`;
};

/* The stored theme before the first paint - the same two lines as the
 * catalogue page and the playground's index.html, and kept in step with them
 * by hand. A page that painted light and turned dark on load would be the one
 * flash this site does not have anywhere else. */
const THEME_SCRIPT = `<script>
  try {
    var t = localStorage.getItem("abap2ui5-playground:theme");
    if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
  } catch (e) { /* a browser that refuses storage still gets the system theme */ }
</script>`;

/* The bar's menu and the theme button inside it, wired - the hand copies of
 * setUpExtra() and setUpTheme() in src/catalogue/catalogue.mjs, which these
 * pages cannot import: they carry no bundle, which is most of what makes them
 * what they are. The menu is a <details> and opens on its own; this closes it
 * on a click anywhere else and on Escape. The switch: same key, same rule (a
 * choice that equals the system is forgotten rather than stored, so a page
 * switched back follows the system again), kept in step with that file and
 * with src/shell/theme.mjs by hand, as THEME_SCRIPT above is with its two.
 *
 * At the end of the body rather than in the head: it needs the bar to exist,
 * and nothing is painted differently by it - the stored theme was applied
 * before the first paint by THEME_SCRIPT. */
const MENU_SCRIPT = `<script>
  (function () {
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
    button.addEventListener("click", function () {
      var now = document.documentElement.dataset.theme || system();
      var next = now === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        if (next === system()) localStorage.removeItem("abap2ui5-playground:theme");
        else localStorage.setItem("abap2ui5-playground:theme", next);
      } catch (e) { /* a browser that refuses storage still gets the switch, just not the memory */ }
    });
  })();
</script>`;

/* Where the reader is, and where the documentation was left - the hand copy of
 * src/shell/site-memory.mjs, which the playground and the catalogue import and
 * these pages cannot, for the reason above. Same keys, same checks, kept in
 * step with that file by hand.
 *
 * At the end of the body as well: this one needs the bar to exist too, and
 * nothing is painted differently by it. */
const MEMORY_SCRIPT = `<script>
  try {
    localStorage.setItem("abap2ui5-playground:last-samples",
      location.pathname + location.search + location.hash);
  } catch (e) { /* a browser that refuses storage simply forgets where you were */ }
  (function () {
    /* Each link's href as it was WRITTEN - the section it points at - kept
       from the first lift, because after one the attribute is the page that
       was restored. */
    var written = new Map();
    var lift = function () {
      for (var a of document.querySelectorAll("a[data-site]")) {
        try {
          if (!written.has(a)) written.set(a, a.getAttribute("href"));
          var last = localStorage.getItem("abap2ui5-playground:last-" + a.dataset.site);
          if (!last) continue;
          /* Checked, not assigned: a stored value is whatever anything on this
             origin put there. Resolved against this origin, then kept only if it
             is still inside the section the MARKUP declares - the data-scope
             attribute when the link is written deeper than the section it
             restores inside (the Documentation item opens the first page of
             the manual), else the href itself. Which is what leaves
             "//elsewhere/x", "/docs/../x" and "javascript:…" alone.
             (No backticks in here: this comment is inside a template
             literal, and one would end the string mid-sentence. It did.) */
          var base = new URL(a.dataset.scope || written.get(a), location.href);
          var target = new URL(last, location.origin);
          if (base.origin !== location.origin || target.origin !== location.origin) continue;
          if (!target.pathname.startsWith(base.pathname)) continue;
          a.href = target.pathname + target.search + target.hash;
        } catch (e) { /* the link keeps the href it was written with */ }
      }
    };
    /* Now, and again whenever it can have gone stale while this page stayed
       open - shown again, looked at again, and on the click itself. */
    lift();
    addEventListener("pageshow", function (e) {
      lift();
      /* A page handed back alive by the back/forward cache is where the
         reader left it, so the record a bar link wrote on the way out is
         spent - left there, the next arrival within its half minute would
         inherit it. */
      if (e.persisted) {
        try { localStorage.setItem("abap2ui5-playground:returning", ""); } catch (e2) { /* nothing to spend */ }
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") lift();
    });
    document.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a[data-site]")) lift();
    }, true);

    /* THE BAR GOES BACK to a page that is still behind you - the hand copy
       of returnTo( ) in src/shell/site-memory.mjs, which says why at length.
       A link builds a new document, and a new playground - the page itself,
       or the runnable example on the documentation's front door - boots the
       whole runtime and runs the app from the top; the one thing that hands a
       running page back alive is the back/forward cache, and it applies to a
       page the reader has been on. So when the page an item opens is still in
       this tab's history, this goes to it there, for all four items alike:
       through the Navigation API where it exists - the nearest entry, either
       direction, that is the same origin, path and query - and without it,
       the one case that can be known: this document was opened from that page
       and nothing has been pushed onto the history since. The item for the
       page the reader is on is left to the browser. A traversal the browser
       cannot make, or a step back that goes nowhere, follows the link after a
       moment; the timer is dropped on pagehide, so a page handed back does
       not fire it on the way in. */
    var pageOf = function (u) { return u.origin + u.pathname.replace(/index\\.html$/, "") + u.search; };
    var arrived = history.length;
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest(".bar-nav a[href]");
      if (!a || e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.target && a.target !== "_self") return;
      var href = a.href, want, step, key = null, nav = window.navigation, entries, at, d;
      try { want = pageOf(new URL(href, location.href)); } catch (e2) { return; }
      if (want === pageOf(new URL(location.href))) return;
      var is = function (entry) {
        try { return typeof entry.url === "string" && pageOf(new URL(entry.url)) === want; } catch (e3) { return false; }
      };
      if (nav && nav.entries && nav.traverseTo) {
        entries = nav.entries();
        at = nav.currentEntry ? nav.currentEntry.index : -1;
        for (d = 1; d < entries.length && key === null; d++) {
          if (at - d >= 0 && is(entries[at - d])) key = entries[at - d].key;
          else if (at + d < entries.length && is(entries[at + d])) key = entries[at + d].key;
        }
        if (key === null) return;
        step = function () { return nav.traverseTo(key).committed; };
      } else {
        var from;
        try { from = pageOf(new URL(document.referrer)); } catch (e4) { return; }
        if (history.length < 2 || history.length !== arrived || from !== want) return;
        step = function () { history.back(); };
      }
      e.preventDefault();
      var follow = function () { location.assign(href); };
      var later = setTimeout(follow, 1500);
      addEventListener("pagehide", function () { clearTimeout(later); }, { once: true });
      Promise.resolve().then(step).then(null, function () { clearTimeout(later); follow(); });
    }, true);

    /* Where on the page, not only which page - the hand copy of the same block
       in src/shell/site-memory.mjs. A bar link writes down how far down this
       page the reader is and where they are being sent; the page that arrives
       within seconds, and only that page, puts them back. Leaving a sample for
       the catalogue is the journey this exists for: a list of 770 rows that
       came back at row 1 had not really remembered anything. */
    var SCROLL = "abap2ui5-playground:scroll";
    var BACK = "abap2ui5-playground:returning";
    var path = function () { return location.pathname + location.search; };
    var map = function () {
      try {
        var m = JSON.parse(localStorage.getItem(SCROLL) || "{}");
        return m && typeof m === "object" && !(m instanceof Array) ? m : {};
      } catch (e) { return {}; }
    };
    var note = function () {
      try {
        var m = map(), keys, i;
        delete m[path()];
        m[path()] = Math.round(scrollY);
        keys = Object.keys(m);
        for (i = 0; i < keys.length - 12; i++) delete m[keys[i]];
        localStorage.setItem(SCROLL, JSON.stringify(m));
      } catch (e) { /* a refused or full storage: the reader lands at the top */ }
    };
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[data-back]");
      if (!a) return;
      note();
      try {
        var to = new URL(a.href, location.href);
        if (to.origin !== location.origin) return;
        localStorage.setItem(BACK, JSON.stringify({ to: to.pathname + to.search, at: Date.now() }));
      } catch (e2) { /* not a URL, so nothing is restored */ }
    }, true);
    addEventListener("pagehide", note);
    (function () {
      var r = null, age, y;
      try {
        r = JSON.parse(localStorage.getItem(BACK) || "null");
        localStorage.setItem(BACK, "");
      } catch (e) { return; }
      if (!r || typeof r.to !== "string" || typeof r.at !== "number") return;
      age = Date.now() - r.at;
      /* Recent, about THIS page, and not overruled by a hash the reader named. */
      if (!(age >= 0 && age < 30000) || r.to !== path() || location.hash) return;
      y = map()[r.to];
      if (typeof y !== "number" || !(y > 0) || y >= 1e7) return;
      /* Re-applied until it takes, for up to three seconds: a page still
         drawing is a page too short to reach the offset, and the browser
         clamps that to the top - which is what this is here to stop. What
         cancels it is the READER and nothing else: a wheel, a touch, a key, a
         pointer. Not a scroll this did not cause - the browser moves that
         itself while a page loads, to keep what you are looking at steady,
         and reading that as a reader made the restore give up a little way
         down. */
      /* It HOLDS the position for two seconds rather than merely reaching it
         once: a page that reaches the offset and stops can be scrolled back to
         the top a frame later by whatever else is still starting up. Safe only
         because the four events end it on the reader's first move. */
      var until = Date.now() + 2000, stopped = false;
      var moved = ["wheel", "touchstart", "keydown", "pointerdown"];
      var stop = function () {
        stopped = true;
        for (var i = 0; i < moved.length; i++) removeEventListener(moved[i], stop, true);
      };
      for (var k = 0; k < moved.length; k++) addEventListener(moved[k], stop, { capture: true, passive: true });
      var put = function () {
        if (stopped) return;
        if (Math.round(scrollY) !== y) scrollTo(0, y);
        if (Date.now() < until) requestAnimationFrame(put);
        else stop();
      };
      requestAnimationFrame(put);
    })();
  })();
</script>`;

/* The two marks the playground's own bar ends in (src/shell/index.html) and,
 * after them, the button and the menu the catalogue's bar ends in
 * (src/catalogue/index.html) - the same markup, kept in step by hand. Inline
 * SVG for the reason it is inline there: an icon that is an empty square until a stylesheet
 * arrives is worse than one that never needed it. The three documents keep
 * one copy each, by hand - a shared partial would be a build step in front of
 * a page whose whole point is that it is a file. */
const SOCIALS = `<div class="socials">
    <a class="social" href="https://www.linkedin.com/company/abap2ui5/" target="_blank" rel="noopener"
       aria-label="abap2UI5 on LinkedIn" title="abap2UI5 on LinkedIn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>
    </a>
    <a class="social" href="https://github.com/abap2UI5/abap2UI5" target="_blank" rel="noopener"
       aria-label="abap2UI5 on GitHub" title="abap2UI5 on GitHub">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
    </a>
    <!-- The rest of abap2UI5 behind one more button, drawn as a third mark:
         light or dark, then the project's tools and its repositories - the
         list the documentation's own Links menu carries. A <details>, so it
         opens and closes with no script at all; the script only closes it on
         a click anywhere else and on Escape. -->
    <details class="extra" id="extra">
      <summary class="extra-button" title="More: light or dark, and the rest of abap2UI5" aria-label="More: light or dark, and the rest of abap2UI5">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>
      </summary>
      <div class="menu">
        <button id="theme" class="theme" type="button">
          <span class="when-light"><span class="glyph" aria-hidden="true">☾</span>Switch to dark</span>
          <span class="when-dark"><span class="glyph" aria-hidden="true">☀</span>Switch to light</span>
        </button>
        <a href="https://github.com/abap2UI5/abap2UI5/issues" target="_blank" rel="noopener">Issues</a>
        <a href="https://abap2ui5.github.io/docs/resources/changelog">Release notes</a>
        <a href="https://abap2ui5.github.io/docs/get_started/quickstart">Install with abapGit</a>
        <a href="https://abap2ui5.github.io/docs/resources/support">Support</a>
        <a href="https://abap2ui5.github.io/docs/resources/contribution">Contribute</a>
        <a href="https://abap2ui5.github.io/docs/resources/sponsor">Sponsor</a>
        <span class="menu-head">Tools</span>
        <a href="https://github.com/abap2UI5/linter" target="_blank" rel="noopener">Linter</a>
        <a href="https://abap2ui5.github.io/linter/">Linter rules</a>
        <a href="https://github.com/abap2UI5/vscode-extension" target="_blank" rel="noopener">VS Code extension</a>
        <a href="https://abap2ui5.github.io/docs/advanced/mcp_server">MCP server</a>
        <a href="https://github.com/abap2UI5/app-template" target="_blank" rel="noopener">App template</a>
        <a href="https://abap2ui5.github.io/docs/resources/addons">Add-ons</a>
        <span class="menu-head">Repositories</span>
        <div class="menu-repos">
          <div class="menu-group">
            <span class="menu-sub">Framework</span>
            <a href="https://github.com/abap2UI5/abap2UI5" target="_blank" rel="noopener">abap2UI5</a>
            <a href="https://github.com/abap2UI5/frontend" target="_blank" rel="noopener">frontend</a>
            <a href="https://github.com/abap2UI5/abap2UI5-local" target="_blank" rel="noopener">abap2UI5-local</a>
            <a href="https://github.com/abap2UI5/mirror-ajson" target="_blank" rel="noopener">mirror-ajson</a>
            <a href="https://github.com/abap2UI5/mirror-srtti" target="_blank" rel="noopener">mirror-srtti</a>
            <a href="https://github.com/abap2UI5/web-abap2UI5" target="_blank" rel="noopener">web-abap2UI5</a>
          </div>
          <div class="menu-group">
            <span class="menu-sub">Samples</span>
            <a href="https://github.com/abap2UI5/samples" target="_blank" rel="noopener">samples</a>
            <a href="https://github.com/abap2UI5/samples-controls" target="_blank" rel="noopener">samples-controls</a>
            <a href="https://github.com/abap2UI5/samples-stack" target="_blank" rel="noopener">samples-stack</a>
          </div>
          <div class="menu-group">
            <span class="menu-sub">Sites</span>
            <a href="https://github.com/abap2UI5/docs" target="_blank" rel="noopener">docs</a>
            <a href="https://github.com/abap2UI5/playground" target="_blank" rel="noopener">playground</a>
          </div>
          <div class="menu-group">
            <span class="menu-sub">Tools</span>
            <a href="https://github.com/abap2UI5/linter" target="_blank" rel="noopener">linter</a>
            <a href="https://github.com/abap2UI5/vscode-extension" target="_blank" rel="noopener">vscode-extension</a>
            <a href="https://github.com/abap2UI5/mcp-server" target="_blank" rel="noopener">mcp-server</a>
            <a href="https://github.com/abap2UI5/app-template" target="_blank" rel="noopener">app-template</a>
          </div>
          <div class="menu-group">
            <span class="menu-sub">Add-ons</span>
            <a href="https://github.com/abap2UI5-addons/popups" target="_blank" rel="noopener">popups</a>
            <a href="https://github.com/abap2UI5-addons/http-connector" target="_blank" rel="noopener">http-connector</a>
            <a href="https://github.com/abap2UI5-addons/rfc-connector" target="_blank" rel="noopener">rfc-connector</a>
            <a href="https://github.com/abap2UI5-addons/lock-manager" target="_blank" rel="noopener">lock-manager</a>
            <a href="https://github.com/abap2UI5-addons/launchpad-kpi" target="_blank" rel="noopener">launchpad-kpi</a>
            <a href="https://github.com/abap2UI5-addons/table-maintenance" target="_blank" rel="noopener">table-maintenance</a>
            <a href="https://github.com/abap2UI5-addons/se16n" target="_blank" rel="noopener">se16n</a>
            <a href="https://github.com/abap2UI5-addons/custom-controls" target="_blank" rel="noopener">custom-controls</a>
            <a href="https://github.com/abap2UI5-addons" target="_blank" rel="noopener">All add-ons</a>
          </div>
          <div class="menu-group">
            <span class="menu-sub">Apps</span>
            <a href="https://github.com/abap2UI5-apps/sql-console" target="_blank" rel="noopener">sql-console</a>
            <a href="https://github.com/abap2UI5-apps/table-content-loader" target="_blank" rel="noopener">table-content-loader</a>
            <a href="https://github.com/abap2UI5-apps" target="_blank" rel="noopener">All apps</a>
          </div>
        </div>
      </div>
    </details>
  </div>`;

/* The catalogue's bar (src/catalogue/index.html), the same to the character
 * bar the hrefs, kept in step by hand - a reader who opens a sample from the
 * catalogue must not see the head change under them. The brand is the mark and
 * the name, closed by a hairline (catalogue.css); the nav says which part of
 * the site this is: Samples carries
 * aria-current, which is what makes it the bold one (catalogue.css) and what a
 * screen reader announces, and THE BRAND LEADS HOME. It used to lead to the
 * catalogue - "the front of the section you are in" - which is a rule nobody
 * outside this file knows: a reader who presses a wordmark expects the front
 * door of the project, and pressing it in the samples put them on the front of
 * the samples, which is where the Samples item goes and where most of them
 * already were. Reported from the published site. The row reads: the mark, a
 * hairline, the four sections - Home, Documentation, Samples, Playground -,
 * the search box in the middle, then a hairline, LinkedIn, GitHub and the
 * button that opens the menu (SOCIALS above, wired by MENU_SCRIPT). The box
 * itself is `search.mjs` beside these pages, one module for all 772 of them
 * (src/shell/search-box.mjs, bundled by tools/build-site.mjs). */
/* The box in the bar, as a module beside these pages rather than inlined into
 * every one of them: 772 copies of a dialog is a quarter of this site's weight
 * spent on the same file. It is bundled to dist/samples/search.mjs by
 * tools/build-site.mjs, from src/shell/search-box.mjs, and the catalogue page
 * loads the same file - so a reader who arrives from there has it already. */
const SEARCH_SCRIPT = (up) => `<script type="module" src="${up}samples/search.mjs"></script>`;

/* `current` is which of the four the page IS: the catalogue and the sample
 * pages are Samples, and the 404 below is none of them - a page that is not
 * there must not tell a screen reader it is the samples page. */
const bar = (up, current = "samples") => `<header class="bar">
  <a class="brand" href="https://abap2ui5.github.io/docs/" data-back>
    <img src="${up}favicon.png" alt="" width="20" height="20">
    <span>abap2UI5</span>
  </a>
  <nav class="bar-nav" aria-label="Main">
    <a href="https://abap2ui5.github.io/docs/" data-back><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3.6 10.9 12 4.2l8.4 6.7v8.3a1 1 0 0 1-1 1h-4.3v-6.1H8.9v6.1H4.6a1 1 0 0 1-1-1z"/></svg><span data-text="Home">Home</span></a>
    <a href="https://abap2ui5.github.io/docs/get_started/about" data-site="docs" data-scope="https://abap2ui5.github.io/docs/" data-back><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 7.2C10.5 5.9 8.5 5.2 6 5.2H3.3v11.9H6c2.5 0 4.5.7 6 1.9 1.5-1.2 3.5-1.9 6-1.9h2.7V5.2H18c-2.5 0-4.5.7-6 1.9z"/><path d="M12 7.2v11.8"/></svg><span data-text="Documentation">Documentation</span></a>
    <a href="${up}samples/"${current === "samples" ? ` aria-current="page"` : ""} data-back><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.2" y="4.8" width="17.6" height="14.4" rx="2"/><path d="M3.2 9.4h17.6M8.5 9.4v9.8"/></svg><span data-text="Samples">Samples</span></a>
    <a href="${up}" data-site="playground" title="Write ABAP and run it in the browser"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><path d="M10.2 8.4v7.2a.5.5 0 0 0 .76.43l5.8-3.6a.5.5 0 0 0 0-.86l-5.8-3.6a.5.5 0 0 0-.76.43z" fill="currentColor" stroke="none"/></svg><span data-text="Playground">Playground</span></a>
  </nav>
  <span class="search-slot" data-search></span>
  ${SOCIALS}
</header>`;

const foot = (up) => `<footer class="foot">
  <p>
    One page per sample, built from the catalogues the three repositories commit —
    <a href="https://github.com/abap2UI5/samples">abap2UI5/samples</a>,
    <a href="https://github.com/abap2UI5/samples-controls">samples-controls</a>,
    <a href="https://github.com/abap2UI5/samples-stack">samples-stack</a> —
    and rebuilt on every deploy of the
    <a href="https://github.com/abap2UI5/playground">playground</a>.
    <a href="${up}samples/">Search all of them</a>.
  </p>
</footer>`;

/* The page-specific half of the styling. The frame - palette, bar, footer,
 * badges, actions - is the catalogue's own stylesheet, loaded beside this one:
 * these pages are the catalogue's pages and a second palette would drift from
 * it by the first change to either. */
const CSS = `/* The per-sample pages, beside catalogue.css - written by tools/sample-pages.mjs. */
/* ---- the keyboard's way past the header ------------------------------
   Off-screen until it takes focus, then the first thing on the page. A sample
   page puts a link on every line of the printed class, so the header was a
   long way to tab past. Same shape and wording as the manual's, because a
   reader moving between the two deployments should meet the same control.
   (No backticks in this comment - it lives inside a template literal.) */
.skip {
  position: absolute; left: 8px; top: -60px; z-index: 60;
  padding: 8px 14px;
  border: 1px solid var(--line); border-radius: 6px;
  background: var(--bg); color: var(--fg);
  font-size: 13px; font-weight: 600; text-decoration: none;
  transition: top .12s ease;
}
.skip:focus { top: 8px; }
main:focus { outline: none; }
@media (prefers-reduced-motion: reduce) { .skip { transition: none; } }
/* The one colour these pages add to the catalogue's palette: the line a link
 * points at. Declared in all three of the palette's blocks, because
 * catalogue.css switches scheme two ways - the media query for a reader who
 * has expressed no choice, [data-theme] for one who has - and a value written
 * in only one of them is a highlight that is missing on half the site. Opaque
 * on purpose: the sticky gutter sits on it, and a translucent tint would show
 * the code sliding along underneath the numbers. */
:root { --mark: #e6f0fb; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --mark: #1d2836; } }
:root[data-theme="dark"] { --mark: #1d2836; }
/* The first line of text starts where the documentation's does, and so does
   "On this page": 48px under the bar, which is the number the VPDoc padding
   sets over there. It was 22 here - the crumb line began 26px higher than a
   manual page's title, and the outline began 10px lower than the manual's, so
   two pages a reader steps between started in three different places. Raising
   the documentation to meet THIS page instead would leave 22px between a
   sticky bar and a heading, which is not air, it is a collision waiting for a
   scroll.
   (No backticks in here: this is inside a template literal, and one would end
   the string mid-sentence. It did, again.) */
main { padding-top: 26px; padding-bottom: 40px; }

/* ---- the page and its outline ----
 *
 * Two columns from 1100px up: the sample, and "On this page" beside it. Below
 * that the outline goes, rather than stacking above the content - a list of
 * links between the title and the first section is a wall in front of the
 * page, and everything it names is one scroll away on a phone anyway.
 *
 * The right-hand column was empty at desk width, and the documentation puts
 * its own outline exactly there; a reader crossing between the two documents
 * meets the same thing in the same place. The column is 200px, which is what
 * the longest heading here ("Controls it builds") needs at 13px. */
.sample { display: block; }

@media (min-width: 1100px) {
  .sample {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 225px;
    gap: 0 40px;
    align-items: start;
  }
}

.outline { display: none; }

@media (min-width: 1100px) {
  .outline {
    display: block;
    position: sticky;
    /* The bar is 46px and sticky; 24px of air under it. */
    top: 70px;
    /* Level with the crumb line, which is the page's first text - the
       documentation's outline is level with its own first line the same way. */
    padding-top: 22px;
    /* The hairline the documentation draws down the left of its outline. The
       column grows by the 24px the rule needs, so the words keep their width. */
    border-left: 1px solid var(--line);
    padding-left: 24px;
    font-size: 13px;
  }
}

.outline-head {
  margin-bottom: 8px;
  color: var(--fg);
  font-size: 13px;
  font-weight: 600;
}

.outline nav { display: flex; flex-direction: column; gap: 2px; }

.outline nav a {
  padding: 4px 0;
  color: var(--fg-dim);
  text-decoration: none;
  line-height: 1.4;
}

.outline nav a:hover { color: var(--accent); }

/* The section you are in, marked the way the documentation marks it: the
   entry at full strength instead of dimmed, and a 2px bar in the accent
   standing on the hairline beside it. OUTLINE_SCRIPT sets the class.

   The bar is a pseudo-element on the row rather than one element that slides
   between rows, which is what the documentation does - the slide needs a
   measured offset per row and buys a quarter-second of animation. -25px is
   the 24px of padding plus the 1px rule, so it lands ON the hairline. */
.outline nav a { position: relative; }

.outline nav a::before {
  content: "";
  position: absolute;
  left: -25px;
  top: 50%;
  margin-top: -9px;
  width: 2px;
  height: 18px;
  border-radius: 2px;
  background: var(--accent);
  opacity: 0;
  transition: opacity .2s;
}

.outline nav a.here { color: var(--fg); }
.outline nav a.here::before { opacity: 1; }
.crumbs { margin: 22px 0 6px; font-size: 12px; color: var(--fg-dim); }
.crumbs a { color: var(--fg-dim); }
/* A UI5 NAME IS ONE WORD, AND SOME OF THEM ARE 28 CHARACTERS LONG. The titles
 * on these pages come from three sample repositories and carry the control
 * they are about - "Object Page with ObjectPageHeaderActionButtons", and the
 * chips under them are whole names like
 * sap.suite.ui.microchart.InteractiveDonutChart. A word that does not fit is
 * not wrapped, it is overflowed: that h1 was 406px wide in a 296px column and
 * the page slid sideways with it, by 98px at 320 and still by 5 at 414. It is
 * inherited, so one declaration covers the title, the sentence, the chips and
 * the neighbours; the printed class is pre-formatted and unaffected, which is
 * right - that one scrolls in its own box.
 * (No backticks in here: this stylesheet is a template literal.) */
.sample, .all-groups { overflow-wrap: break-word; }
.sample h1 { font-size: 26px; margin: 0 0 8px; line-height: 1.25; }
.sample .lede { margin: 0 0 4px; font-size: 15px; color: var(--fg); max-width: 74ch; }
.sample .who { font-family: var(--font-mono); font-size: 12px; color: var(--fg-dim); }
.sample .badges { margin: 12px 0 24px; }
.warns {
  background: var(--warn-bg); color: var(--warn); border-radius: 8px;
  padding: 10px 14px; margin: 0 0 22px; max-width: 74ch; font-size: 13px;
}
.warns b { font-weight: 600; }
h2 { font-size: 15px; margin: 26px 0 8px; }
/* THE VALUE COLUMN HAS TO BE ALLOWED TO BE NARROW, and 1fr does not allow it:
 * 1fr is minmax(auto, 1fr), and auto there is the column's MIN-CONTENT width -
 * the longest thing in it that cannot be broken. One of these rows is a
 * documentation link printed as its address, up to 60 characters of
 * unbreakable url, so the column refused to be narrower than 384px and the
 * whole page went with it: at 390px it scrolled sideways by 6, at 360 by 36,
 * at 320 by 77. On every one of the 771 sample pages, on every phone.
 * minmax(0, 1fr) lets the column shrink, and overflow-wrap gives the url
 * somewhere to break - a class name or an address wrapped over two lines
 * reads; a page that slides under the thumb does not.
 * (No backticks in here: this stylesheet is a template literal.) */
.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 18px; margin: 0; max-width: 74ch; font-size: 13px; }
.facts dt { color: var(--fg-dim); }
.facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.facts code { font-family: var(--font-mono); font-size: 12px; }
.chips { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; }
.chips li { margin: 0; }
.chips a, .chips span {
  display: inline-block; font-family: var(--font-mono); font-size: 12px;
  border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; text-decoration: none;
  /* A flex item is as wide as its content unless it is told otherwise, and a
   * wrapping row gives an over-wide pill a line of its own at that width
   * rather than a narrower pill. Both halves are needed: the cap, and
   * somewhere for a dotted name with no spaces in it to break. */
  max-width: 100%; overflow-wrap: anywhere;
}
.chips a:hover { border-color: var(--accent); }
/* The demo. Same card as the class below it - one shape for the sample
 * running and the sample written, because they are the same sample - and the
 * button inside it is the loader's own (src/embed/abap2ui5-embed.js), which
 * ships no stylesheet: an embedding page dresses it, and this one dresses it
 * as the catalogue. Unpressed it is a band and not the frame's full 420
 * pixels: a demo nobody asked for should cost the page one line of its
 * scroll, not a screen of empty box on the way past. */
/* THE APP IS READ AS A WINDOW, NOT AS A STRIP. The column is 1160px wide and
 * the demo used to be 420px tall in it - 2.8:1, a letterbox, in which a UI5
 * page with a header and a list had room for about four rows before it started
 * scrolling inside a box the reader could not resize. Taller, and no wider
 * than an app is usually designed for, comes to about 5:4: the shape of a
 * window, which is the shape of the thing inside it. The block keeps the
 * column's left edge - it is a part of the page, not an island in it. */
.demo {
  border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
  margin: 0; background: var(--bg);
  max-width: 820px;
}
.demo-head {
  display: flex; flex-wrap: wrap; gap: 2px 16px; justify-content: space-between; align-items: baseline;
  padding: 7px 13px; font-size: 12px; color: var(--fg-dim);
  background: var(--bg-sunken); border-bottom: 1px solid var(--line);
}
.abap2ui5-demo { min-height: 132px; display: flex; }
.abap2ui5-demo-start {
  display: block; width: 100%; padding: 44px 16px; border: 0; cursor: pointer;
  background: transparent; color: var(--accent); font: inherit; font-size: 14px; font-weight: 600;
}
.abap2ui5-demo-start::after {
  content: " — nothing loads until you press it";
  color: var(--fg-dim); font-weight: 400;
}
.abap2ui5-demo-start:hover { background: var(--bg-sunken); }
.demo-note { margin: 8px 0 0; }
/* The class itself. The frame is a card the width of the text column plus
 * whatever the code needs: ABAP is written in lines that do not wrap, so the
 * block scrolls sideways rather than folding a chain into a paragraph, and it
 * is the only thing on these pages allowed to be wider than the prose. The
 * token colours are the ones the playground's bottom panel prints XML and
 * JSON in (src/shell/shell.css) - one scheme for the whole site. */
.source { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin: 0; }
.source-head {
  display: flex; flex-wrap: wrap; gap: 2px 16px; justify-content: space-between; align-items: baseline;
  padding: 7px 13px; font-size: 12px; color: var(--fg-dim);
  background: var(--bg-sunken); border-bottom: 1px solid var(--line);
}
.source-head b { font-family: var(--font-mono); font-weight: 400; color: var(--fg); }
.source-body {
  margin: 0; padding: 12px 0; overflow-x: auto; background: var(--bg);
  font-family: var(--font-mono); font-size: 12.5px; line-height: 1.55; tab-size: 2;
}
.source-body code { font: inherit; background: inherit; counter-reset: line; }
/* A line of the class, and its number - GitHub's line links on a page that has
 * no editor: every line carries an id, so #L42 and #L42-L58 address a PASSAGE
 * of a sample the way a heading addresses a section. "Look at line 40 to 55"
 * is most of what one person tells another about a sample, and until this it
 * could only be said about the copy on GitHub.
 *
 * Three properties this had to keep:
 *
 *  - The numbers are not in the text. They are a CSS counter, drawn by
 *    ::before, so selecting the block and copying it gives the class as
 *    committed and not nine hundred numbers down its left edge - which is the
 *    whole reason the class is printed here rather than linked.
 *  - The gutter stays where it is when the block scrolls sideways. An abap2UI5
 *    view is a chain written wide, and a number that has scrolled out of the
 *    box is a number nobody can read a link off: sticky inside the scroller,
 *    over an OPAQUE background - which is why the line carries the background
 *    and the number inherits it, so a marked line is not a white column with a
 *    coloured line beside it.
 *  - One line needs no JavaScript at all: :target is the browser's own answer
 *    to #L42, and it is what a page with its script blocked still does. The
 *    script beside it takes that case over (it adds the live class, and the
 *    rule below then stops matching) because it also has to answer #L42-L58,
 *    which is a fragment no element has an id for. */
/* scroll-margin clears the bar, which is sticky at 46px and would otherwise
 * be standing on the line a link just jumped to. */
.ln { display: inline-block; min-width: 100%; padding-right: 14px; background: inherit; counter-increment: line; scroll-margin: 60px 0; }
.ln > a {
  position: sticky; left: 0; z-index: 1; display: inline-block;
  min-width: 3ch; padding: 0 14px; text-align: right; background: inherit;
  color: var(--fg-dim); text-decoration: none; user-select: none; -webkit-user-select: none;
}
.ln > a::before { content: counter(line); }
.ln > a:hover { color: var(--accent); }
/* A THUMB CANNOT PICK A LINE, and should not have to try. Each of these is
   36x19 with the next one 19px below it - half the size a target is asked to
   be, at a third of the spacing - so on a touch screen every tap near the
   gutter was a coin toss between two lines. It is a POINTER affordance: the
   number is drawn by this stylesheet and the link under it is how a mouse
   picks a line up. On a coarse pointer the number stays and the link stops
   answering, which also gives the listing back the 50 taps it was swallowing
   at its left edge while somebody tried to scroll it. */
@media (pointer: coarse) {
  .ln > a { pointer-events: none; }
}
.source-body:not(.live) .ln:target, .ln.is-marked { background: var(--mark); }
.source-tools { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 14px; }
/* 19px of link is a line of text, which is right for a mouse and under half
   what a thumb is asked to be given. The height comes from padding rather than
   from a size, so nothing moves for a reader with a pointer. */
@media (pointer: coarse) {
  .source-tools a, .source-copy, .run { padding-top: 4px; padding-bottom: 4px; }
}
.source-copy {
  padding: 0; border: 0; background: none; font: inherit; color: var(--accent);
  cursor: pointer; text-decoration: underline; text-underline-offset: 2px;
}
.code-key { color: var(--code-name); }
.code-string { color: var(--code-string); }
.code-number { color: var(--code-atom); }
.code-comment { color: var(--fg-dim); font-style: italic; }
.source-note { margin: 8px 0 0; }
.nearby { list-style: none; margin: 0; padding: 0; max-width: 74ch; }
.nearby li { margin: 0 0 5px; font-size: 13px; }
.nearby span { color: var(--fg-dim); }
.note { color: var(--fg-dim); font-size: 13px; max-width: 74ch; }
.all-groups h2 { margin-top: 28px; }
.all-groups ul { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 32px; }
.all-groups li { margin: 0 0 4px; font-size: 13px; break-inside: avoid; }
@media (max-width: 620px) {
  .all-groups ul { columns: 1; }
  .facts { grid-template-columns: minmax(0, 1fr); gap: 2px 0; }
  .facts dd { margin-bottom: 8px; }
}
`;

/* SCROLLABLE, SO REACHABLE - why `<pre class="source-body">` carries
 * `tabindex="0"`, a role and a label (samplePage( ) writes it).
 *
 * The class is printed as it was written, so a long chain runs past the right
 * edge and the block scrolls sideways: 404px of it on the widest sample. A
 * mouse or a trackpad gets at that; a keyboard did not, because nothing inside
 * the block is in the tab order - the line numbers are links and were
 * deliberately taken OUT of it, one stop per line being worse than none.
 * `tabindex="0"` makes the block itself the stop and the arrow keys then
 * scroll it; the role and the label say what a screen reader has landed in.
 * The manual does exactly this to its own listings and its tables, down to the
 * shape of the label ("Listing 1, abap").
 *
 * The reasoning is here rather than in the markup for the reason everything
 * else on these pages is: a comment in the emitted page is written 771 times,
 * and this one is 600 bytes - half a megabyte of published site.
 */

/* How much of a class a page prints. Nearly all of them are shorter than this
 * and are printed whole; the tail of samples-controls is not - one of them is
 * two megabytes of table data around a chain - and a page that is mostly
 * literal rows is a page nobody reads and a deploy nobody needs. What is cut
 * is said, and the whole class is one link away. */
const MAX_LINES = 900;
const MAX_CHARS = 60000;

/** The class as it will be printed: whole, or the first of it and how much. */
function forPrinting(code) {
  const lines = String(code).replace(/\s+$/, "").split("\n");
  const kept = [];
  let chars = 0;
  for (const line of lines) {
    if (kept.length >= MAX_LINES || chars + line.length > MAX_CHARS) break;
    kept.push(line);
    chars += line.length + 1;
  }
  return { text: kept.join("\n"), shown: kept.length, lines: lines.length };
}

/* The class as the page prints it: one element per line, carrying the id that
 * makes it addressable and the numbered link that hands the address out.
 * Joined with a newline and nothing else, so what the block CONTAINS is still
 * exactly the file - the numbers are drawn by CSS (a counter), and the link
 * that draws them is empty, so a reader who selects the block and copies it
 * gets ABAP they can paste. The number is not repeated in an attribute
 * either: the script beside it reads the line off the href it is already
 * written with. Nor is there a class on it - the stylesheet reaches it as
 * `.ln > a`, and there is nothing else it could be. Twelve characters a line
 * is two megabytes over the 191,000 lines these pages print, which is the
 * whole argument: this markup is repeated once per line of every class in
 * three repositories, so everything on it is paid at that scale and only what
 * is load-bearing is on it. The aria-label is: an empty link with no name is a
 * link a screen reader cannot announce. What is NOT on it is `tabindex="-1"`,
 * which these links want and which the script below sets instead: 19 bytes a
 * line is 3.6 MB over 191,000 lines, and this is the one place where a thing
 * that costs nothing anywhere else costs megabytes. */
const numbered = (text) =>
  highlightAbapLines(text)
    .map((html, i) =>
      `<span class="ln" id="L${i + 1}"><a href="#L${i + 1}" aria-label="Line ${i + 1}"></a>${html}</span>`)
    .join("\n");

/* The line links, once they are in a browser. #L42 alone is answered by the
 * stylesheet (:target) and needs none of this; what needs a script is the
 * RANGE - #L42-L58 is a fragment no element has an id for - the shift-click
 * that composes one, and the button that hands the result over.
 *
 * IT ALSO TAKES THE GUTTER OUT OF THE TAB ORDER, which is the one line in it
 * that is not about ranges. Every line of a class is a link, so a reader on a
 * keyboard pressed Tab fifty times to get past one listing: 52 of this page's
 * 94 stops were line numbers, and 55 of a manual chapter's 124. The gutter is
 * a POINTER affordance - the number is drawn by the stylesheet and the link
 * under it is how a mouse picks a line up - and nothing is lost by it: the
 * link still answers a click, #L42 still opens where it always did, and a
 * screen reader still meets it in the page, because a browse cursor is not
 * the tab order. Set by the script rather than written into the markup
 * because as an attribute it is 3.6 MB across 191,000 lines; here it is one
 * loop per page, and the comment explaining it is up here, where it is not
 * paid 771 times.
 *
 * The address bar is the share link, so the selection is written to it with
 * `replaceState` rather than pushed: a reader who presses Back after picking
 * three lines wants the page they came from, not the two selections before
 * this one. And because that leaves the document's :target behind, the block
 * is marked `live` the moment this runs and the stylesheet's own rule stops
 * matching - one line highlighted by one mechanism, never two by two.
 *
 * A modified click is left alone: ctrl or cmd on a line number opens that line
 * in a new tab, which is a link doing what a link does.
 *
 * At the end of the body, and only on a page that prints a class. */
/* WHICH SECTION YOU ARE IN, in the outline on the right.
 *
 * The documentation's outline has always marked it - a 2px bar in the accent
 * against the hairline, and the entry's text at full strength instead of
 * dimmed - and these pages listed the same headings with nothing saying which
 * one you had reached. On a sample page that is five sections and a class
 * listing long, an outline that never changes is a table of contents; one that
 * moves is a position.
 *
 * The rule is the one VitePress uses, and it is copied case for case out of
 * `theme-default/composables/outline.js`:
 *
 *   - at the very top of the page (scrollY < 1), NOTHING is marked. A reader
 *     looking at the title is not inside a section yet, and a bar against the
 *     first row there claims they are. This case was missing at first and is
 *     the whole reason the two outlines still differed after everything else
 *     matched: the manual marked nothing at the top and these pages marked
 *     row one.
 *   - at the bottom, the LAST row - a short final section may never push its
 *     heading over the line.
 *   - otherwise the last heading whose top has passed under the bar, and none
 *     if no heading has. Not the nearest to the middle of the screen, which
 *     flickers between two headings on a slow scroll, and not the first one
 *     visible, which marks the section being left.
 *
 * Read on rAF rather than per scroll event: this measures every heading, and
 * scroll fires per frame anyway.
 *
 * The hash is NOT written. Clicking a row sets one, and that is a reader
 * asking for an address; scrolling past a heading is not, and a history entry
 * per section makes Back walk the page instead of leaving it. */
const OUTLINE_SCRIPT = `<script>
  (function () {
    var nav = document.querySelector(".outline nav");
    if (!nav) return;
    var links = [].slice.call(nav.querySelectorAll("a"));
    var heads = links.map(function (a) {
      return document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
    });
    if (!heads.length || heads.indexOf(null) > -1) return;

    /* The bar is 46px and sticky, plus the air a heading needs under it before
       it counts as reached. The same number the outline's own \`top\` uses. */
    var LINE = 70;
    var at = -1;

    function mark() {
      /* -1 is "no section", and it is the STARTING value rather than row 0:
         above the first heading there is no section to be in. */
      var last = -1;
      if (window.scrollY >= 1) {
        for (var i = 0; i < heads.length; i++) {
          if (heads[i].getBoundingClientRect().top <= LINE) last = i;
        }
        /* Scrolled to the end: the final section is the one being read,
           whether or not its heading ever crossed the line. */
        if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) {
          last = heads.length - 1;
        }
      }
      if (last === at) return;
      if (at > -1) links[at].classList.remove("here");
      if (last > -1) links[last].classList.add("here");
      at = last;
    }

    var pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; mark(); });
    }

    mark();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule, { passive: true });
  })();
</script>`;

const LINES_SCRIPT = `<script>
  (function () {
    var pre = document.querySelector(".source-body");
    if (!pre) return;
    var lines = pre.querySelectorAll(".ln");
    if (!lines.length) return;
    pre.classList.add("live");

    var hint = document.querySelector(".source-hint");
    var copy = document.querySelector(".source-copy");
    var HINT = hint ? hint.textContent : "";
    var COPY = copy ? copy.textContent : "";
    /* [0-9] rather than the shorthand: this script is written inside a
       template literal, where a backslash is an escape before it is
       anything else - the class would arrive in the page as "d+" and
       match nothing. (It did.) */
    var HASH = /^#L([0-9]+)(?:-L([0-9]+))?$/;
    /* The line a shift-click extends from: the last one picked on its own. */
    var anchor = 0;

    /* The gutter is not fifty tab stops (see above). */
    var gutter = document.querySelectorAll(".ln > a");
    for (var gi = 0; gi < gutter.length; gi++) gutter[gi].tabIndex = -1;

    var picked = function () {
      var m = HASH.exec(location.hash);
      if (!m) return null;
      var a = Number(m[1]);
      var b = m[2] === undefined ? a : Number(m[2]);
      return { from: Math.min(a, b), to: Math.max(a, b) };
    };

    var say = function (text) { if (hint) { hint.textContent = text; hint.hidden = false; } };

    var mark = function (scroll) {
      for (var i = 0; i < lines.length; i++) lines[i].classList.remove("is-marked");
      var range = picked();
      if (copy) copy.hidden = range === null;
      if (range === null) { say(HINT); return; }
      var first = null;
      for (var n = range.from; n <= range.to; n++) {
        var el = document.getElementById("L" + n);
        if (!el) continue;
        el.classList.add("is-marked");
        if (first === null) first = el;
      }
      /* A long class is printed as far as its first 900 lines and no further,
         so a link into what was cut has to be answered by saying so rather
         than by silently highlighting nothing. */
      if (first === null) {
        say("Line " + range.from + " is not on this page — the first " + lines.length + " lines are printed.");
        return;
      }
      say(range.from === range.to ? "Line " + range.from : "Lines " + range.from + "–" + range.to);
      if (scroll) first.scrollIntoView({ block: "center" });
    };

    pre.addEventListener("click", function (e) {
      var number = e.target && e.target.closest ? e.target.closest(".ln > a") : null;
      if (!number || e.metaKey || e.ctrlKey) return;
      var line = Number(String(number.getAttribute("href")).slice(2));
      if (!line) return;
      var hash = "#L" + line;
      if (e.shiftKey && anchor) hash = "#L" + Math.min(anchor, line) + "-L" + Math.max(anchor, line);
      else anchor = line;
      e.preventDefault();
      history.replaceState(null, "", hash);
      mark(false);
    });

    addEventListener("hashchange", function () {
      var range = picked();
      if (range) anchor = range.from;
      mark(true);
    });

    if (copy) {
      copy.addEventListener("click", function () {
        var done = function (text) {
          copy.textContent = text;
          setTimeout(function () { copy.textContent = COPY; }, 2000);
        };
        try {
          navigator.clipboard.writeText(location.href).then(
            function () { done("Link copied"); },
            function () { done("Copy it from the address bar"); });
        } catch (e) { done("Copy it from the address bar"); }
      });
    }

    var start = picked();
    if (start) anchor = start.from;
    mark(start !== null);
  })();
</script>`;

/** One sample's page. */

/**
 * "On this page", built out of the page's own headings.
 *
 * A sample page is a stack of sections - the facts, the controls, the ABAP,
 * what else is nearby - and on a desk-width window the right-hand third of it
 * was empty. The documentation puts its outline there, and a reader crossing
 * from one to the other expects the same thing in the same place; more to the
 * point, "where is the code" on a page whose code is two screens down is a
 * question the page can answer without being scrolled.
 *
 * The headings are given their ids HERE rather than in the twenty places they
 * are written, so the outline and the anchors cannot drift apart: one pass
 * over the finished markup produces both. The id is the heading's own text,
 * folded to a slug, which is what a reader sees in the address bar after
 * clicking a row.
 */
function outline(html) {
  const rows = [];
  const seen = new Set();
  const withIds = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (whole, inner) => {
    /* The text a reader sees, with any markup inside the heading dropped. */
    const text = inner.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    let id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
    while (seen.has(id)) id += "-x";
    seen.add(id);
    rows.push({ id, text });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  /* One heading is not an outline - it is the same word twice on one screen. */
  if (rows.length < 2) return { html: withIds, aside: "" };
  /* A DIV AROUND A NAMED NAV, not an <aside> around one. Both are landmarks,
     so naming the nav - which is what a reader jumps between - left the page
     announcing "On this page" twice, once as a complementary region and once
     as the navigation inside it. The nav is the one that is worth landing on;
     the box around it is layout, and `.outline` is what every rule here and
     in the manual's own stylesheet has always addressed. */
  const aside = `<div class="outline">
    <div class="outline-head">On this page</div>
    <nav aria-label="On this page">${rows.map((r) => `<a href="#${r.id}">${esc(r.text)}</a>`).join("")}</nav>
  </div>`;
  return { html: withIds, aside };
}

function samplePage(row, ctx) {
  const { sources, byGroup, floor } = ctx;
  const source = sources.get(row.source);
  const title = String(row.title || row.class);
  const lede = String(row.summary || row.note || "");
  const canonical = `${SITE}samples/${row.dir}/`;
  const controls = row.controlNames;
  /* What a result list shows, and the words somebody actually types: a port
   * carries the UI5 entity it rebuilds, which is the half of "sap.m.Wizard in
   * ABAP" that is worth being found for. The class name is on the page rather
   * than in the title - nobody searches for it, and it costs the title's
   * width. */
  /* AND IT HAS TO NAME THIS ONE. Ninety-eight of these pages shared a title
     with another: eight of them were "Binding · abap2UI5 sample", seven
     "Table", seven "Message". For a series of samples the catalogue's `title`
     is the series - the sentence that says which one this is, is its `note` -
     so the title said the same thing eight times, in a result list, in a row
     of browser tabs and in a shared link. Only where it collides, because a
     title carrying both is half as much title: the writer knows the whole set
     and says which ones need the second half (writeSamplePages below). */
  const label = ctx.needsNote(row) && row.note && row.note !== title
    ? `${title} — ${cut(row.note, 70)}`
    : title;
  const pageTitle = row.entity
    ? `${label} · ${row.entity} in abap2UI5`
    : `${label} · abap2UI5 sample`;

  /* What a search result shows: the sample's own sentence, then what it is,
   * because a description that could be any of 770 rows is worth nothing. */
  const description = cut(
    `${lede ? `${lede} — ` : ""}the abap2UI5 sample ${row.class.toUpperCase()}`
    + `${source ? ` from ${source.repo}` : ""}. Read the ABAP or run it in the browser.`,
    180,
  );

  const github = safe(row.github);
  const docs = safe((row.docs || [])[0]);
  const file = String(row.raw).split("/").pop();

  /* The facts, which is now also where the links out live: the class on
   * GitHub, SAP's own sample, the documentation. They were three buttons above
   * this list and they were three buttons in front of the answer - a reader
   * who has not yet read a line of the page has nothing to decide with, and
   * the one thing they came to do, run it, is a box further down that does it
   * here. A link is worth what the fact beside it says it is. */
  const facts = [];
  if (source) {
    facts.push([
      "Repository",
      `<a href="https://github.com/${esc(source.repo)}">${esc(source.repo)}</a>`,
    ]);
  }
  facts.push(["Class", `<code>${esc(row.class.toUpperCase())}</code>`]);
  if (github) {
    facts.push([
      "Source file",
      `<a href="${esc(github)}" target="_blank" rel="noopener"><code>${esc(file)}</code> ↗</a>`,
    ]);
  }
  if (row.group) facts.push([row.source === "controls" ? "Library" : "Category", esc(row.group)]);
  if (row.stageTitle) facts.push(["Learning path", esc(row.stageTitle)]);
  if (row.entity) facts.push(["UI5 entity", `<code>${esc(row.entity)}</code>`]);
  if (row.sample) facts.push(["Demo kit sample", `<code>${esc(row.sample)}</code>`]);
  const original = openui5Sample(row.entity, row.sample);
  if (original) {
    facts.push([
      "SAP's own sample",
      `<a href="${esc(original)}" target="_blank" rel="noopener">running at sdk.openui5.org ↗</a>`,
    ]);
  }
  facts.push([
    "Minimum UI5",
    row.minUi5 === floor ? `${esc(floor)} — the floor abap2UI5 holds its samples to` : esc(row.minUi5),
  ]);
  facts.push([
    "In the playground",
    row.runs
      ? "runs in the browser, with no system and nothing installed"
      : `${esc(row.needs || "does not run here")} — it opens for reading instead`,
  ]);
  if (row.runsOn) facts.push(["Runs on", esc(row.runsOn)]);
  if (docs) {
    facts.push([
      "Documentation",
      `<a href="${esc(docs)}" target="_blank" rel="noopener">${esc(cut(docs.replace(/^https:\/\//, ""), 60))} ↗</a>`,
    ]);
  }

  /* Why it needs what it needs: the linter's own reasons, which is the half a
   * reader can argue with rather than only believe. */
  const why = [
    row.needsDetail ? esc(row.needsDetail) : "",
    ...(row.since || []).map((s) => `<code>${esc(s.name)}</code> since ${esc(s.since)}`),
  ].filter(Boolean);

  /* The whole playground, on this sample's code, in THIS tab - the round
   * trip the catalogue is built around: `from=catalogue` and `back=` are what
   * turn the source link in that playground into "Back to the catalogue",
   * narrowed to the one search that has exactly one hit (src/shell/main.mjs).
   * Same tab on purpose, and the label says so: it is a switch to the
   * playground with the code that is on this page, not a window that opens
   * beside it - the way back is in the playground's bar, and a reader who
   * wants a second tab has the middle button. It sits on the demo box rather
   * than above the page, because it is the answer to "I want more room than
   * this box" and to "I want to change a line" - the box shows the app alone -
   * and both are things a reader knows after seeing the box and not before. */
  const run = row.runs
    ? `<a class="run" href="../../?src=${encodeURIComponent(row.raw)}&amp;from=catalogue&amp;back=`
      + `${encodeURIComponent(`q=${row.class}`)}">Switch to Playground with this code</a>`
    : "";

  /* Only a sample that RUNS here gets a demo. The others are listed, read and
   * linked - what they need is on the page - and a start button that could
   * only ever fail is not an offer. */
  const demo = row.runs
    ? `<h2>Run it here</h2>
  <div class="demo">
    <div class="demo-head">
      <span>The sample running, in this page — the app on its own, with no editor over it.</span>
      ${run}
    </div>
    <div class="abap2ui5-demo" data-src="${esc(row.raw)}" data-view="app" data-height="620"
         data-label="Run it in the browser"></div>
  </div>
  <p class="note demo-note">
    Nothing is installed and nothing is sent anywhere: the ABAP is compiled to
    JavaScript in this browser and runs against abap2UI5 itself.
  </p>
  <script src="../../embed/abap2ui5-embed.js" defer></script>`
    : "";

  /* The class, if the fetch got it (tools/sample-sources.mjs). A page without
   * it is the page as it was before this block existed, which is why nothing
   * else here depends on it. */
  const code = row.code ? forPrinting(row.code) : undefined;

  /* The samples AROUND this one in its group, not the first twelve of it:
   * every sap.m port would otherwise link to the same twelve neighbours, which
   * is one dense corner and seven hundred dead ends - and a reader on port 400
   * is nearer to 395 than to 001. */
  const group = byGroup.get(`${row.source}:${row.group}`) || [];
  const at = Math.max(0, group.findIndex((other) => other.dir === row.dir));
  const from = Math.max(0, Math.min(at - 6, group.length - 13));
  const nearby = group.slice(from, from + 13).filter((other) => other.dir !== row.dir);

  /* WHAT THE PAGE IS, and WHERE IT SITS - two blocks, because a search result
     shows them in two places. The first is the sample itself; the second is
     the trail that is drawn above the title anyway, and it is the one part of
     this markup a reader ever sees: a result for a sample shows
     "abap2UI5 › Sample catalogue › Controls" over its link rather than a bare
     url, which is the difference between a result somebody places and one they
     have to guess at. Every step of it is a page that exists - the group is in
     the visible trail and not here, because it has no address of its own. */
  const trail = [
    { name: "Sample catalogue", item: `${SITE}samples/` },
    ...(source ? [{ name: source.title, item: `${SITE}samples/?src=${encodeURIComponent(row.source)}` }] : []),
    { name: title, item: canonical },
  ];
  const jsonLd = JSON.stringify([{
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: title,
    description: lede || title,
    programmingLanguage: "ABAP",
    codeRepository: github,
    url: canonical,
    keywords: [...(row.keywords || []), ...controls].join(", ") || undefined,
    isPartOf: { "@type": "WebSite", name: "abap2UI5 sample catalogue", url: `${SITE}samples/` },
  }, {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({ "@type": "ListItem", position: i + 1, ...step })),
  }]).replace(/</g, "\\u003c");

  /* The page's own body, built first so that outline( ) can walk it: the
     headings get their ids and the aside gets its rows from one pass, which
     is what keeps a link in the outline pointing at a heading that exists. */
  /* A trail is navigation, not a paragraph of links: a screen reader
     announced "Sample catalogue › Controls › sap.m" as prose, and a reader who
     moves by landmark could reach the outline and not the way back out. The
     element changes and nothing else does - the margin, the size and the
     colour are the class's, in sample.css. The manual's own trail says the
     same thing now. */
  const page = outline(`  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="../">Sample catalogue</a>${source ? ` › <a href="../?src=${esc(row.source)}">${esc(source.title)}</a>` : ""}${row.group ? ` › ${esc(row.group)}` : ""}
  </nav>
  <h1>${esc(title)}</h1>
  ${lede ? `<p class="lede">${esc(lede)}</p>` : ""}
  <p class="who">${esc(row.class.toUpperCase())}</p>

  <div class="badges">
    ${source ? `<span class="badge">${esc(source.title)}</span>` : ""}
    ${row.group ? `<span class="badge">${esc(row.group)}</span>` : ""}
    <span class="badge">UI5 ${esc(row.minUi5)}</span>
    ${row.needs ? `<span class="badge needs">${esc(row.needs)}</span>` : ""}
  </div>

  ${
    row.needs
      ? `<p class="warns"><b>${esc(row.needs)}.</b> This sample is listed here because a sample
    somebody cannot find is worse than one they cannot run${why.length ? `: ${why.join("; ")}` : ""}.
    The ABAP is below; installed on a system that has what it needs, it runs there.</p>`
      : ""
  }

  <h2>The facts</h2>
  <dl class="facts">
    ${facts.map(([term, value]) => `<dt>${esc(term)}</dt><dd>${value}</dd>`).join("\n    ")}
  </dl>

  ${row.keywords && row.keywords.length ? `<p class="note">Keywords: ${esc(row.keywords.join(", "))}</p>` : ""}

  <h2>Controls it builds</h2>
  ${
    controls.length
      ? `<ul class="chips">${controls
        .map((name) => `<li><a href="../?ctl=${encodeURIComponent(name)}">${esc(name)}</a></li>`)
        .join("")}</ul>
  <p class="note">Read out of the builder chain by the
  <a href="https://www.npmjs.com/package/@abap2ui5/linter">abap2UI5 linter</a>, not from the
  category this sample is filed under — which is what makes “which samples build one of these”
  a question the catalogue can answer at all.</p>`
      : `<p class="note">${
        row.noChain
          ? "No view is built in this class — it is the backend half of a sample, or a class the linter found no builder chain in."
          : "Not known: this sample's repository has not published the linter's derived facts for it yet."
      }</p>`
  }

  ${
    row.libraries.length
      ? `<h2>Libraries</h2>
  <ul class="chips">${row.libraries
    .map((lib) => `<li><a href="../?lib=${encodeURIComponent(lib)}">${esc(lib)}</a></li>`)
    .join("")}</ul>`
      : ""
  }

  ${demo}

  ${
    code
      ? `<h2>The ABAP</h2>
  <div class="source">
    <div class="source-head">
      <span><b>${esc(file)}</b> — ${code.lines} line${code.lines === 1 ? "" : "s"}${
        row.branch ? `, on branch ${esc(row.branch)}` : ""
      }</span>
      <span class="source-tools">
        <span class="source-hint" hidden>Click a number to link to a line — shift-click for a range.</span>
        <button type="button" class="source-copy" hidden>Copy link</button>
        ${github ? `<a href="${esc(github)}" target="_blank" rel="noopener">Read it on GitHub ↗</a>` : ""}
      </span>
    </div>
    <pre class="source-body" tabindex="0" role="region" aria-label="${esc(row.class.toUpperCase())}, ABAP"><code>${numbered(code.text)}</code></pre>
  </div>${
    code.shown < code.lines
      ? `\n  <p class="note source-note">The first ${code.shown} lines of ${code.lines}${
        github ? ` — <a href="${esc(github)}" target="_blank" rel="noopener">the whole class is on GitHub</a>` : ""
      }.</p>`
      : ""
  }`
      : ""
  }

  ${
    nearby.length
      ? `<h2>More in ${esc(row.group || (source ? source.title : "this repository"))}</h2>
  <ul class="nearby">${nearby
    .map((other) => `<li><a href="../${esc(other.dir)}/">${esc(other.title)}</a>${
      other.note ? ` <span>— ${esc(cut(other.note, 90))}</span>` : ""
    }</li>`)
    .join("")}</ul>`
      : ""
  }

  <p class="note"><a href="../">Search every abap2UI5 sample</a> · <a href="../all/">the full list on one page</a></p>`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${social({ title: pageTitle, description, url: canonical })}
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f5f7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e2024">
<link rel="icon" href="../../favicon.png">
<link rel="apple-touch-icon" href="../../apple-touch-icon.png">
<link rel="stylesheet" href="../catalogue.css">
<link rel="stylesheet" href="../sample.css">
${THEME_SCRIPT}
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>

<!-- The keyboard's way in. A sample page puts a link on every line of the
     printed class and the catalogue puts one on every sample, so the bar and
     the header were a long way to tab past to reach either. Same link, same
     wording and same first-stop position as the manual's. -->
<a class="skip" href="#main">Skip to content</a>

${bar("../../")}

<main id="main" tabindex="-1" class="sample">
  <div class="sample-body">${page.html}</div>
  ${page.aside}
</main>

${foot("../../")}
${MENU_SCRIPT}
${MEMORY_SCRIPT}
${SEARCH_SCRIPT("../../")}
${OUTLINE_SCRIPT}
${code ? LINES_SCRIPT : ""}
</body>
</html>
`;
}

/** Every sample as one page of links - the crawl path, and a list to scroll. */
function allPage(rows, ctx) {
  const { sources } = ctx;
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.source}:${row.group}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const sections = [];
  for (const source of sources.values()) {
    const keys = [...groups.keys()].filter((k) => k.startsWith(`${source.id}:`));
    if (keys.length === 0) continue;
    const parts = keys.sort().map((key) => {
      const list = groups.get(key);
      const name = key.slice(source.id.length + 1) || "Other";
      return `<h2>${esc(source.title)} — ${esc(name)}</h2>
  <ul>${list
    .map((row) => `<li><a href="../${esc(row.dir)}/">${esc(row.title)}</a>${
      row.note ? ` <span>— ${esc(cut(row.note, 80))}</span>` : ""
    }</li>`)
    .join("")}</ul>`;
    });
    sections.push(parts.join("\n  "));
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Every abap2UI5 sample · the full list</title>
<meta name="description" content="All ${rows.length} abap2UI5 samples on one page: the learning path, the UI5 demo kit rebuilt in ABAP, and the samples that need OData, RAP or a launchpad — each one linked to its own page.">
<link rel="canonical" href="${SITE}samples/all/">
${social({
  title: "Every abap2UI5 sample · the full list",
  description: `All ${rows.length} abap2UI5 samples on one page: the learning path, the UI5 demo kit rebuilt in ABAP, and the samples that need OData, RAP or a launchpad - each one linked to its own page.`,
  url: `${SITE}samples/all/`,
  type: "website",
})}
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f5f7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e2024">
<link rel="icon" href="../../favicon.png">
<link rel="apple-touch-icon" href="../../apple-touch-icon.png">
<link rel="stylesheet" href="../catalogue.css">
<link rel="stylesheet" href="../sample.css">
${THEME_SCRIPT}
<script type="application/ld+json">${JSON.stringify([{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Every abap2UI5 sample",
  description: `All ${rows.length} abap2UI5 samples on one page, each one linked to its own page.`,
  url: `${SITE}samples/all/`,
  isPartOf: { "@type": "WebSite", name: "abap2UI5 sample catalogue", url: `${SITE}samples/` },
  /* The count and nothing else. The 771 rows themselves are the page, in
     markup a crawler already reads; repeating them here as ListItems would
     add 85 kB to a 144 kB page to say a second time what the links say. */
  mainEntity: {
    "@type": "ItemList",
    name: "abap2UI5 samples",
    numberOfItems: rows.length,
  },
}, {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Sample catalogue", item: `${SITE}samples/` },
    { "@type": "ListItem", position: 2, name: "The full list", item: `${SITE}samples/all/` },
  ],
}]).replace(/</g, "\\u003c")}</script>
</head>
<body>

<!-- The keyboard's way in. A sample page puts a link on every line of the
     printed class and the catalogue puts one on every sample, so the bar and
     the header were a long way to tab past to reach either. Same link, same
     wording and same first-stop position as the manual's. -->
<a class="skip" href="#main">Skip to content</a>

${bar("../../")}

<main id="main" tabindex="-1" class="all-groups">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="../">Sample catalogue</a> › the full list</nav>
  <h1>Every abap2UI5 sample</h1>
  <p class="note">
    All ${rows.length} of them, in the order the three repositories keep them, each with a page of
    its own. To search them — by what a sample does, by the control it builds, by the release your
    system runs — use the <a href="../">catalogue</a>; this page is the plain list, for reading
    down and for linking to.
  </p>
  ${sections.join("\n  ")}
</main>

${foot("../../")}
${MENU_SCRIPT}
${MEMORY_SCRIPT}
${SEARCH_SCRIPT("../../")}
</body>
</html>
`;
}

/* ---- THE PAGE FOR AN ADDRESS THAT IS NOT A PAGE ------------------------
 *
 * GitHub Pages answers anything it cannot find under this deployment with the
 * 404.html at the root of the artefact, and this deployment had none. A
 * mistyped sample, a class that was renamed upstream, a link into
 * /playground/ that has gone stale: all of them landed on GitHub's own white
 * page - no bar, no search, no way on. The manual has carried one of these for
 * a while; this is the same page for the other half of the origin.
 *
 * ABSOLUTE URLS, and this is the one page here that needs them. It is served
 * for /playground/samples/<typo>/ and for /playground/<typo> alike, so a
 * relative href resolves against whatever address missed - `../../samples/`
 * from a two-deep miss is right and from a one-deep miss leaves the site. The
 * base is SITE's own path, which is where every canonical link on these pages
 * already says this deployment lives.
 */
function notFoundPage(rows) {
  /* WHAT THE ADDRESS ALMOST SAID. Samples get renamed and dropped upstream,
     and this build removes their pages on the next deploy - every link to one
     of them, in an issue, a blog post or somebody's bookmarks, lands here. A
     page that only says "not here" makes the reader go and search for
     something they had already named.
     The whole list is IN this page: 771 class names and titles, about 40 kB,
     so nothing is fetched to answer and the answer arrives with the page. */
  const near = JSON.stringify(rows.map((row) => [row.dir, row.title])).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found · abap2UI5</title>
<meta name="description" content="This address does not name a page of the abap2UI5 sample catalogue.">
<!-- Served with a 404 status, which is what a crawler goes by - and said here
     as well, for the case where it is not (a preview, a mirror, a proxy that
     rewrites the status). -->
<meta name="robots" content="noindex">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f5f7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e2024">
<link rel="icon" href="${BASE}favicon.png">
<link rel="apple-touch-icon" href="${BASE}apple-touch-icon.png">
<link rel="stylesheet" href="${BASE}samples/catalogue.css">
<link rel="stylesheet" href="${BASE}samples/sample.css">
${THEME_SCRIPT}
</head>
<body>

<!-- The keyboard's way in. A sample page puts a link on every line of the
     printed class and the catalogue puts one on every sample, so the bar and
     the header were a long way to tab past to reach either. Same link, same
     wording and same first-stop position as the manual's. -->
<a class="skip" href="#main">Skip to content</a>

${bar(BASE, "none")}

<main id="main" tabindex="-1" class="sample">
  <div class="sample-body">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="${BASE}samples/">Sample catalogue</a></nav>
  <h1>This page is not here</h1>
  <p class="lede">The address does not name a page of this deployment. A sample may have been
    renamed or dropped by the repository it comes from, or the link that brought you here may
    simply be old.</p>
  <p>The <a href="${BASE}samples/">catalogue</a> searches every sample by what it does, by the
    control it builds and by the release your system runs; <a href="${BASE}samples/all/">the full
    list</a> is all of them on one page; the <a href="${BASE}">playground</a> runs ABAP in this
    browser with no system behind it; and the
    <a href="https://abap2ui5.github.io/docs/get_started/about">documentation</a> is where the
    project explains itself. The box in the bar searches the manual and every sample at once.</p>
  <div id="near" hidden><h2>Did you mean</h2><ul class="nearby"></ul></div>
  </div>
</main>

${foot(BASE)}
<script>
/* WHAT THE ADDRESS ALMOST SAID, ranked here rather than fetched - the list is
   in this page, see the comment where it is built.
   Words first: the last parts of the address, minus the ones nearly every
   sample carries (z2ui5, cl, smp, app), scored against the titles and the
   class names. That is what answers ".../z2ui5_cl_smpc_app_wizard/" with the
   Wizard samples and ".../all.html" with the full list.
   Then, and only for an address shaped like a class, how close the NAME is:
   ".../z2ui5_cl_smp_app_49/" has no word left to go on, and what it wants is
   the classes whose names are one character away.
   (No backticks and no backslashes in here: the whole block is inside a
   template literal, which eats both.) */
(function () {
  var rows = ${near};
  /* The three pages that are always here, searched with the samples: an
     address is as easily wrong about one of these as about a class, and
     /samples/all.html - the full list, at the address it does not have - is a
     guess this repository has itself made. */
  var pages = [
    ["samples/all/", "Every abap2UI5 sample", "the full list, all of them on one page"],
    ["samples/", "abap2UI5 sample catalogue", "search every sample"],
    ["", "abap2UI5 Playground", "write ABAP and run it in this browser"]
  ];
  var base = ${JSON.stringify(BASE)};
  var here = decodeURIComponent(location.pathname);
  var parts = here.slice(here.indexOf(base) === 0 ? base.length : 0)
    .toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
  if (!parts.length) return;

  /* A WORD NEARLY EVERY SAMPLE CARRIES SAYS NOTHING. Counted rather than
     listed: the class prefixes are the three repositories business and change
     without this file hearing about it. */
  var words = parts.filter(function (w) {
    if (w === "samples" || w === "playground" || w === "html" || w === "index") return false;
    var seen = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i][0].indexOf(w) >= 0) seen++;
    return seen * 4 < rows.length;
  });

  /* A WORD, NOT A RUN OF LETTERS. "here" is inside "Where" and inside "There",
     and an address that says nothing at all - /playground/nothing-like-this/ -
     matched a dozen titles that way; the reader is then given a list instead of
     an honest "no idea". A title word that BEGINS with the word is the match,
     which still catches the plural and the possessive. */
  function starts(text, word) {
    var w = text.toLowerCase().split(/[^a-z0-9]+/);
    for (var i = 0; i < w.length; i++) if (w[i].indexOf(word) === 0) return true;
    return false;
  }

  var scored = [];
  var byWord = false;
  if (words.length) {
    for (var k = 0; k < pages.length; k++) {
      var page = pages[k];
      var pageHit = 0;
      for (var w1 = 0; w1 < words.length; w1++) {
        var word = words[w1];
        /* The address and the name, never the sentence beside it: that one is
           ordinary prose, and "this" or "here" in an address would match it. */
        if (page[0].indexOf(word) >= 0 || starts(page[1], word)) pageHit += 4;
      }
      if (pageHit) scored.push([pageHit + 1, page[0], page[1], page[2]]);
    }
    for (var m = 0; m < rows.length; m++) {
      var hit = 0;
      byWord = true;
      for (var w2 = 0; w2 < words.length; w2++) {
        if (starts(rows[m][1], words[w2])) hit += 3;
        else if (rows[m][0].indexOf(words[w2]) >= 0) hit += 1;
      }
      if (hit) scored.push([hit, "samples/" + rows[m][0] + "/", rows[m][1], rows[m][0].toUpperCase()]);
    }
  }

  /* HOW CLOSE TWO CLASS NAMES ARE, for an address that named one and left no
     word behind. They all begin z2ui5_cl_, so what tells them apart is the
     tail: what still agrees at the front, plus what agrees at the back, less
     what is left over in between. The whole segment, not the words above: it
     is the name that is nearly right, and splitting it on its underscores is
     what threw the part that was wrong away. */
  var segs = here.split("/").filter(Boolean);
  var last = (segs.length ? segs[segs.length - 1] : "").toLowerCase().split(".")[0];
  if (!scored.length && last.indexOf("z2ui5") === 0) {
    for (var n = 0; n < rows.length; n++) {
      var name = rows[n][0];
      var pre = 0;
      while (pre < last.length && pre < name.length && last.charAt(pre) === name.charAt(pre)) pre++;
      var suf = 0;
      while (suf < last.length - pre && suf < name.length - pre
             && last.charAt(last.length - 1 - suf) === name.charAt(name.length - 1 - suf)) suf++;
      if (pre > 8) {
        scored.push([pre + suf - Math.abs(last.length - name.length),
                     "samples/" + name + "/", rows[n][1], name.toUpperCase()]);
      }
    }
  }
  if (!scored.length) return;

  scored.sort(function (a, b) { return b[0] - a[0]; });
  var box = document.getElementById("near");
  var list = box.querySelector("ul");
  var best = scored[0][0];
  /* Only what is genuinely close. One good answer beats eight, and a list of
     eight unrelated samples is the same white page with more words on it. Half
     the best score where the score counts words matched, and one character
     where it measures how near a name is - on names that differ in their last
     digit, everything within two is the whole rest of the repository. */
  var cutoff = byWord ? best / 2 : best - 1;
  var shown = 0;
  for (var r = 0; r < scored.length && shown < 8; r++) {
    if (scored[r][0] < cutoff) break;
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.href = base + scored[r][1];
    a.textContent = scored[r][2];
    var who = document.createElement("span");
    who.textContent = " - " + scored[r][3];
    li.appendChild(a);
    li.appendChild(who);
    list.appendChild(li);
    shown++;
  }
  if (shown) box.hidden = false;
})();
</script>
${MENU_SCRIPT}
${MEMORY_SCRIPT}
${SEARCH_SCRIPT(BASE)}
</body>
</html>
`;
}

/**
 * Writes the pages and the sitemap. Everything comes from the index this build
 * just produced, so the pages are exactly as current as it is.
 */
export async function writeSamplePages(index, distDir) {
  const samplesDir = path.join(distDir, "samples");
  fs.mkdirSync(samplesDir, { recursive: true });

  /* Every directory under dist/samples belongs to this step: a sample that was
   * renamed or dropped upstream has to stop being a page here, and a stale one
   * is indistinguishable from a live one once it is deployed. */
  for (const name of fs.readdirSync(samplesDir)) {
    const full = path.join(samplesDir, name);
    if (fs.statSync(full).isDirectory()) fs.rmSync(full, { recursive: true, force: true });
  }

  const names = index.controls || [];
  const sources = new Map((index.sources || []).map((s) => [s.id, s]));
  const stages = new Map((index.stages || []).map((s) => [`${s.source}:${s.id}`, s.title]));
  const floor = index.minUi5 || "1.71";

  const rows = [];
  const taken = new Set();
  let skipped = 0;
  for (const entry of index.entries || []) {
    const dir = dirOf(entry.class);
    if (dir === undefined || taken.has(dir) || safe(entry.raw) === undefined) {
      skipped += 1;
      continue;
    }
    taken.add(dir);
    /* Stamped on the index entry itself, so the catalogue page and the samples
     * dialog can link to a page without knowing which entries got one. The
     * index is written after this runs (tools/build-catalogue.mjs). */
    entry.page = `${dir}/`;
    rows.push({
      ...entry,
      dir,
      class: String(entry.class),
      title: String(entry.title || entry.class),
      note: String(entry.note || ""),
      summary: String(entry.summary || entry.note || ""),
      group: String(entry.group || ""),
      minUi5: String(entry.minUi5 || floor),
      stageTitle: stages.get(`${entry.source}:${entry.stage}`),
      controlNames: (entry.controls || []).map((i) => names[i]).filter(Boolean),
      libraries: (entry.libraries || []).filter((l) => typeof l === "string"),
    });
  }

  /* The ABAP of every page, in a dozen requests rather than one per class -
   * and the one part of these pages that is allowed not to arrive. */
  const code = await fetchSampleSources(rows);
  for (const row of rows) row.code = code.get(row.raw);

  const byGroup = new Map();
  for (const row of rows) {
    const key = `${row.source}:${row.group}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(row);
  }
  /* Which titles are not their own. Counted over the whole set, because that
   * is the only place the answer exists - see samplePage( ) above. */
  const plainTitle = (row) => {
    const t = String(row.title || row.class);
    return row.entity ? `${t} · ${row.entity} in abap2UI5` : `${t} · abap2UI5 sample`;
  };
  const howMany = new Map();
  for (const row of rows) howMany.set(plainTitle(row), (howMany.get(plainTitle(row)) || 0) + 1);
  const ctx = { sources, byGroup, floor, needsNote: (row) => howMany.get(plainTitle(row)) > 1 };

  fs.writeFileSync(path.join(samplesDir, "sample.css"), CSS);
  for (const row of rows) {
    const dir = path.join(samplesDir, row.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), samplePage(row, ctx));
  }
  fs.mkdirSync(path.join(samplesDir, "all"), { recursive: true });
  fs.writeFileSync(path.join(samplesDir, "all", "index.html"), allPage(rows, ctx));

  /* The page for an address that is not a page - at the root of the artefact,
   * which is where GitHub Pages looks for it. */
  fs.writeFileSync(path.join(distDir, "404.html"), notFoundPage(rows));

  /* The sitemap: the two pages that are always here, the full list, and one
   * line per sample. Absolute URLs, because that is what a sitemap is.
   *
   * AND NO `lastmod`, which this used to stamp with the day of the build on
   * all 774 lines. That is not when those pages changed, it is when they were
   * rebuilt - which is every deploy, for every page, whatever moved. A crawler
   * told that 774 pages changed today, again tomorrow, is being told nothing,
   * and Google's own guidance is that it stops believing the field rather than
   * the claim; a sitemap that says only "these pages exist" is worth more than
   * one that says it with a date nobody can trust.
   *
   * Nor can this build honestly say more. The manual takes each page's date
   * from the commit that last touched its markdown, because the markdown is in
   * that repository; these pages are generated from catalogues fetched from
   * three OTHER repositories over the network, and neither the fetch nor this
   * checkout carries the history that would say when a given sample last
   * changed. `lastmod` is optional in the sitemap protocol for exactly this
   * case. */
  const urls = [
    SITE,
    `${SITE}samples/`,
    `${SITE}samples/all/`,
    ...rows.map((row) => `${SITE}samples/${row.dir}/`),
  ];
  fs.writeFileSync(
    path.join(distDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map((url) => `<url><loc>${esc(url)}</loc></url>`).join("\n")
    + "\n</urlset>\n",
  );

  /* AND THE SAME CATALOGUE, ADDRESSED TO A MACHINE. An assistant asked to
   * write abap2UI5 wants two things from this deployment: whether somebody has
   * already built the thing, and the class that proves it. Both are here - 771
   * apps, each with a page, the ABAP in full and the words to search it by -
   * and until now the only way in was to read a 744 kB JSON nobody had been
   * told about. `llms.txt` is the convention for saying it in one short file;
   * the documentation publishes one for its prose and points here, and this
   * one points back. Kept to what a machine cannot guess: the shape of the
   * index, the addresses that are stable, and the three repositories behind
   * them. */
  const bySource = (id) => rows.filter((row) => row.source === id).length;
  fs.writeFileSync(path.join(samplesDir, "llms.txt"), `# abap2UI5 sample catalogue

> Every abap2UI5 sample in one place: ${rows.length} complete ABAP classes from three
> repositories, each with its own page, the class printed in full, and - where
> it needs no SAP system - a button that runs it in this browser. Use it to
> answer "has somebody already built this?" with a class to read rather than a
> snippet to trust.

## Read it as data

- [apps.json](${SITE}samples/apps.json): the whole index, one object per sample
  under \`entries\`: \`class\`, \`title\`, \`summary\`, \`source\` (which repository),
  \`group\`, \`stage\`, \`keywords\`, the \`controls\` it builds, the \`libraries\` it
  needs, the oldest UI5 \`release\` it runs on, whether it \`runs\` in the browser,
  and \`page\` - the directory of its own page here. The top level also lists
  every \`control\` (${(index.controls || []).length}), \`library\` (${(index.libraries || []).length}) and \`release\` in use.
- [the full list](${SITE}samples/all/): the same ${rows.length} as one HTML page, grouped,
  for reading down or linking into.
- a sample's own page is \`${SITE}samples/<class>/\` - the class in full, what it
  builds, what it needs, and the link to the source on GitHub.
- [sitemap.xml](${SITE}sitemap.xml): every page of this deployment.

## Where the samples come from

${(index.sources || []).map((s) => `- [${s.title}](https://github.com/${s.repo}) - ${s.blurb} ${bySource(s.id)} samples; \`SAMPLES.md\` in that repository is the same list in markdown.`).join("\n")}

## What to know before writing ABAP

- An app is ONE class implementing \`z2ui5_if_app\`. Everything enters \`main\`,
  which dispatches on \`client->check_on_navigated( )\`, \`client->check_on_event( )\`
  and \`client->check_on_init( )\`.
- Build the view with \`z2ui5_cl_ui5_view_builder\`; bind with \`client->_bind( )\`,
  which is bidirectional; every roundtrip is a fresh ABAP session and only the
  app class survives it, serialized.
- The prose that explains all of it, written for a machine to page through:
  [the documentation's llms.txt](https://abap2ui5.github.io/docs/llms.txt), and
  [llms-full.txt](https://abap2ui5.github.io/docs/llms-full.txt) for the whole
  manual in one fetch.
- The framework's own code map:
  [github.com/abap2UI5/abap2UI5/llms.txt](https://github.com/abap2UI5/abap2UI5/blob/main/llms.txt).
`);

  const bytes = rows.reduce(
    (sum, row) => sum + fs.statSync(path.join(samplesDir, row.dir, "index.html")).size,
    0,
  );
  log(
    `${rows.length} sample pages -> dist/samples/<class>/ (${Math.round(bytes / 1024)} KB), `
    + `the full list at samples/all/, llms.txt, sitemap.xml with ${urls.length} URLs`
    + `${skipped > 0 ? ` - ${skipped} entries skipped, no usable class name or source URL` : ""}`,
  );
}
