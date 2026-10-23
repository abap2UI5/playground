// The documents tools/build-site.mjs writes - the playground's index.html and
// its two AI doors, ai/ and pilot/, and the sample catalogue's index.html.
//
// Each is a source file with markers in it that only this build can fill:
// the hashed names of the chunks to preload, Monaco's stylesheet, the sample
// count, the site's own address, and the theme scripts every document on the
// site carries inline (src/shell/theme-boot.mjs, the one copy). Their own
// module rather than the end of build-site.mjs, which is the esbuild half of
// the step: these read what those builds wrote - the page build's metafile,
// handed in, and the index under dist/samples/ - and only write documents.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripHtmlComments, withPolicy } from "./html.mjs";
import { SITE } from "./sample-pages.mjs";
import { THEME_BOOT, THEME_MENU, inlineScript } from "../src/shell/theme-boot.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = path.join(ROOT, "src", "shell");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(DIST, "assets");

const log = (m) => console.log(`build-site: ${m}`);

/* Where a source asks for the theme scripts. Comments, so a source opened
 * as it is - never served, but read - is still a document, and replaced
 * before the comments are stripped. */
const THEME_BOOT_MARKER = "<!-- __THEME_BOOT__ -->";
const THEME_MENU_MARKER = "<!-- __THEME_MENU__ -->";

// index.html, with a modulepreload for every chunk assets/shell.mjs imports
// statically. Splitting the bundle put the code the entry shares with its
// chunks - most of abaplint, which the transpiler needs too - into a chunk of
// its own that shell.mjs imports at its top, and a static import is only
// discovered once the importing file has arrived: without the preload the
// chunk would be fetched after the bundle instead of beside it, a round trip
// and a serialized download on the path to the first editor frame. The names
// carry a hash, so the tags are written here rather than by hand. Only the
// static imports: the dynamic ones are wanted during the parse and fetched
// then, where the network is idle.
export function writeIndex({ metafile, monacoCss }) {
  const outputs = metafile.outputs;
  const rel = (out) => path.relative(DIST, path.join(ROOT, out)).split(path.sep).join("/");
  const entry = outputs[path.relative(ROOT, path.join(ASSETS, "shell.mjs"))];
  const statics = entry.imports.filter((i) => i.kind === "import-statement").map((i) => rel(i.path));
  const tags = statics.map((href) => `<link rel="modulepreload" href="${href}">`);
  // Monaco's chunk - the output whose entry point is src/editor/monaco-editor.mjs,
  // which src/editor/editor.mjs imports dynamically - and whatever it imports
  // statically that the entry does not already preload. The inline script
  // preloads these on every page but an app-only one; see index.html.
  const monaco = Object.keys(outputs).find((o) => outputs[o].entryPoint === "src/editor/monaco-editor.mjs");
  if (!monaco) {
    console.error("build-site: ERROR the bundle has no chunk for src/editor/monaco-editor.mjs - is it still imported dynamically?");
    process.exit(1);
  }
  const editorPreloads = [
    rel(monaco),
    ...outputs[monaco].imports
      .filter((i) => i.kind === "import-statement" && !i.external)
      .map((i) => rel(i.path))
      .filter((href) => !statics.includes(href)),
  ];
  const source = fs.readFileSync(path.join(SHELL, "index.html"), "utf8");
  const marker = "<!-- __MODULEPRELOADS__ -->";
  for (const needed of [marker, THEME_BOOT_MARKER, "__EDITOR_PRELOADS__", "__EDITOR_CSS__"]) {
    if (!source.includes(needed)) {
      console.error(`build-site: ERROR src/shell/index.html no longer has a ${needed} to substitute`);
      process.exit(1);
    }
  }
  /* After the substitution, without the comments: 9.8 kB of the 37 kB document,
     a third of its compressed weight (tools/html.mjs). */
  const html = stripHtmlComments(
    source
      .replace(THEME_BOOT_MARKER, () => inlineScript(THEME_BOOT))
      .replace(marker, tags.join("\n"))
      .replace("__EDITOR_PRELOADS__", JSON.stringify(editorPreloads))
      /* Monaco's stylesheet, linked by the same script on the same pages. */
      .replace("__EDITOR_CSS__", JSON.stringify(monacoCss)),
  );
  fs.writeFileSync(path.join(DIST, "index.html"), html);
  log(`index.html (${tags.length} chunk${tags.length === 1 ? "" : "s"} preloaded, Monaco's ${editorPreloads.length} where the editor is shown)`);
  writeAiPage(html, metafile);
  writePilotPage(html, metafile);
}

// The AI Studio's page, ai/index.html: the playground's own document, one
// directory down, marked as the studio - linked from the toolbar and the
// menu, in the sitemap, with a canonical of its own (it is published; the
// Pilot below is not yet). `<base href="../">` makes every relative URL
// in it - the bundle, the workers the inline script starts, the app frame,
// the service worker's scope - resolve where the playground's own do, so
// there is one build of everything and two doors into it. main.mjs reads
// `data-page="ai"` and opens the studio on an empty class.
function writeAiPage(html, metafile) {
  const page = html
    .replace(/<html([^>]*)>/, '<html$1 data-page="ai">')
    .replace("<head>", `<head>\n<base href="../">${preloadsFor(metafile, "src/shell/chat.mjs")}`)
    .replace(/<title>[^<]*<\/title>/, "<title>AI Studio · abap2UI5</title>")
    .replace(/<link rel="canonical"[^>]*>/, '<link rel="canonical" href="https://abap2ui5.github.io/playground/ai/">')
    // The bar: on this document the studio is where the reader IS, so its
    // item is the bold one and Playground is a link again - to the
    // workbench's front, which `<base href="../">` resolves "./" to. The
    // Playground link carries `data-site` so site-memory lifts it to where
    // the reader left the workbench, the way every other bar's does.
    .replace(/<span class="here" aria-current="page">([\s\S]*?data-text="Playground"[\s\S]*?<\/span>)<\/span>/,
      '<a href="./" data-site="playground" title="Write ABAP and run it in the browser">$1</a>')
    .replace(/<a href="ai\/" data-site="ai"[^>]*>([\s\S]*?data-text="AI Studio"[\s\S]*?<\/span>)<\/a>/,
      '<span class="here" aria-current="page">$1</span>');
  for (const mark of ['data-page="ai"', '<base href="../">', "<title>AI Studio", 'canonical" href="https://abap2ui5.github.io/playground/ai/"',
    '<a href="./" data-site="playground"', '<span class="here" aria-current="page"><svg']) {
    if (!page.includes(mark)) {
      console.error(`build-site: ERROR the AI page could not be written - ${mark} did not land in src/shell/index.html's copy`);
      process.exit(1);
    }
  }
  fs.mkdirSync(path.join(DIST, "ai"), { recursive: true });
  fs.writeFileSync(path.join(DIST, "ai", "index.html"), page);
  log("ai/index.html (the AI Studio)");
}

// The AI Pilot's page, pilot/index.html: the same document again, one
// directory down, the way ai/index.html is - see writeAiPage( ). main.mjs
// reads `data-page="pilot"` and src/shell/pilot.mjs turns the page into the
// Pilot: the app on the stage, Claude operating it from the chat beside it.
// Not linked and not indexed while it is being built.
function writePilotPage(html, metafile) {
  const page = html
    .replace(/<html([^>]*)>/, '<html$1 data-page="pilot">')
    .replace("<head>", `<head>\n<base href="../">\n<meta name="robots" content="noindex">${preloadsFor(metafile, "src/shell/pilot.mjs")}`)
    .replace(/<title>[^<]*<\/title>/, "<title>AI Pilot · abap2UI5</title>")
    .replace(/<link rel="canonical"[^>]*>\n?/, "");
  for (const mark of ['data-page="pilot"', '<base href="../">', "<title>AI Pilot"]) {
    if (!page.includes(mark)) {
      console.error(`build-site: ERROR the Pilot page could not be written - ${mark} did not land in src/shell/index.html's copy`);
      process.exit(1);
    }
  }
  fs.mkdirSync(path.join(DIST, "pilot"), { recursive: true });
  fs.writeFileSync(path.join(DIST, "pilot", "index.html"), page);
  log("pilot/index.html (the AI Pilot)");
}

// The room of an AI page - src/shell/chat.mjs for the studio, src/shell/pilot.mjs
// for the Pilot - is a chunk main.mjs imports on that page alone, the moment
// boot( ) starts; its hashed name is only known here, so each page preloads
// its own, with whatever that chunk imports statically that the shell does
// not already preload - the way index.html preloads Monaco's.
function preloadsFor(metafile, entryPoint) {
  const outputs = metafile.outputs;
  const rel = (out) => path.relative(DIST, path.join(ROOT, out)).split(path.sep).join("/");
  const shell = Object.keys(outputs).find((o) => outputs[o].entryPoint === "src/shell/main.mjs");
  const statics = outputs[shell].imports.filter((i) => i.kind === "import-statement").map((i) => rel(i.path));
  const room = Object.keys(outputs).find((o) => outputs[o].entryPoint === entryPoint);
  if (!room) {
    console.error(`build-site: ERROR the bundle has no chunk for ${entryPoint} - is it still imported dynamically?`);
    process.exit(1);
  }
  const hrefs = [rel(room), ...outputs[room].imports
    .filter((i) => i.kind === "import-statement" && !i.external)
    .map((i) => rel(i.path))
    .filter((href) => !statics.includes(href))];
  return hrefs.map((href) => `\n<link rel="modulepreload" href="${href}">`).join("");
}

// The sample catalogue's document, dist/samples/index.html, out of
// src/catalogue/index.html. Called after build-catalogue has written the index
// it counts, and after the catalogue's bundles have landed beside it.
export function writeCatalogueDocument() {
  /* The catalogue's document, without the comments its source is written with -
     four kilobytes of a twenty-kilobyte page - and with its policy in the head
     (tools/html.mjs, both). */
  /* The one figure the document carries as text - the count in the no-JS
     fallback, the sentence a crawler and a reader without scripts get - is
     written here from the index the catalogue step has just built, so it cannot
     say "700-odd" while the index holds 772. A source with no marker, or an
     index that is not there, fails the build rather than publishing a guess. */
  const catalogueSource = fs.readFileSync(path.join(ROOT, "src", "catalogue", "index.html"), "utf8");
  if (!catalogueSource.includes("__SAMPLE_COUNT__")) throw new Error("src/catalogue/index.html lost its __SAMPLE_COUNT__ marker");
  /* The site's own address in the canonical, the og:url and the JSON-LD - the
     same SITE every generated page writes, so a fork (PG_SITE_URL) does not
     declare the upstream catalogue as the canonical copy of its own. */
  if (!catalogueSource.includes("__SITE__")) throw new Error("src/catalogue/index.html lost its __SITE__ marker");
  /* The two theme scripts, from src/shell/theme-boot.mjs - the text every sample
     page carries too. */
  for (const marker of [THEME_BOOT_MARKER, THEME_MENU_MARKER]) {
    if (!catalogueSource.includes(marker)) throw new Error(`src/catalogue/index.html lost its ${marker} marker`);
  }
  const catalogueIndex = JSON.parse(fs.readFileSync(path.join(DIST, "samples", "apps.json"), "utf8"));
  /* A missing index or one in a shape this does not know fails the build. An
     EMPTY one does not: it is what build-catalogue writes, by design, when none
     of the three catalogues arrived (raw.githubusercontent.com down during a
     deploy), and that step's failure is the survivable one - the page then
     says the catalogue could not be loaded. Throwing here made it fatal after
     all. */
  if (!Array.isArray(catalogueIndex.entries ?? catalogueIndex.samples) || !Array.isArray(catalogueIndex.sources)) {
    throw new Error("dist/samples/apps.json is not an index - build-catalogue did not run, or its shape changed");
  }
  const sampleCount = (catalogueIndex.entries ?? catalogueIndex.samples).length;
  if (!sampleCount) log("WARNING: the catalogue index is empty - the page will say it could not be loaded");
  fs.writeFileSync(
    path.join(DIST, "samples", "index.html"),
    withPolicy(stripHtmlComments(catalogueSource
      .replaceAll("__SITE__", SITE)
      .replace("__SAMPLE_COUNT__", sampleCount ? String(sampleCount) : "no")
      .replace(THEME_BOOT_MARKER, () => inlineScript(THEME_BOOT))
      .replace(THEME_MENU_MARKER, () => inlineScript(THEME_MENU)))),
  );
}
