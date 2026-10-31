// The frame every page tools/sample-pages.mjs writes shares - the sample
// pages, the full list and the 404: where the site is published, the bar with
// its marks and menu, the footer, and the scripts each page carries.
//
// A module of its own because two writers use it: sample-pages.mjs and
// not-found-page.mjs, the 404, which is a page of this set in every respect
// but the address it is served at. Kept apart from both, neither has to
// import the other.
import { THEME_BOOT, THEME_MENU, inlineScript } from "../src/shell/theme-boot.mjs";

/* Where the site is published. Only these pages need to know: a canonical
 * link and a sitemap are absolute by definition, and everything else on this
 * site is relative so it can be served under any path (tests/subpath.spec.js).
 * PG_SITE_URL overrides it for a fork published somewhere else. */
export const SITE = (process.env.PG_SITE_URL || "https://abap2ui5.github.io/playground/").replace(/\/*$/, "/");

/* Where this deployment sits on its origin - "/playground/". Only the 404
 * needs it: every other page here is reached at a known depth and links
 * relatively, which is what lets the whole site be served from anywhere. */
export const BASE = new URL(SITE).pathname;

/* The stored theme before the first paint, and the bar's menu with the switch
 * inside it, wired - the same text the catalogue and the playground carry,
 * written once in src/shell/theme-boot.mjs, which says why it is inline.
 * These pages carry no bundle, which is most of what makes them what they
 * are, so the menu's script is inline here too, at the end of the body. */
export const THEME_SCRIPT = inlineScript(THEME_BOOT);
export const MENU_SCRIPT = inlineScript(THEME_MENU);


/* The two marks the playground's own bar ends in (src/shell/index.html) and,
 * after them, the button and the menu the catalogue's bar ends in
 * (src/catalogue/index.html) - the same markup, kept in step by hand. Inline
 * SVG for the reason it is inline there: an icon that is an empty square until a stylesheet
 * arrives is worse than one that never needed it. The three documents keep
 * one copy each, by hand - a shared partial would be a build step in front of
 * a page whose whole point is that it is a file. */
export const SOCIALS = `<div class="socials">
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
        <button id="theme" class="theme" type="button" role="switch" aria-checked="false" aria-label="Dark theme">
          <span class="when-light"><span class="glyph" aria-hidden="true">☾</span>Switch to dark</span>
          <span class="when-dark"><span class="glyph" aria-hidden="true">☀</span>Switch to light</span>
        </button>
        <a href="https://github.com/abap2UI5/abap2UI5/issues" target="_blank" rel="noopener">Issues</a>
        <a href="https://abap2ui5.github.io/docs/resources/changelog">Release notes</a>
        <a href="https://abap2ui5.github.io/docs/get_started/quickstart">Install with abapGit</a>
        <a href="https://abap2ui5.github.io/docs/resources/support">Support</a>
        <a href="https://abap2ui5.github.io/docs/resources/contribution">Contribute</a>
        <a href="https://abap2ui5.github.io/docs/resources/sponsor">Sponsor</a>
        <a href="https://abap2ui5.github.io/why/">For managers</a>
        <span class="menu-head">Tools</span>
        <a href="https://abap2ui5.github.io/playground/ai/" data-site="ai">AI Studio</a>
        <a href="https://abap2ui5.github.io/layout-editor/">Layout Editor</a>
        <a href="https://abap2ui5-addons.github.io/abap-cloud-gui/">Report converter</a>
        <a href="https://abap2ui5.github.io/linter/">Linter rules</a>
        <!-- Everything to install beside the framework, and the tools for
             the editor, the pipeline and the agent, each with a page: a site
             of its own. Not listed here a second time. -->
        <a href="https://abap2ui5-addons.github.io/">Addons &amp; Tools</a>
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
export const SEARCH_SCRIPT = (up) => `<script type="module" src="${up}samples/search.mjs"></script>`;

/* `current` is which of the four the page IS: the catalogue and the sample
 * pages are Samples, and the 404 (not-found-page.mjs) is none of them - a
 * page that is not there must not tell a screen reader it is the samples
 * page. */
export const bar = (up) => `<header class="bar">
  <a class="brand" href="https://abap2ui5.github.io/" target="_self">
    <img src="${up}favicon.png" alt="" width="20" height="20">
    <span>abap2UI5</span>
  </a>
  <nav class="bar-nav" aria-label="abap2UI5 sites">
    <a href="https://abap2ui5.github.io/why/" title="abap2UI5 for the person who approves it"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.4" y="7.6" width="17.2" height="11.6" rx="1.8"/><path d="M9 7.6V6a1.4 1.4 0 0 1 1.4-1.4h3.2A1.4 1.4 0 0 1 15 6v1.6M3.4 12.4h17.2"/></svg><span data-text="For managers" data-short="Why">For managers</span></a>
    <a href="https://abap2ui5.github.io/docs/" title="The manual"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 7.2C10.5 5.9 8.5 5.2 6 5.2H3.3v11.9H6c2.5 0 4.5.7 6 1.9 1.5-1.2 3.5-1.9 6-1.9h2.7V5.2H18c-2.5 0-4.5.7-6 1.9z"/><path d="M12 7.2v11.8"/></svg><span data-text="Docs" data-short="Docs">Docs</span></a>
    <a href="https://abap2ui5.github.io/samples-site/" title="Every abap2UI5 sample, searchable"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.2" y="4.8" width="17.6" height="14.4" rx="2"/><path d="M3.2 9.4h17.6M8.5 9.4v9.8"/></svg><span data-text="Samples" data-short="Samples">Samples</span></a>
    <a href="${up}" data-site="playground" title="Write ABAP and run it in the browser"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><path d="M10.2 8.4v7.2a.5.5 0 0 0 .76.43l5.8-3.6a.5.5 0 0 0 0-.86l-5.8-3.6a.5.5 0 0 0-.76.43z" fill="currentColor" stroke="none"/></svg><span data-text="Playground" data-short="Play">Playground</span></a>
    <a href="https://abap2ui5-addons.github.io/" title="Addons for your system, tools for your editor and pipeline"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.6" y="3.6" width="7" height="7" rx="1.3"/><rect x="13.4" y="3.6" width="7" height="7" rx="1.3"/><rect x="3.6" y="13.4" width="7" height="7" rx="1.3"/><rect x="13.4" y="13.4" width="7" height="7" rx="1.3"/></svg><span data-text="Addons &amp; Tools" data-short="Addons">Addons &amp; Tools</span></a>
  </nav>
  <span class="search-slot" data-search></span>
  ${SOCIALS}
</header>`;

export const foot = (up) => `<footer class="foot">
  <p>
    One page per sample, built from the catalogs the three repositories commit —
    <a href="https://github.com/abap2UI5/samples">abap2UI5/samples</a>,
    <a href="https://github.com/abap2UI5/samples-controls">samples-controls</a>,
    <a href="https://github.com/abap2UI5/samples-stack">samples-stack</a> —
    and rebuilt on every deploy of the
    <a href="https://github.com/abap2UI5/playground">playground</a>.
    <a href="${up}samples/">Search all of them</a>.
  </p>
</footer>`;
