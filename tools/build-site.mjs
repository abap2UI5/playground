#!/usr/bin/env node
// Assembles dist/ - the static site GitHub Pages serves.
//
// The two slow halves are built elsewhere and left where they are:
// tools/build-framework.mjs writes dist/runtime, tools/build-ui5.mjs writes
// dist/app. This step is the page itself: the shell bundle, its stylesheet, and
// whatever static assets the shell needs.
//
// What it writes besides the bundles has modules of its own: the documents
// (tools/site-documents.mjs - index.html, the two AI doors and the catalogue's
// page) and the service worker (tools/service-worker.mjs), both of which only
// read what the builds here produced.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { MONACO_CSS, abap2ui5LinterPlugin, monacoCssPlugin, nodeStubPlugin } from "./esbuild-plugins.mjs";
import { SAMPLE_LIST, SAMPLE_REPO } from "../src/editor/sample-list.mjs";
import { rawUrlOf } from "../src/shell/catalogue-urls.mjs";
import { writeCatalogueDocument, writeIndex } from "./site-documents.mjs";
import { chunks, writeServiceWorker } from "./service-worker.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = path.join(ROOT, "src", "shell");
const DEPS = path.join(ROOT, "deps");
const DIST = path.join(ROOT, "dist");
const BUILD_SAMPLES = path.join(ROOT, "build", "samples");
const ASSETS = path.join(DIST, "assets");

// The one directory of abap2UI5 that never reaches the editor.
//
// abap2UI5 ships its UI5 frontend a second time, as ABAP: src/01/03 is
// app/webapp/ generated into `z2ui5_cl_ui5f_*` classes whose whole content is
// the frontend's JavaScript, XML, CSS and HTML held as string constants, so a
// real system can serve it over ICF. The playground serves none of that - the
// frontend it runs is built from source into dist/app - so in the editor's
// corpus these are payload and nothing else. Nobody control-clicks into a
// comment-stripped copy of a UI5 module to find out how abap2UI5 works, which
// is the argument that keeps the rest of the corpus whole (AGENTS.md, "the
// corpus ships whole").
//
// They are also what made the playground unusable on a phone. Generated ABAP
// puts a whole frontend module into ONE statement - the largest is 1600 tokens
// of `&& ... &&` - and abaplint parses an expression with recursive
// combinators, so that single statement drives the parser some 800 levels deep.
// With src/01/03 in it the boot parse needs more than 610 KB of JavaScript
// stack; without it, a little over 130 KB. Node and Chrome give a little under
// a megabyte, which is why this worked on every desk and on no iPhone: mobile
// Safari's stack is smaller, and the corpus parse threw RangeError: Maximum
// call stack size exceeded before the playground had finished starting.
// tools/check-size.mjs holds the parse to a budget so this cannot come back
// unnoticed.
const GENERATED_FRONTEND = path.join(DEPS, "abap2ui5", "src", "01", "03");

const log = (m) => console.log(`build-site: ${m}`);
const kb = (p) => `${Math.round(fs.statSync(p).size / 1024)} KB`;

// Cleared, not merged into: a file this step stops producing has to disappear
// from the published site, and a stale asset that nothing references any more
// is indistinguishable from one that does. dist/runtime and dist/app belong to
// the other two build steps and are left alone here.
for (const owned of [ASSETS, path.join(DIST, "editor"), path.join(DIST, "examples"), path.join(DIST, "embed")]) {
  fs.rmSync(owned, { recursive: true, force: true });
}
fs.mkdirSync(ASSETS, { recursive: true });
writeCorpus();

// The registry worker: abaplint, the corpus parse and the transpiler, as one
// bundle beside the corpus it fetches (src/editor/registry-worker.mjs). Its
// own bundle rather than a chunk of the page's, because a worker's script
// is a top-level fetch of its own - started by index.html before the page
// bundle has arrived - and because nothing in it is shared with the page:
// abaplint left the page bundle when the registry left the page's thread,
// and the abap2UI5 linter followed it (src/editor/lint-core.mjs).
//
// THE FOUR BUNDLES ARE BUILT TOGETHER - this one, the linter's, the page's
// and the catalogue's, each a function here and all four under one
// Promise.all below. They read different sources and write different files,
// and nothing between them depends on another's result: only writeIndex( )
// and writeServiceWorker( ) read the page build's metafile, and both run
// after all four have landed. Run one after the other they cost their sum;
// esbuild runs each on every core it has, but a bundle spends much of its
// wall time reading files and waiting on plugins, which is where the next
// one's work fits. Each logs its own size when it finishes, so the lines
// arrive in the order the builds land rather than the order they stand here.
async function buildRegistry() {
  await esbuild.build({
    entryPoints: [path.join(ROOT, "src", "editor", "registry-worker.mjs")],
    outfile: path.join(DIST, "editor", "registry.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    // abaplint identifies some of its own node types by class name - see the
    // page bundle below, which needed this for the same library.
    keepNames: true,
    sourcemap: process.env.PG_DEBUG === "1",
    logLevel: "warning",
    plugins: [nodeStubPlugin(ROOT)],
    inject: [path.join(ROOT, "src", "runtime", "buffer-shim.mjs")],
  });
  log(`editor/registry.mjs (${kb(path.join(DIST, "editor", "registry.mjs"))})`);
}

// The abap2UI5 linter with its half-megabyte of UI5 metadata, which the
// worker imports at run time (lint-core.mjs) the moment it starts: not in
// the worker's bundle, where it would sit in front of the corpus fetch, and
// not a chunk split off it either - a chunk shares its helpers with the
// entry, and that shared piece became a static import the worker had to
// fetch before it could run a line, one more round trip in front of the
// corpus. So it is a bundle of its own under a fixed name, precached and
// hashed against the build like the worker itself (writeServiceWorker).
async function buildLinter() {
  await esbuild.build({
    entryPoints: [path.join(ROOT, "src", "editor", "lint-entry.mjs")],
    outfile: path.join(DIST, "editor", "lint.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    sourcemap: process.env.PG_DEBUG === "1",
    logLevel: "warning",
    // The linter plugin goes first: it claims `fs` and `path` for the abap2UI5
    // linter alone, and leaves every other importer to the ordinary stubs.
    plugins: [abap2ui5LinterPlugin(ROOT), nodeStubPlugin(ROOT)],
  });
  log(`editor/lint.mjs (${kb(path.join(DIST, "editor", "lint.mjs"))})`);
}

// --------------------------------------------------------------- ABAP corpus

// The ABAP sources the editor knows about: abap2UI5 itself and the open-abap
// standard library. abaplint needs them to answer anything at all about the
// class in the editor - without z2ui5_if_app it cannot say whether main( ) is
// implemented, and without open-abap it cannot resolve the types that interface
// is written in.
//
// Shipped as one JSON file rather than 900 fetches. abaplint identifies an
// object by the file's base name, so the tree is flattened; package files are
// left out because they are the one base name that repeats and the editor has
// no use for them.
//
// And one directory is left out for a reason that has nothing to do with size.
// See GENERATED_FRONTEND above - it is the difference between a playground that
// starts on a phone and one that does not.
function writeCorpus() {
  const files = {};
  const add = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (p !== GENERATED_FRONTEND) add(p);
        continue;
      }
      if (!/\.(abap|xml)$/.test(e.name)) continue;
      if (e.name.includes(".testclasses.") || e.name.endsWith(".devc.xml")) continue;
      if (files[e.name] !== undefined) {
        throw new Error(`build-site: two source files are both called ${e.name}`);
      }
      files[e.name] = fs.readFileSync(p, "utf8");
    }
  };
  // A filter that quietly stops matching is the failure this cannot have: the
  // corpus would grow by a megabyte, the size budget would still pass it, and
  // the only report would be a phone somewhere that no longer starts.
  if (!fs.existsSync(GENERATED_FRONTEND)) {
    throw new Error(
      `build-site: ${path.relative(ROOT, GENERATED_FRONTEND)} is not there any more. ` +
        "That is where abap2UI5 keeps its generated frontend, which the corpus leaves out on " +
        "purpose - find where it moved to and point GENERATED_FRONTEND at it.",
    );
  }
  add(path.join(DEPS, "abap2ui5", "src"));
  add(path.join(DEPS, "open-abap-core", "src"));

  const out = path.join(DIST, "editor");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "corpus.json"), JSON.stringify(files));
  const mb = (fs.statSync(path.join(out, "corpus.json")).size / 1048576).toFixed(1);
  log(`corpus.json: ${Object.keys(files).length} ABAP sources (${mb} MB)`);
}

// The samples the page carries, materialised out of the pinned
// abap2UI5/samples (src/editor/sample-list.mjs says which; deps/ holds the
// commit). Three things come out of `build/samples/`, and none of them is
// checked in:
//
//   <class>.clas.abap  the ABAP itself, under the name abapGit gives it -
//                      which is the name the editor has to open it under
//   index.json         id, title, blurb, files, GitHub link; Node reads this
//                      one (the tests do), which is why it is JSON
//   sources.mjs        the default sample's files as static imports, and a
//                      loader per sample - an import( ) of sample-<id>.mjs,
//                      one `import` per file in it - because a bundler has to
//                      see every import statically and the list is not static
//                      any more. Only the default sample's ABAP is in the
//                      shell's bundle; every other sample is a chunk fetched
//                      when it is picked (src/editor/samples.mjs)
//
// Titles and blurbs are read out of that repository's catalogue.json rather
// than restated here: it is the same catalogue the samples browser lists the
// other seven hundred entries from, so a sample reads the same whether it came
// with the page or over the network.
// The path of a class inside the pinned samples repository, for the classes a
// sample calls rather than is. Searched rather than configured: their place in
// that tree (src/01, src/02, …) is that repository's business.
function findClass(repo, name) {
  const wanted = `${name.toLowerCase()}.clas.abap`;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const found = walk(p);
        if (found) return found;
      } else if (e.name.toLowerCase() === wanted) return path.relative(repo, p);
    }
    return undefined;
  };
  const found = walk(path.join(repo, "src"));
  if (!found) {
    throw new Error(
      `build-site: ${name} is named by src/editor/sample-list.mjs and is not in the pinned ${SAMPLE_REPO}.`,
    );
  }
  return found;
}

function writeSamples() {
  const repo = path.join(DEPS, "abap2ui5-samples");
  const cataloguePath = path.join(repo, "catalogue.json");
  if (!fs.existsSync(cataloguePath)) {
    throw new Error("build-site: deps/abap2ui5-samples has no catalogue.json - run `npm run deps` first.");
  }
  const catalogue = JSON.parse(fs.readFileSync(cataloguePath, "utf8"));
  const byClass = new Map((catalogue.samples || []).map((s) => [String(s.class).toLowerCase(), s]));

  fs.rmSync(BUILD_SAMPLES, { recursive: true, force: true });
  fs.mkdirSync(BUILD_SAMPLES, { recursive: true });

  const index = [];
  const copied = new Map();
  for (const wanted of SAMPLE_LIST) {
    /* The app has to be a catalogued sample - that is where its title and its
     * blurb come from. A class it calls need not be: an app that only exists to
     * be navigated INTO is a file in that repository and no row in its
     * catalogue, which is right, so those are looked up on disk. */
    const app = byClass.get(wanted.class.toLowerCase());
    if (!app) {
      throw new Error(
        `build-site: ${wanted.class} is in src/editor/sample-list.mjs and not in the pinned ${SAMPLE_REPO} ` +
          "catalogue - it was renamed or dropped upstream; pick another class or move the pin back.",
      );
    }
    const files = [];
    for (const name of [app.file, ...(wanted.also ?? []).map((c) => findClass(repo, c))]) {
      const from = path.join(repo, name);
      if (!fs.existsSync(from)) throw new Error(`build-site: ${SAMPLE_REPO} lists ${name}, which is not there.`);
      const base = path.basename(name);
      if (!copied.has(base)) {
        fs.writeFileSync(path.join(BUILD_SAMPLES, base), fs.readFileSync(from, "utf8"));
        copied.set(base, true);
      }
      files.push(base);
    }
    index.push({
      id: wanted.id,
      /* The description is the sentence that names the app ("Hello World, the
       * Smallest App"); the catalogue's own `title` is its place in a series
       * ("Basics I"), which says nothing on a row of its own. */
      title: String(app.description || app.title || wanted.class),
      note: String(app.summary || ""),
      /* The two facts a catalogued row shows beside its title. They are in the
       * catalogue for these samples like for any other, and leaving them out
       * was the one thing that still made a carried row look like a different
       * kind of thing from the rows under it. */
      group: String(app.category || ""),
      docs: (app.docs || []).filter((d) => typeof d === "string"),
      files,
      github: `https://github.com/${SAMPLE_REPO}/blob/main/${app.file}`,
    });
  }

  fs.writeFileSync(path.join(BUILD_SAMPLES, "index.json"), JSON.stringify(index, null, 2) + "\n");
  /* One module per sample, its files as text, and the default sample's files
   * in the module the shell imports statically: the page opens on those and
   * needs nothing else until a sample is picked. A file two samples share
   * (an app one of them navigates into) is imported by both modules, and
   * esbuild gives it a chunk of its own. */
  const moduleFor = (files) =>
    `// Written by tools/build-site.mjs - see writeSamples( ). Do not edit.\n` +
    `${files.map((base, i) => `import S${i} from "./${base}";`).join("\n")}\n\n` +
    `export default {\n${files.map((base, i) => `  ${JSON.stringify(base)}: S${i},`).join("\n")}\n};\n`;
  for (const sample of index.slice(1)) fs.writeFileSync(path.join(BUILD_SAMPLES, `sample-${sample.id}.mjs`), moduleFor(sample.files));
  const [first, ...rest] = index;
  fs.writeFileSync(
    path.join(BUILD_SAMPLES, "sources.mjs"),
    `// Written by tools/build-site.mjs - see writeSamples( ). Do not edit.\n` +
      `${first.files.map((base, i) => `import D${i} from "./${base}";`).join("\n")}\n\n` +
      `// The sample the page opens on, in the bundle.\n` +
      `export const DEFAULT_SOURCES = {\n${first.files.map((base, i) => `  ${JSON.stringify(base)}: D${i},`).join("\n")}\n};\n\n` +
      `// Every sample's files, by id, each a chunk fetched when it is picked.\n` +
      `export const LOADERS = {\n` +
      `  ${JSON.stringify(first.id)}: () => Promise.resolve(DEFAULT_SOURCES),\n` +
      rest.map((s) => `  ${JSON.stringify(s.id)}: () => import(${JSON.stringify(`./sample-${s.id}.mjs`)}).then((m) => m.default),`).join("\n") +
      `\n};\n`,
  );
  log(`samples: ${index.length} from ${SAMPLE_REPO}, ${copied.size} file(s), ${first.files.length} in the bundle`);
  writeLessons(catalogue);
}

// The lessons the playground steps through (src/shell/learn-path.mjs): the
// first stage of that repository's learning path - "Start here", which its
// own blurb calls "the ones to read first, in order" - and only that one.
// The later stages are topics whose entries are grouped by category rather
// than ordered, so "Lesson 34 of 129" would be a number with no teaching
// behind it. The order is the catalogue's own; nothing is sorted here.
//
// A file of its own rather than more fields in index.json: half of the
// lessons are not carried by the page (they open over `?src=`), and the
// path is read by a chunk the shell asks for after boot, not by the shell.
// Each lesson carries its raw URL, made here by the samples browser's own
// template (catalogue-urls.mjs), so the page has no second copy of it.
// A catalogue with no learning path writes an empty list, and the page then
// shows no lesson bar - it is a guide, not something to fail a build over.
function writeLessons(catalogue) {
  const stage = (catalogue.learningPath || [])[0];
  const sources = [{ id: "learn", repo: SAMPLE_REPO }];
  const lessons = stage
    ? (catalogue.samples || [])
        .filter((s) => s.stage === stage.id && typeof s.class === "string")
        .map((s) => ({
          class: s.class.toLowerCase(),
          title: String(s.title || s.class),
          raw: rawUrlOf({ source: "learn", file: s.file }, sources),
        }))
        .filter((l) => l.raw !== undefined)
    : [];
  fs.writeFileSync(
    path.join(BUILD_SAMPLES, "lessons.json"),
    JSON.stringify({ stage: stage ? String(stage.title || stage.id) : "", repo: SAMPLE_REPO, lessons }, null, 2) + "\n",
  );
  log(`samples: ${lessons.length} lesson(s) on the learning path`);
}

writeSamples();

// The page bundle, in pieces: assets/shell.mjs is what every page starts
// with - the shell - and what only some pages need, or need later, comes as
// chunks of its own, which esbuild splits off wherever the source says
// import( ): Monaco (src/editor/monaco-editor.mjs, which an app-only page
// never fetches - see src/editor/editor.mjs), Monaco's own ABAP grammar, the
// two AI chunks. abaplint, the transpiler and the
// abap2UI5 linter are in the registry worker's bundle above. What is split
// off downloads during the parse, where the network is idle, and is
// evaluated when it lands. The chunks carry a hash in their name, so the
// service worker's precache list and the build id are written from the
// directory rather than from a fixed list - see writeServiceWorker( ) in
// tools/service-worker.mjs.
//
// `result` is the page build's metafile - what writeIndex( ) and
// writeServiceWorker( ) read the chunk names off - and buildPage( ) is the
// one of the four that answers with it.
async function buildPage() {
  return esbuild.build({
    entryPoints: [{ in: path.join(SHELL, "main.mjs"), out: "shell" }],
    outdir: ASSETS,
    outExtension: { ".js": ".mjs" },
    splitting: true,
    chunkNames: "[name]-[hash]",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    // No keepNames here any more: it was for abaplint, which identifies some of
    // its own node types by class name - and abaplint has left this bundle for
    // the registry worker (which keeps it). Nothing left here (Monaco, the
    // abap2UI5 linter, the SDK, the shell) goes by a class's name, and the
    // renaming wrappers were 145 KB of the page's JavaScript, 36 KB brotli.
    // 20 MB of source map, a sixth of the published site, that only a browser
    // with devtools open ever fetches - and anyone debugging the playground has
    // the sources anyway. PG_DEBUG=1 builds it, the same switch the framework
    // bundle uses.
    sourcemap: process.env.PG_DEBUG === "1",
    logLevel: "warning",
    metafile: true,
    // assets/shell.css is the shell's own stylesheet and nothing else: main.mjs
    // imports src/shell/shell.css, and esbuild writes it beside the bundle.
    // Monaco pulls its own eighty stylesheets in through the module graph,
    // and esbuild would fold those into shell.css too - CSS reached through a
    // dynamic import( ) goes to the entry's stylesheet, since nothing loads a
    // chunk's CSS at run time - so monacoCssPlugin keeps them out of the
    // graph and buildMonacoCss( ) below bundles them as a stylesheet of their
    // own, with the icon font copied out beside it under a hashed name.
    // The ABAP of the samples
    // the page carries is inlined into the bundle as text. They are real .clas.abap
    // files, copied out of the pinned abap2UI5/samples by writeSamples( ) above
    // into build/samples/, and reached through the import module it writes there
    // - see src/editor/samples.mjs, which is the only importer.
    //
    // `.md` is text for one importer: src/shell/ai-agent.mjs, the chat's chunk,
    // which carries abap2UI5's own guide to building an app
    // (deps/abap2ui5/docs/agents/building-apps.md, at the pinned commit) as the
    // model's instructions.
    loader: { ".ttf": "file", ".abap": "text", ".md": "text" },
    // ...and Inter is NOT one of the things this bundle carries. The two urls in
    // shell.css point at `../fonts/`, which from the stylesheet's place in the
    // build (`assets/shell.css`) is `dist/fonts/` - the one copy the catalogue's
    // stylesheet reaches by the same relative path. Left external so the url
    // survives verbatim; bundled, esbuild would copy the file a second time,
    // beside this bundle and under a hashed name, and the two documents would
    // then fetch two identical fonts.
    external: ["*.woff2"],
    // The linter plugin goes first: it claims `fs` and `path` for the abap2UI5
    // linter alone, and leaves every other importer to the ordinary stubs.
    plugins: [abap2ui5LinterPlugin(ROOT), monacoCssPlugin(ROOT), nodeStubPlugin(ROOT)],
    // No Buffer shim either: it was injected for abaplint, which now runs in the
    // registry worker (the shim is injected there). What is left on the page
    // reaches for Buffer only behind a typeof check, so the shim was a 31 KB
    // chunk, modulepreloaded and evaluated at every start, that nothing used.
  });
}

// The sample catalogue page's bundles - see the catalogue section below for
// what they are; this is only the esbuild call, so it can run beside the
// other three.
async function buildCatalogue() {
  await esbuild.build({
    entryPoints: [
      { in: path.join(ROOT, "src", "catalogue", "catalogue.mjs"), out: "catalogue" },
      { in: path.join(ROOT, "src", "catalogue", "search-entry.mjs"), out: "search" },
      { in: path.join(ROOT, "src", "catalogue", "page-entry.mjs"), out: "page" },
    ],
    outdir: path.join(DIST, "samples"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    sourcemap: process.env.PG_DEBUG === "1",
    logLevel: "warning",
  });
}

// All four at once. `all` rather than `allSettled`: esbuild writes a bundle
// only when it finished, so a build that failed left nothing half-written
// for the others to trip over, and the first failure is the one to read.
const [result] = await Promise.all([buildPage(), buildRegistry(), buildLinter(), buildCatalogue()]);
// The page build's metafile, kept for check-size.mjs and the tests - written
// now, so a failure further down leaves the file that describes this build
// rather than the one before it.
fs.writeFileSync(path.join(ROOT, "build", "site.metafile.json"), JSON.stringify(result.metafile));

// Monaco's stylesheet, as a file of its own: assets/monaco-editor-<hash>.css.
// The page build above left Monaco's CSS imports out of the bundle
// (monacoCssPlugin in tools/esbuild-plugins.mjs says why: esbuild folded
// them into assets/shell.css on every page, the app-only ones included) and
// left each as an empty module the metafile still records). This walks the
// graph for them, in esbuild's own order, and bundles the real files in that
// order, minified, with the icon font copied
// out beside it the way the page build used to. The name goes into
// index.html's inline script, which links it on every page that will show
// the editor (writeIndex), and into the service worker's precache
// (writeServiceWorker) - a hashed name, so it needs no CORE hash.
const monacoCss = await buildMonacoCss();
async function buildMonacoCss() {
  /* The stylesheets in the order esbuild would have bundled them: a walk of
     the import graph from Monaco's module, each module's imports in the
     order they are written, each stylesheet the first time it is reached -
     which is what esbuild does with CSS reached from JavaScript, and was
     checked against the order it had used while the CSS was still in the
     bundle. The stubs are empty modules and so appear in the metafile's
     inputs, not in any output's. */
  const inputs = result.metafile.inputs;
  const seen = new Set();
  const files = [];
  const walk = (module) => {
    if (seen.has(module)) return;
    seen.add(module);
    for (const { path: to, kind, external } of inputs[module]?.imports ?? []) {
      if (external) continue;
      if (to.startsWith(`${MONACO_CSS}:`)) {
        const file = to.slice(MONACO_CSS.length + 1);
        if (!files.includes(file)) files.push(file);
      } else if (kind === "import-statement") {
        walk(to);
      }
    }
  };
  walk("src/editor/monaco-editor.mjs");
  if (files.length === 0) {
    console.error("build-site: ERROR Monaco's chunk imports no stylesheet - did monacoCssPlugin stop matching?");
    process.exit(1);
  }
  const css = await esbuild.build({
    stdin: {
      contents: files.map((f) => `@import ${JSON.stringify(f)};`).join("\n"),
      resolveDir: ROOT,
      loader: "css",
    },
    outdir: ASSETS,
    entryNames: "monaco-editor-[hash]",
    bundle: true,
    minify: true,
    logLevel: "warning",
    metafile: true,
    loader: { ".ttf": "file" },
  });
  const out = Object.keys(css.metafile.outputs).find((o) => o.endsWith(".css"));
  const rel = path.relative(DIST, path.join(ROOT, out)).split(path.sep).join("/");
  log(`${rel} (${kb(path.join(DIST, rel))}, ${files.length} of Monaco's stylesheets)`);
  return rel;
}

writeIndex({ metafile: result.metafile, monacoCss });
// The icons and the app manifest - what a tab, a home screen and an install
// prompt show for this page.
for (const name of ["favicon.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "manifest.webmanifest",
                    /* The card a link to any page of this deployment shows in
                       Slack, LinkedIn or a search result. One image for all 774
                       of them: the alternative is a rendered card per sample,
                       which is 774 images to build and to keep in step with a
                       title that is already in the page. */
                    "og-image.png"]) {
  fs.copyFileSync(path.join(SHELL, name), path.join(DIST, name));
}

// The sample catalogue page: its own document at /samples/, its own small
// bundle. Not part of the shell's entry - a reader who came to look something
// up must not download Monaco and abaplint to do it, and a reader in the
// editor must not carry a page they may never open. The two share
// src/shell/ui5-libs.mjs (which library a control ships in) and the theme key,
// and that sharing is why this is bundled at all rather than copied.
//
// dist/samples/apps.json is written by tools/build-catalogue.mjs, which runs
// before this and owns that directory's data.
//
// The search box is the SECOND entry point here, and its own file on purpose:
// the catalogue loads it and so does every one of the 772 per-sample pages,
// which have no bundle of their own. One module beside them is fetched once
// and cached for every page after it; inlined it would be written 773 times.
// The bundles themselves came out of buildCatalogue( ) above, beside the
// other three; what follows is the document and the stylesheet.
fs.copyFileSync(path.join(ROOT, "src", "catalogue", "catalogue.css"), path.join(DIST, "samples", "catalogue.css"));
writeCatalogueDocument();

/* THE HIGHLIGHTER, PUBLISHED - the file that decides which words in a class
 * are red and which are green, beside the pages it decides it for.
 *
 * It is a build-time module here: tools/sample-pages.mjs calls it and writes
 * the answer into all 772 pages, so nothing on the site loads it. What it is
 * published FOR is the documentation, which prints the same ABAP and now sets
 * it with this file rather than with a scheme of its own - the same borrow the
 * bar and search.mjs already are. Copied rather than bundled: it is one
 * function, it imports nothing, and what the manual should be reading is the
 * file itself. */
fs.copyFileSync(path.join(ROOT, "tools", "abap-highlight.mjs"),
  path.join(DIST, "samples", "abap-highlight.mjs"));
log(`samples/abap-highlight.mjs (${kb(path.join(DIST, "samples", "abap-highlight.mjs"))})`);

/* THE TYPE, ONE COPY FOR THE WHOLE SITE.
 *
 * `dist/fonts/`, because both stylesheets that name Inter sit exactly one
 * directory down - `assets/shell.css` and `samples/catalogue.css` - so the one
 * relative url `../fonts/…` in each of them reaches the same two files. A url
 * in a stylesheet resolves against the STYLESHEET, not against the page, which
 * is why this also works from `/samples/<class>/`, three levels down, without
 * a second copy or an absolute path that would have to know whether the site
 * is at `/` or at `/playground/`.
 *
 * src/fonts/NOTICE.md says which files these are, under which licence, and why
 * they are committed rather than fetched from a font CDN. */
fs.mkdirSync(path.join(DIST, "fonts"), { recursive: true });
for (const name of fs.readdirSync(path.join(ROOT, "src", "fonts"))) {
  if (!name.endsWith(".woff2")) continue;
  fs.copyFileSync(path.join(ROOT, "src", "fonts", name), path.join(DIST, "fonts", name));
  log(`fonts/${name} (${kb(path.join(DIST, "fonts", name))})`);
}
log(`samples/catalogue.mjs (${kb(path.join(DIST, "samples", "catalogue.mjs"))})`);
log(`samples/page.mjs (${kb(path.join(DIST, "samples", "page.mjs"))}) - the sample pages' memory, outline and line numbers, one module for all of them`);
log(`samples/search.mjs (${kb(path.join(DIST, "samples", "search.mjs"))})`);

// A same-origin ABAP file, so ?src= can be exercised without depending on
// somebody else's host being up. It is also the smallest possible worked
// example for anyone wondering what a linkable file looks like.
fs.mkdirSync(path.join(DIST, "examples"), { recursive: true });
for (const name of fs.readdirSync(path.join(ROOT, "src", "examples"))) {
  fs.copyFileSync(path.join(ROOT, "src", "examples", name), path.join(DIST, "examples", name));
}

// The embedding kit: the loader a documentation page includes, and the page
// that demonstrates it. Copied rather than bundled - it is a plain script that
// somebody else's site includes with a <script src>, so it has to stay one
// readable file with no build step behind it.
fs.mkdirSync(path.join(DIST, "embed"), { recursive: true });
for (const name of fs.readdirSync(path.join(ROOT, "src", "embed"))) {
  fs.copyFileSync(path.join(ROOT, "src", "embed", name), path.join(DIST, "embed", name));
}

log(`shell.mjs (${kb(path.join(ASSETS, "shell.mjs"))}), shell.css (${kb(path.join(ASSETS, "shell.css"))})`);
for (const chunk of chunks()) log(`${path.basename(chunk)} (${kb(path.join(DIST, chunk))})`);

// Fail loudly rather than publish a page whose two halves are missing - the
// symptom would otherwise be a blank frame and a 404 in the console.
for (const required of ["runtime/framework.mjs", "runtime/sql-wasm.wasm", "app/index.html"]) {
  if (!fs.existsSync(path.join(DIST, required))) {
    console.error(`build-site: ERROR dist/${required} is missing - run the full build (npm run build)`);
    process.exit(1);
  }
}

writeServiceWorker({ metafile: result.metafile, monacoCss });

log("dist/ complete");
