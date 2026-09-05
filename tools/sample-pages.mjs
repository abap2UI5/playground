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
import { highlightAbap } from "./abap-highlight.mjs";
import { fetchSampleSources } from "./sample-sources.mjs";

/* Where the site is published. Only these pages need to know: a canonical
 * link and a sitemap are absolute by definition, and everything else on this
 * site is relative so it can be served under any path (tests/subpath.spec.js).
 * PG_SITE_URL overrides it for a fork published somewhere else. */
export const SITE = (process.env.PG_SITE_URL || "https://abap2ui5.github.io/playground/").replace(/\/*$/, "/");

const log = (m) => console.log(`build-catalogue: ${m}`);

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
             is still inside the path the link already points at - which is what
             leaves "//elsewhere/x", "/docs/../x" and "javascript:…" alone. */
          var base = new URL(written.get(a), location.href);
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
    addEventListener("pageshow", lift);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") lift();
    });
    document.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a[data-site]")) lift();
    }, true);
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
 * screen reader announces, and the brand links to the catalogue rather than to
 * the playground, which is one nav item away. The right-hand end reads: a
 * hairline, Documentation, Samples, Playground, a hairline, LinkedIn, GitHub,
 * then the button that opens the menu (SOCIALS above, wired by MENU_SCRIPT). */
const bar = (up) => `<header class="bar">
  <a class="brand" href="${up}samples/">
    <img src="${up}favicon.png" alt="" width="20" height="20">
    <span>abap2UI5</span>
  </a>
  <nav class="bar-nav">
    <a href="https://abap2ui5.github.io/docs/" data-site="docs">Documentation</a>
    <a href="${up}samples/" aria-current="page">Samples</a>
    <a href="${up}" title="Write ABAP and run it in the browser">Playground</a>
  </nav>
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
main { padding-bottom: 40px; }
.crumbs { margin: 22px 0 6px; font-size: 12px; color: var(--fg-dim); }
.crumbs a { color: var(--fg-dim); }
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
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 0; max-width: 74ch; font-size: 13px; }
.facts dt { color: var(--fg-dim); }
.facts dd { margin: 0; }
.facts code { font-family: var(--font-mono); font-size: 12px; }
.chips { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; }
.chips li { margin: 0; }
.chips a, .chips span {
  display: inline-block; font-family: var(--font-mono); font-size: 12px;
  border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; text-decoration: none;
}
.chips a:hover { border-color: var(--accent); }
/* The demo. Same card as the class below it - one shape for the sample
 * running and the sample written, because they are the same sample - and the
 * button inside it is the loader's own (src/embed/abap2ui5-embed.js), which
 * ships no stylesheet: an embedding page dresses it, and this one dresses it
 * as the catalogue. Unpressed it is a band and not the frame's full 420
 * pixels: a demo nobody asked for should cost the page one line of its
 * scroll, not a screen of empty box on the way past. */
.demo { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin: 0; background: var(--bg); }
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
  margin: 0; padding: 12px 14px; overflow-x: auto;
  font-family: var(--font-mono); font-size: 12.5px; line-height: 1.55; tab-size: 2;
}
.source-body code { font: inherit; }
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
  .facts { grid-template-columns: 1fr; gap: 2px 0; }
  .facts dd { margin-bottom: 8px; }
}
`;

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

/** One sample's page. */
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
  const pageTitle = row.entity
    ? `${title} · ${row.entity} in abap2UI5`
    : `${title} · abap2UI5 sample`;

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
    <div class="abap2ui5-demo" data-src="${esc(row.raw)}" data-view="app" data-height="420"
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

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: title,
    description: lede || title,
    programmingLanguage: "ABAP",
    codeRepository: github,
    url: canonical,
    keywords: [...(row.keywords || []), ...controls].join(", ") || undefined,
    isPartOf: { "@type": "WebSite", name: "abap2UI5 sample catalogue", url: `${SITE}samples/` },
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<link rel="icon" href="../../favicon.png">
<link rel="apple-touch-icon" href="../../apple-touch-icon.png">
<link rel="stylesheet" href="../catalogue.css">
<link rel="stylesheet" href="../sample.css">
${THEME_SCRIPT}
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>

${bar("../../")}

<main class="sample">
  <p class="crumbs">
    <a href="../">Sample catalogue</a>${source ? ` › <a href="../?src=${esc(row.source)}">${esc(source.title)}</a>` : ""}${row.group ? ` › ${esc(row.group)}` : ""}
  </p>
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
      ${github ? `<a href="${esc(github)}" target="_blank" rel="noopener">Read it on GitHub ↗</a>` : ""}
    </div>
    <pre class="source-body"><code>${highlightAbap(code.text)}</code></pre>
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

  <p class="note"><a href="../">Search every abap2UI5 sample</a> · <a href="../all/">the full list on one page</a></p>
</main>

${foot("../../")}
${MENU_SCRIPT}
${MEMORY_SCRIPT}
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
<link rel="icon" href="../../favicon.png">
<link rel="stylesheet" href="../catalogue.css">
<link rel="stylesheet" href="../sample.css">
${THEME_SCRIPT}
</head>
<body>

${bar("../../")}

<main class="all-groups">
  <p class="crumbs"><a href="../">Sample catalogue</a> › the full list</p>
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
  const ctx = { sources, byGroup, floor };

  fs.writeFileSync(path.join(samplesDir, "sample.css"), CSS);
  for (const row of rows) {
    const dir = path.join(samplesDir, row.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), samplePage(row, ctx));
  }
  fs.mkdirSync(path.join(samplesDir, "all"), { recursive: true });
  fs.writeFileSync(path.join(samplesDir, "all", "index.html"), allPage(rows, ctx));

  /* The sitemap: the two pages that are always here, the full list, and one
   * line per sample. Absolute URLs, because that is what a sitemap is. */
  const day = new Date().toISOString().slice(0, 10);
  const urls = [
    SITE,
    `${SITE}samples/`,
    `${SITE}samples/all/`,
    ...rows.map((row) => `${SITE}samples/${row.dir}/`),
  ];
  fs.writeFileSync(
    path.join(distDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map((url) => `<url><loc>${esc(url)}</loc><lastmod>${day}</lastmod></url>`).join("\n")
    + "\n</urlset>\n",
  );

  const bytes = rows.reduce(
    (sum, row) => sum + fs.statSync(path.join(samplesDir, row.dir, "index.html")).size,
    0,
  );
  log(
    `${rows.length} sample pages -> dist/samples/<class>/ (${Math.round(bytes / 1024)} KB), `
    + `the full list at samples/all/, sitemap.xml with ${urls.length} URLs`
    + `${skipped > 0 ? ` - ${skipped} entries skipped, no usable class name or source URL` : ""}`,
  );
}
