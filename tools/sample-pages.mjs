// What dist/samples/ holds now that the sample catalogue is a site of its own.
//
// The catalogue - every sample of the three repositories, searchable, a page
// per sample with the class printed in full - used to be built HERE, into
// dist/samples/: 770-odd static pages beside the playground. It is
// abap2UI5/samples-site now, at https://abap2ui5.github.io/samples-site/,
// a site of its own that builds from the one file this deployment still
// publishes for it: samples/apps.json (tools/build-catalogue.mjs), the index
// the playground's own samples dialog reads too.
//
// What stays here is every ADDRESS this site used to answer: a redirect per
// sample at samples/<class>/, one for the catalogue at samples/ and one for
// the full list at samples/all/ - links in issues, posts and bookmarks keep
// landing - plus the 404 beside them (tools/not-found-page.mjs), the sitemap
// and llms.txt. A redirect is a document with a refresh and a canonical, no
// script, so it passes the same policy every other document here does.
import fs from "fs";
import path from "path";
import { stripHtmlComments, withPolicy } from "./html.mjs";
import { rawUrlOf } from "../src/shell/catalogue-urls.mjs";
import { SITE } from "./sample-frame.mjs";
import { notFoundPage } from "./not-found-page.mjs";

/* Where the site is published - tools/sample-frame.mjs decides it, beside the
 * bar the 404 carries; it is re-exported because this is where the build and
 * the tests have always asked for it. */
export { SITE };
/* Where the catalogue lives now. */
export const SAMPLES_SITE = "https://abap2ui5.github.io/samples-site/";

const log = (m) => console.log(`build-catalogue: ${m}`);

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* A class name that is a plain ABAP name gets a directory; anything else gets
 * none - a path is not a thing to build out of somebody else's JSON. */
const safe = (url) => (/^https:\/\/[^\s"'<>]+$/.test(String(url ?? "")) ? String(url) : undefined);
const dirOf = (cls) => {
  const name = String(cls ?? "").toLowerCase();
  return /^[a-z][a-z0-9_]{2,60}$/.test(name) ? name : undefined;
};

/* The 404's own stylesheet, beside catalogue.css (tools/not-found-page.mjs). */
const CSS = fs.readFileSync(new URL("../src/catalogue/sample.css", import.meta.url), "utf8");

/**
 * Which entries of the index get an address here - the same rule the pages
 * followed, so every link that used to land still does. Stamps `page` on the
 * entry, which the index is written with (tools/build-catalogue.mjs).
 */
export async function prepareSamplePages(index) {
  const rows = [];
  const taken = new Set();
  let skipped = 0;
  for (const entry of index.entries || []) {
    const dir = dirOf(entry.class);
    const raw = rawUrlOf(entry, index.sources);
    if (dir === undefined || taken.has(dir) || safe(raw) === undefined) {
      skipped += 1;
      continue;
    }
    taken.add(dir);
    entry.page = `${dir}/`;
    rows.push({ dir, raw, class: String(entry.class), title: String(entry.title || entry.class) });
  }
  return { rows, skipped };
}

/* A document that is a redirect: the refresh for a browser, the canonical for
 * a crawler, noindex so the address here is not the one a search engine
 * keeps, and the link for a reader whose browser does neither. */
const redirect = (to, title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${esc(to)}">
<link rel="canonical" href="${esc(to)}">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
</head>
<body>
<p>This page has moved to <a href="${esc(to)}">${esc(to)}</a>.</p>
</body>
</html>
`;

/**
 * Writes the redirects, the 404, the sitemap and llms.txt from the rows
 * prepareSamplePages( ) made.
 */
export function writeSamplePages(index, distDir, { rows, skipped }) {
  const samplesDir = path.join(distDir, "samples");
  fs.mkdirSync(samplesDir, { recursive: true });

  /* Every directory under dist/samples belongs to this step: a sample that was
   * renamed or dropped upstream has to stop being an address here. */
  for (const name of fs.readdirSync(samplesDir)) {
    const full = path.join(samplesDir, name);
    if (fs.statSync(full).isDirectory()) fs.rmSync(full, { recursive: true, force: true });
  }
  /* ...and the files the catalogue page used to be made of, in a dist/ that
   * was built before it moved. */
  for (const name of ["catalogue.mjs", "page.mjs", "abap-highlight.mjs"]) fs.rmSync(path.join(samplesDir, name), { force: true });

  fs.writeFileSync(path.join(samplesDir, "sample.css"), CSS);
  fs.writeFileSync(path.join(samplesDir, "index.html"), withPolicy(redirect(SAMPLES_SITE, "abap2UI5 samples")));
  fs.mkdirSync(path.join(samplesDir, "all"), { recursive: true });
  fs.writeFileSync(path.join(samplesDir, "all", "index.html"), withPolicy(redirect(SAMPLES_SITE, "abap2UI5 samples")));
  for (const row of rows) {
    const dir = path.join(samplesDir, row.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), withPolicy(redirect(`${SAMPLES_SITE}sample/${row.dir}/`, `${row.title} - abap2UI5 sample`)));
  }

  /* The page for an address that is not a page - at the root of the artefact,
   * which is where GitHub Pages looks for it. */
  fs.writeFileSync(path.join(distDir, "404.html"), withPolicy(stripHtmlComments(notFoundPage(rows))));

  /* The sitemap: the pages of this deployment. The samples are the other
   * site's to list. */
  const urls = [SITE, `${SITE}ai/`];
  fs.writeFileSync(
    path.join(distDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map((url) => `<url><loc>${esc(url)}</loc></url>`).join("\n")
    + "\n</urlset>\n",
  );

  /* THE PLAYGROUND'S OWN MAP, for a machine: how to open a class in it by
   * URL, or put a running example on a page. The contract is the one
   * main.mjs, share.mjs and the embed kit implement; a change there is a
   * change here. */
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
  needs. A GitHub raw URL is the usual shape, and every sample's page on the
  samples site carries one.
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

- [${SAMPLES_SITE}](${SAMPLES_SITE}): every abap2UI5 sample, searchable by
  control, by library and by the UI5 release a system runs; one page per
  sample at \`sample/<class>/\` with the class in full, a button that runs it
  here, and the chapter of the manual it belongs to. A site of its own,
  built from the index below.
- [samples/apps.json](${SITE}samples/apps.json): the index, one object per
  sample under \`entries\`: \`class\`, \`title\`, \`note\`, \`summary\`, \`source\`
  (which repository - its GitHub name is under \`sources\`), \`file\` (the
  class's path in it, so the ABAP is at
  \`https://raw.githubusercontent.com/<repo>/<branch>/<file>\`), \`group\`,
  \`stage\`, \`keywords\`, the \`controls\` it builds, the \`libraries\` it needs,
  the oldest UI5 release it runs on (\`minUi5\`), whether it \`runs\` in the
  browser, and \`docs\`, the chapters of the manual about it.
- \`${SITE}samples/<class>/\` is where a sample's page used to be; it
  forwards to the samples site.

## Elsewhere

- [the documentation](https://abap2ui5.github.io/docs/llms.txt), and
  [llms-full.txt](https://abap2ui5.github.io/docs/llms-full.txt) for all of it
  in one document
- [the framework's code map](https://github.com/abap2UI5/abap2UI5/blob/main/llms.txt)
`);

  log(
    `${rows.length} redirects -> dist/samples/<class>/ (to ${SAMPLES_SITE}), `
    + `samples/ and samples/all/ forward there too; 404.html, sitemap.xml, llms.txt`
    + `${skipped > 0 ? ` - ${skipped} entries skipped, no usable class name or source URL` : ""}`,
  );
}
