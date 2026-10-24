// dist/evaluate/ - the page for the person who approves abap2UI5, written by
// tools/sample-pages.mjs beside the sample pages and the 404.
//
// It lived in the manual, at /docs/evaluate, drawn like the front door. A
// developer sends this link to the person who decides, and an address under
// /docs/ says "manual" before they have read a word - so the page is not a
// chapter any more, it is a page of its own beside the catalogue and the AI
// Studio, and /docs/evaluate redirects here (abap2UI5/docs keeps the stub).
//
// The prose is src/evaluate/evaluate.html, a fragment of eight sections
// written by hand; this module puts the frame around it - the bar with no
// section marked, the hero, the counted figures, the four tiles, the footer -
// the way not-found-page.mjs does for the 404. Its links into the manual are
// absolute, because the manual is another deployment on this origin.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, MENU_SCRIPT, PAGE_SCRIPT, SITE, THEME_SCRIPT, bar } from "./sample-frame.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src", "evaluate");
const DOCS = "https://abap2ui5.github.io/docs/";

/* The files the page is made of, for build-catalogue.mjs's stamp: a change to
 * any of them is a change to the page. */
export const EVALUATE_SOURCES = ["evaluate.html", "evaluate.css", "walkthrough-preview.webp"]
  .map((f) => path.join(SRC, f));

/* ---- THE COUNTED FIGURES -------------------------------------------------
 *
 * Unit tests, specs, browser suites, gates: what a reader who is deciding
 * wants to know about the size of the thing, and a number nobody here types.
 * The framework's README carries them between `facts:start` and `facts:end`,
 * regenerated over there by `npm run facts` and held current by a gate; the
 * framework this build pins is in deps/abap2ui5, so the figures are the ones
 * of the release the playground runs. The manual read the same block the same
 * way (its scripts/lib/facts.mjs). A README without the block costs the line,
 * never the build. Left out: the workflow count (a maintainer's figure), the
 * release span (the tagline says it) and the trailing "counted from …". */
const SKIP = /workflows|→|counted/;
export function factsIn(readme) {
  const block = String(readme).match(/<!-- facts:start -->([\s\S]*?)<!-- facts:end -->/);
  if (!block) return [];
  const text = block[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.split(/\s·\s/).map((s) => s.trim()).filter((s) => s && !SKIP.test(s));
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* The four ways to start, in order of effort - so the last section does not
 * list them a second time. Same marks as the manual's tiles. */
const TILES = [
  {
    title: "Ten minutes, nothing installed",
    details: "Open the playground and change a running app, or browse the sample catalog for the screen closest to yours.",
    link: `${BASE}samples/`,
    icon: `<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10.2 8.4v7.2a.5.5 0 0 0 .76.43l5.8-3.6a.5.5 0 0 0 0-.86l-5.8-3.6a.5.5 0 0 0-.76.43z" fill="currentColor"/>`,
  },
  {
    title: "One afternoon, one developer",
    details: "Send them the Quickstart — abapGit pull, ICF node, first app. The tutorial takes the same app to transport and unit tests.",
    link: `${DOCS}get_started/quickstart`,
    icon: `<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" d="M8 7.5 3.5 12 8 16.5M16 7.5l4.5 4.5-4.5 4.5M13.6 4.8 10.4 19.2"/>`,
  },
  {
    title: "One question",
    details: "Ask it in the Slack channel or as a GitHub issue, where the people who run it in production answer.",
    link: "https://abapgit.slack.com/join/shared_invite/zt-46tqufaht-QlrxTzlDqlx85CWbeUnOqg#/shared-invite/email",
    icon: `<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" d="M4 5.5h16v10H9l-4.5 3.5z"/>`,
  },
  {
    title: "A partner",
    details: "The companies on Who Uses abap2UI5? offer implementation, workshops and support agreements.",
    link: `${DOCS}resources/who_uses`,
    icon: `<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" d="M3.5 19.5V9l5.5 3.5V9l5.5 3.5V9l6 3.5v7zM3.5 19.5h17M6 4.5h3v7.5"/>`,
  },
];

const tile = (t) => `
    <a class="tile" href="${esc(t.link)}">
      <span class="tile-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg></span>
      <span class="tile-title">${esc(t.title)}</span>
      <span class="tile-details">${esc(t.details)}</span>
    </a>`;

const DESCRIPTION = "abap2UI5 for the people who approve a tool rather than build with it - what problem it answers, when it is the right choice and when RAP is, what your organization keeps, where it runs, what it costs, the objections a review board raises, and how to test it on one real screen in a week.";

export function evaluatePage({ facts = [] } = {}) {
  const body = fs.readFileSync(path.join(SRC, "evaluate.html"), "utf8");
  const factsLine = facts.length ? `<p class="facts-line">${facts.map(esc).join(" · ")}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evaluate abap2UI5 · for the people who approve it</title>
<meta name="description" content="${esc(DESCRIPTION)}">
<link rel="canonical" href="${SITE}evaluate/">
<meta property="og:title" content="Evaluate abap2UI5">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:url" content="${SITE}evaluate/">
<meta property="og:image" content="${SITE}evaluate/walkthrough-preview.webp">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f5f7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e2024">
<link rel="icon" href="${BASE}favicon.png">
<link rel="apple-touch-icon" href="${BASE}apple-touch-icon.png">
<link rel="preload" href="${BASE}fonts/inter-roman-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${BASE}samples/catalogue.css">
<link rel="stylesheet" href="${BASE}evaluate/evaluate.css">
${THEME_SCRIPT}
</head>
<body data-evaluate>

<a class="skip" href="#main">Skip to content</a>

${bar(BASE, "none")}

<main id="main" tabindex="-1" class="evaluate">
  <section class="hero">
    <div class="hero-main">
      <p class="hero-name">For the people who approve it</p>
      <h1 class="hero-text">Evaluate abap2UI5</h1>
      <p class="hero-tagline">For IT management, architecture boards, product owners, SAP Basis and internal audit: the questions a review asks, in the order it asks them, each with the page that carries the detail. A developer who wants to see it run is better served by the <a href="${DOCS}get_started/quickstart">Quickstart</a>; send them there and read on.</p>
      <div class="hero-actions">
        <a class="hero-action primary" href="${BASE}">Try it in the playground</a>
        <a class="hero-action plain" href="${DOCS}get_started/about">Read the technical picture</a>
      </div>
      <p class="hero-note">Nothing to install, no trial license, no sales call — the playground runs in your browser.</p>
    </div>
    <div class="hero-shot"><img src="${BASE}evaluate/walkthrough-preview.webp" alt="An abap2UI5 app: a selection form above a table of invoices, with a dialog editing one row" width="1000" height="598" decoding="async" fetchpriority="high"></div>
  </section>
  ${factsLine}
  <div class="bands">
${body}
  <section class="tiles" aria-label="Where to start">${TILES.map(tile).join("")}
  </section>
  </div>
</main>

<footer class="foot">
  <p>
    Written for the people who approve abap2UI5 and published beside the
    <a href="${BASE}samples/">sample catalog</a> and the
    <a href="${BASE}">playground</a>; the detail behind every section is in the
    <a href="${DOCS}get_started/about">documentation</a>.
    <a href="https://github.com/abap2UI5/playground/blob/main/src/evaluate/evaluate.html">Edit this page on GitHub</a>.
  </p>
</footer>

${PAGE_SCRIPT(BASE)}
${MENU_SCRIPT}
</body>
</html>
`;
}

/** Writes dist/evaluate/: the page, its stylesheet and its screenshot. */
export function writeEvaluatePage(distDir, { readme = null } = {}) {
  const dir = path.join(distDir, "evaluate");
  fs.mkdirSync(dir, { recursive: true });
  let facts = [];
  const readmePath = readme ?? path.join(ROOT, "deps", "abap2ui5", "README.md");
  if (fs.existsSync(readmePath)) facts = factsIn(fs.readFileSync(readmePath, "utf8"));
  if (!facts.length) console.log("build-catalogue: evaluate/ has no counted figures (deps/abap2ui5/README.md has no facts block)");
  fs.copyFileSync(path.join(SRC, "evaluate.css"), path.join(dir, "evaluate.css"));
  fs.copyFileSync(path.join(SRC, "walkthrough-preview.webp"), path.join(dir, "walkthrough-preview.webp"));
  return { html: evaluatePage({ facts }), dir };
}
