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
import { stripHtmlComments } from "./html.mjs";
import { THEME_BOOT, inlineScript } from "../src/shell/theme-boot.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = path.join(ROOT, "src", "shell");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(DIST, "assets");

const log = (m) => console.log(`build-site: ${m}`);

/* Where a source asks for the theme scripts. Comments, so a source opened
 * as it is - never served, but read - is still a document, and replaced
 * before the comments are stripped. */
const THEME_BOOT_MARKER = "<!-- __THEME_BOOT__ -->";

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
    .replace(/<title>[^<]*<\/title>/, "<title>AI App Builder · abap2UI5</title>")
    .replace(/<link rel="canonical"[^>]*>/, '<link rel="canonical" href="https://abap2ui5.github.io/playground/ai/">')
  for (const mark of ['data-page="ai"', '<base href="../">', "<title>AI App Builder", 'canonical" href="https://abap2ui5.github.io/playground/ai/"']) {
    if (!page.includes(mark)) {
      console.error(`build-site: ERROR the AI page could not be written - ${mark} did not land in src/shell/index.html's copy`);
      process.exit(1);
    }
  }
  fs.mkdirSync(path.join(DIST, "ai"), { recursive: true });
  fs.writeFileSync(path.join(DIST, "ai", "index.html"), page);
  log("ai/index.html (the AI App Builder)");
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
    .replace(/<title>[^<]*<\/title>/, "<title>AI Agent · abap2UI5</title>")
    .replace(/<link rel="canonical"[^>]*>\n?/, "");
  for (const mark of ['data-page="pilot"', '<base href="../">', "<title>AI Agent"]) {
    if (!page.includes(mark)) {
      console.error(`build-site: ERROR the Pilot page could not be written - ${mark} did not land in src/shell/index.html's copy`);
      process.exit(1);
    }
  }
  fs.mkdirSync(path.join(DIST, "pilot"), { recursive: true });
  fs.writeFileSync(path.join(DIST, "pilot", "index.html"), page);
  log("pilot/index.html (the AI Agent)");
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

