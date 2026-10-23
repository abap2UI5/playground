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
//
// Three files, one set of pages: this one lays out the sample pages and the
// full list and writes everything; tools/sample-frame.mjs is what they share
// with the 404 (the site's address, the bar, the footer, the scripts);
// tools/not-found-page.mjs is the 404 itself; and the page-specific styling is
// src/catalogue/sample.css, copied beside catalogue.css as it is.
import fs from "fs";
import { stripHtmlComments, withPolicy } from "./html.mjs";
import path from "path";
import { isSapui5Only } from "../src/shell/ui5-libs.mjs";
import { githubUrlOf, rawUrlOf } from "../src/shell/catalogue-urls.mjs";
import { MARKS, marksOf } from "../src/shell/sample-marks.mjs";
import { highlightAbapLines } from "./abap-highlight.mjs";
import { fetchSampleSources } from "./sample-sources.mjs";
import { MENU_SCRIPT, PAGE_SCRIPT, SEARCH_SCRIPT, SITE, THEME_SCRIPT, bar, foot } from "./sample-frame.mjs";
import { notFoundPage } from "./not-found-page.mjs";
import { writeEvaluatePage } from "./evaluate-page.mjs";

/* Where the site is published - tools/sample-frame.mjs decides it, beside the
 * bar every page here carries; it is re-exported because this is where the
 * build and the tests have always asked for it. */
export { SITE };

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

/* esc( ) read back - for the one place that starts from written HTML. */
const unesc = (value) =>
  String(value ?? "")
    .replace(/&quot;/g, "\"")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

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

// Cut by code point, not by UTF-16 unit: a cut through an emoji left half a
// surrogate pair, which the page's UTF-8 wrote out as U+FFFD before the "…".
const cut = (text, max) => {
  const one = String(text ?? "").replace(/\s+/g, " ").trim();
  const points = [...one];
  return points.length <= max ? one : `${points.slice(0, max - 1).join("").replace(/[\s,;:.-]+$/, "")}…`;
};

/* The page-specific half of the styling. The frame - palette, bar, footer,
 * badges, actions - is the catalogue's own stylesheet, loaded beside this one:
 * these pages are the catalogue's pages and a second palette would drift from
 * it by the first change to either.
 *
 * A stylesheet of its own in the source too, src/catalogue/sample.css beside
 * catalogue.css, copied as it is: it used to be a 300-line template literal in
 * the middle of this file, where no editor coloured it, no CSS tool could read
 * it and a backtick in a comment would have ended it. Nothing in it is
 * computed, so nothing is lost by its being a file. */
const CSS = fs.readFileSync(new URL("../src/catalogue/sample.css", import.meta.url), "utf8");

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
    if (kept.length >= MAX_LINES || chars + line.length > MAX_CHARS) {
      // A first line longer than the whole budget is cut rather than left
      // out, or the page printed "the first 0 lines" and an empty block.
      if (kept.length === 0) kept.push(line.slice(0, MAX_CHARS));
      break;
    }
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
    /* The text a reader sees, with any markup inside the heading dropped and
       the entities read back - `inner` is written HTML, so an `&amp;` in a
       group's name would otherwise be escaped a second time in the outline
       and spelt out in the id. */
    const text = unesc(inner.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
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
  /* The lede is what gets cut, never the tail: cut as one string, a lede of
   * 120 characters took the class name with it on 175 pages, and three pairs
   * of pages ended up with the same description. */
  const tail = `the abap2UI5 sample ${row.class.toUpperCase()}`
    + `${source ? ` from ${source.repo}` : ""}. Read the ABAP or run it in the browser.`;
  const description = lede ? `${cut(lede, Math.max(40, 180 - tail.length - 3))} — ${tail}` : tail;

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
  /* The marker the repository's own title carries, and what it means - the
   * one place on the page the two letters are still printed, beside their
   * legend, because a reader who meets "(A,C)" in SAMPLES.md should be able
   * to find out here what it said. */
  if (row.marks.length) {
    facts.push([
      "Marked",
      `<code>(${esc(row.marks.join(","))})</code> — ${row.marks.map((m) => esc(MARKS[m].title)).join("; ")}`,
    ]);
  }
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
    { name: "Sample catalog", item: `${SITE}samples/` },
    ...(source ? [{ name: source.title, item: `${SITE}samples/?src=${encodeURIComponent(row.source)}` }] : []),
    { name: title, item: canonical },
  ];
  const jsonLd = JSON.stringify([{
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: title,
    description: lede || title,
    programmingLanguage: "ABAP",
    runtimePlatform: "SAP NetWeaver AS ABAP",
    codeSampleType: "full solution",
    codeRepository: github,
    /* The three sample repositories are MIT, like the framework. */
    license: "https://opensource.org/licenses/MIT",
    url: canonical,
    keywords: [...(row.keywords || []), ...controls].join(", ") || undefined,
    about: { "@type": "SoftwareApplication", name: "abap2UI5", url: "https://abap2ui5.github.io/docs/" },
    isPartOf: { "@type": "WebSite", name: "abap2UI5 sample catalog", url: `${SITE}samples/` },
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
    <a href="../">Sample catalog</a>${source ? ` › <a href="../?src=${esc(row.source)}">${esc(source.title)}</a>` : ""}${row.group ? ` › ${esc(row.group)}` : ""}
  </nav>
  <h1>${esc(title)}</h1>
  ${lede ? `<p class="lede">${esc(lede)}</p>` : ""}
  <p class="who">${esc(row.class.toUpperCase())}</p>
  ${
    /* RUN IT HERE, UNDER THE TITLE. The demo box is below the facts, the
       controls and the libraries - on a laptop a screen and a half down, on a
       phone three - and a reader who came to see the sample run had to know
       to scroll for it. This is the way there, where the reader is looking:
       a link to the box's own heading, so it works with the script blocked,
       and with it the box is started as well (setUpRunJump( ) in
       src/catalogue/run-jump.mjs), so one press is one press. Only where the
       box exists - a sample that cannot run here has no box to go to. */
    row.runs ? `<p class="head-run"><a class="run-jump" href="#run-it-here">▶ Run it here</a></p>` : ""
  }

  <div class="badges">
    ${source ? `<span class="badge">${esc(source.title)}</span>` : ""}
    ${row.group ? `<span class="badge">${esc(row.group)}</span>` : ""}
    <span class="badge">UI5 ${esc(row.minUi5)}</span>
    ${row.marks.map((m) => `<span class="badge mark" title="${esc(MARKS[m].title)}">${esc(MARKS[m].label)}</span>`).join("")}
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
<link rel="sitemap" type="application/xml" href="../../sitemap.xml">
${social({ title: pageTitle, description, url: canonical })}
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f5f7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e2024">
<link rel="icon" href="../../favicon.png">
<link rel="apple-touch-icon" href="../../apple-touch-icon.png">
<link rel="preload" href="../../fonts/inter-roman-latin.woff2" as="font" type="font/woff2" crossorigin>
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
${SEARCH_SCRIPT("../../")}
${PAGE_SCRIPT("../../")}
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
<link rel="sitemap" type="application/xml" href="../../sitemap.xml">
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
<link rel="preload" href="../../fonts/inter-roman-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="../catalogue.css">
<link rel="stylesheet" href="../sample.css">
${THEME_SCRIPT}
<script type="application/ld+json">${JSON.stringify([{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Every abap2UI5 sample",
  description: `All ${rows.length} abap2UI5 samples on one page, each one linked to its own page.`,
  url: `${SITE}samples/all/`,
  isPartOf: { "@type": "WebSite", name: "abap2UI5 sample catalog", url: `${SITE}samples/` },
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
    { "@type": "ListItem", position: 1, name: "Sample catalog", item: `${SITE}samples/` },
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
  <nav class="crumbs" aria-label="Breadcrumb"><a href="../">Sample catalog</a> › the full list</nav>
  <h1>Every abap2UI5 sample</h1>
  <p class="note">
    All ${rows.length} of them, in the order the three repositories keep them, each with a page of
    its own. To search them — by what a sample does, by the control it builds, by the release your
    system runs — use the <a href="../">catalog</a>; this page is the plain list, for reading
    down and for linking to.
  </p>
  ${sections.join("\n  ")}
</main>

${foot("../../")}
${MENU_SCRIPT}
${SEARCH_SCRIPT("../../")}
${PAGE_SCRIPT("../../")}
</body>
</html>
`;
}

/**
 * The rows the pages are written from: which entries get a page (stamped on
 * the entry as `page`, see below), with the ABAP of each fetched in. The
 * first half of what used to be one function, split so the build can hash
 * what the pages would be written FROM before writing 804 of them again -
 * tools/build-catalogue.mjs keeps a stamp over the index, these rows' code
 * and the tools that lay the pages out, and skips the write when none of it
 * moved. The index is still built and still stamped on every run, because
 * that is where the answer comes from.
 */
export async function prepareSamplePages(index) {
  const names = index.controls || [];
  const stages = new Map((index.stages || []).map((s) => [`${s.source}:${s.id}`, s.title]));
  const floor = index.minUi5 || "1.71";

  const rows = [];
  const taken = new Set();
  let skipped = 0;
  for (const entry of index.entries || []) {
    const dir = dirOf(entry.class);
    /* The two URLs, from the entry's path and its repository - the index
     * carries the path, not the URLs (src/shell/catalogue-urls.mjs). */
    const raw = rawUrlOf(entry, index.sources);
    const github = githubUrlOf(entry, index.sources);
    if (dir === undefined || taken.has(dir) || safe(raw) === undefined) {
      skipped += 1;
      continue;
    }
    taken.add(dir);
    /* Stamped on the index entry itself, so the catalogue page and the samples
     * dialog can link to a page without knowing which entries got one. The
     * index is written after this runs (tools/build-catalogue.mjs). */
    entry.page = `${dir}/`;
    /* "(A,C)" off the end of a title or a note, and said in words on the
     * page instead (src/shell/sample-marks.mjs): two letters in brackets are
     * a code nothing on this site explains, in a heading, a browser tab and a
     * search result alike. The index keeps the text as it was written. */
    const { texts: [title, note], marks } = marksOf(String(entry.title || entry.class), String(entry.note || ""));
    rows.push({
      ...entry,
      raw,
      github,
      dir,
      class: String(entry.class),
      title,
      note,
      marks,
      summary: String(entry.summary || note),
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
  return { rows, skipped };
}

/**
 * Writes the pages and the sitemap from the rows prepareSamplePages( ) made.
 * Everything comes from the index this build just produced, so the pages are
 * exactly as current as it is.
 */
export function writeSamplePages(index, distDir, { rows, skipped }) {
  const samplesDir = path.join(distDir, "samples");
  fs.mkdirSync(samplesDir, { recursive: true });

  /* Every directory under dist/samples belongs to this step: a sample that was
   * renamed or dropped upstream has to stop being a page here, and a stale one
   * is indistinguishable from a live one once it is deployed. */
  for (const name of fs.readdirSync(samplesDir)) {
    const full = path.join(samplesDir, name);
    if (fs.statSync(full).isDirectory()) fs.rmSync(full, { recursive: true, force: true });
  }

  const sources = new Map((index.sources || []).map((s) => [s.id, s]));
  const floor = index.minUi5 || "1.71";

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
    fs.writeFileSync(path.join(dir, "index.html"), withPolicy(stripHtmlComments(samplePage(row, ctx))));
  }
  fs.mkdirSync(path.join(samplesDir, "all"), { recursive: true });
  fs.writeFileSync(path.join(samplesDir, "all", "index.html"), withPolicy(stripHtmlComments(allPage(rows, ctx))));

  /* The page for an address that is not a page - at the root of the artefact,
   * which is where GitHub Pages looks for it. */
  fs.writeFileSync(path.join(distDir, "404.html"), withPolicy(stripHtmlComments(notFoundPage(rows))));

  /* The page for the person who approves abap2UI5 (tools/evaluate-page.mjs):
   * not a sample page, but drawn in the same frame and written at the same
   * moment, so it is a page of this set like the 404. */
  const evaluate = writeEvaluatePage(distDir);
  fs.writeFileSync(path.join(evaluate.dir, "index.html"), withPolicy(stripHtmlComments(evaluate.html)));

  /* The sitemap: the three pages that are always here, the full list, and one
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
    `${SITE}ai/`,
    `${SITE}evaluate/`,
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

  /* THE PLAYGROUND'S OWN MAP, for a machine: samples/llms.txt describes the
   * samples as data, the documentation's describes the prose, and nothing
   * described the one thing a model is most likely to be asked to do with
   * this site - open a class in it by URL, or put a running example on a
   * page. The contract is the one main.mjs, share.mjs and the embed kit
   * implement; a change there is a change here. */
  fs.writeFileSync(path.join(distDir, "llms.txt"), `# abap2UI5 Playground

> Write abap2UI5 apps in the browser: ABAP on the left, the running app on
> the right, no server involved. The whole framework, compiled to
> JavaScript, runs inside the page - a class pasted here runs the way it
> runs on an SAP system, with the UI5 the real system would render it with.

The playground is at ${SITE}. It needs a browser with WebAssembly and
ES2022 modules; nothing is installed and nothing leaves the browser.

## Opening a class by URL

- \`${SITE}?src=<raw URL of a .clas.abap file>\` fetches the class and runs
  it. \`src\` may repeat: the first one is the app, the others are classes it
  needs. A GitHub raw URL is the usual shape, and every sample page below
  carries one.
- \`?view=app\` shows the running app and nothing else - no editor, no bar;
  \`?view=full\` is the same, full screen. \`?embed=1\` is the frame the embed
  kit opens.
- A link made with the Share button carries the source itself, in the URL
  fragment: one version character, \`2\`, then base64url of the files as a
  JSON array, deflate-raw compressed. Nothing of it reaches a server.

## Putting a running example on a page of your own

\`${SITE}embed/abap2ui5-embed.js\` turns an empty element into a running app:

    <div class="abap2ui5-demo" data-src="https://raw.githubusercontent.com/.../z2ui5_cl_demo.clas.abap"></div>
    <script src="${SITE}embed/abap2ui5-embed.js"></script>

\`data-src\` takes one URL or several (the first is the app), \`data-code\`
carries ABAP that lives only in that page, \`data-view="app"\` hides the
editor, \`data-height\` sets the starting height and \`data-label\` the button
text. A page that swaps content without reloading calls
\`window.abap2ui5Embed.setUp()\` after each navigation.

## The samples

- [samples/](${SITE}samples/): every abap2UI5 sample, searchable by control,
  by library and by the UI5 release a system runs; one page per sample at
  \`samples/<class>/\` with the class in full, and \`samples/all/\` as one list
- [samples/llms.txt](${SITE}samples/llms.txt): the samples as data - what
  \`samples/apps.json\` holds for each of them
- [sitemap.xml](${SITE}sitemap.xml): every page of this deployment

## Elsewhere

- [the documentation](https://abap2ui5.github.io/docs/llms.txt), and
  [llms-full.txt](https://abap2ui5.github.io/docs/llms-full.txt) for all of it
  in one document
- [the framework's code map](https://github.com/abap2UI5/abap2UI5/blob/main/llms.txt)
`);

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
  fs.writeFileSync(path.join(samplesDir, "llms.txt"), `# abap2UI5 sample catalog

> Every abap2UI5 sample in one place: ${rows.length} complete ABAP classes from three
> repositories, each with its own page, the class printed in full, and - where
> it needs no SAP system - a button that runs it in this browser. Use it to
> answer "has somebody already built this?" with a class to read rather than a
> snippet to trust.

## Read it as data

- [apps.json](${SITE}samples/apps.json): the whole index, one object per sample
  under \`entries\`: \`class\`, \`title\`, \`note\` (its one line; a title or note
  ending in \`(A)\` performs a frontend action, \`(C)\` uses an abap2UI5 custom
  control, \`(A,C)\` both), \`summary\`, \`source\` (which repository -
  its GitHub name is under \`sources\`), \`file\` (the class's path in it, on
  \`branch\` where that is not main - so the ABAP is at
  \`https://raw.githubusercontent.com/<repo>/<branch>/<file>\` and its page at
  \`https://github.com/<repo>/blob/<branch>/<file>\`),
  \`group\`, \`stage\`, \`keywords\`, the \`controls\` it builds, the \`libraries\` it
  needs, the oldest UI5 release it runs on (\`minUi5\`), whether it \`runs\` in the
  browser, and \`page\` - the directory of its own page here. The top level also
  lists every control (\`controls\`, ${(index.controls || []).length}), library (\`libraries\`, ${(index.libraries || []).length}) and
  release (\`releases\`) in use.
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
    + `the full list at samples/all/, llms.txt for the samples and for the playground, sitemap.xml with ${urls.length} URLs`
    + `${skipped > 0 ? ` - ${skipped} entries skipped, no usable class name or source URL` : ""}`,
  );
}
