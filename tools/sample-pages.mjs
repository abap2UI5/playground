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
// no JavaScript at all.
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

const bar = (up) => `<header class="bar">
  <a class="brand" href="${up}">
    <img src="${up}favicon.png" alt="" width="20" height="20">
    <span>abap2UI5 <b>playground</b></span>
  </a>
  <nav class="bar-nav">
    <a href="${up}" title="Write ABAP and run it in the browser">Playground</a>
    <a href="${up}samples/">Samples</a>
    <a href="https://abap2ui5.github.io/docs/" target="_blank" rel="noopener">Docs</a>
  </nav>
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
.sample .badges { margin: 12px 0; }
.sample .actions { margin: 16px 0 24px; }
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

  const facts = [];
  if (source) {
    facts.push([
      "Repository",
      `<a href="https://github.com/${esc(source.repo)}">${esc(source.repo)}</a>`,
    ]);
  }
  facts.push(["Class", `<code>${esc(row.class.toUpperCase())}</code>`]);
  if (row.group) facts.push([row.source === "controls" ? "Library" : "Category", esc(row.group)]);
  if (row.stageTitle) facts.push(["Learning path", esc(row.stageTitle)]);
  if (row.entity) facts.push(["UI5 entity", `<code>${esc(row.entity)}</code>`]);
  if (row.sample) facts.push(["Demo kit sample", `<code>${esc(row.sample)}</code>`]);
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

  /* Why it needs what it needs: the linter's own reasons, which is the half a
   * reader can argue with rather than only believe. */
  const why = [
    row.needsDetail ? esc(row.needsDetail) : "",
    ...(row.since || []).map((s) => `<code>${esc(s.name)}</code> since ${esc(s.since)}`),
  ].filter(Boolean);

  const run = row.runs
    ? `<a class="run" href="../../?src=${encodeURIComponent(row.raw)}&amp;from=catalogue&amp;back=`
      + `${encodeURIComponent(`q=${row.class}`)}">Run it in the browser</a>`
    : "";
  const github = safe(row.github);
  const docs = safe((row.docs || [])[0]);

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

  <div class="actions">
    ${run}
    ${github ? `<a href="${esc(github)}" target="_blank" rel="noopener">Read the ABAP ↗</a>` : ""}
    ${docs ? `<a href="${esc(docs)}" target="_blank" rel="noopener">Documentation ↗</a>` : ""}
  </div>

  ${
    row.needs
      ? `<p class="warns"><b>${esc(row.needs)}.</b> This sample is listed here because a sample
    somebody cannot find is worse than one they cannot run${why.length ? `: ${why.join("; ")}` : ""}.
    The ABAP is above; installed on a system that has what it needs, it runs there.</p>`
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
</body>
</html>
`;
}

/**
 * Writes the pages and the sitemap. Everything comes from the index this build
 * just produced, so the pages are exactly as current as it is.
 */
export function writeSamplePages(index, distDir) {
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
