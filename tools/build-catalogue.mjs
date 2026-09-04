// The sample catalogue's index: dist/samples/apps.json.
//
// Three repositories publish two committed files each - catalogue.json, what
// their tree holds, and catalogue-derived.json, what the abap2UI5 linter knows
// about each class (every control it BUILDS, the minimum UI5 release that
// implies). This step fetches all six, joins each pair on `class`, and writes
// ONE index the catalogue page reads from its own origin.
//
// WHY AT BUILD TIME, when the examples dialog fetches the same catalogues at
// run time and always has. Because the page is meant to be FOUND. A page whose
// content arrives from another host after a click is invisible to a search
// engine and has nothing to link to; the three repository pages this replaces
// each shipped their index beside themselves, and losing that would have made
// "one page instead of three" a quiet way of having none. So the index is
// same-origin, written here, and the page needs no third-party request at all.
//
// The dialog reads this same file now (src/shell/examples.mjs). One list, one
// shape, one place it can be wrong.
//
// DEGRADES, in both halves and per repository:
//   - no catalogue.json  -> that repository contributes nothing, and `sources`
//     says so, because a source silently missing from a catalogue is worse
//     than one that says it could not be read.
//   - no catalogue-derived.json -> its samples are listed with the facts the
//     tree carries and without the derived ones: no control list, no release
//     above the floor. That is the state between merging this and merging the
//     three repository changes, and it must not be a failed build.
// A build with no catalogue at all is still a build: the page says the
// catalogue could not be fetched, which is the honest thing for it to say, and
// the playground itself does not depend on any of this.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { UI5_LIBRARIES, UI5_VERSION } from "../src/shell/ui5-libraries.mjs";
import { cmpVersion, isCarried, isSapui5Only, libraryOf } from "../src/shell/ui5-libs.mjs";
import { writeSamplePages } from "./sample-pages.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "samples", "apps.json");
const CACHE = path.join(ROOT, "build", "catalogues");

const log = (m) => console.log(`build-catalogue: ${m}`);

/* The playground's own floor, and the highest release its build can render.
 * A sample needing more than UI5_VERSION would not render here whatever else
 * is true of it. */
const MIN_UI5 = "1.71";

const SOURCES = [
  {
    id: "learn",
    repo: "abap2UI5/samples",
    title: "Learn",
    blurb: "The path through abap2UI5 itself, one idea per sample.",
    read: readLearn,
  },
  {
    id: "controls",
    repo: "abap2UI5/samples-controls",
    title: "Controls",
    blurb: "The UI5 demo kit rebuilt in ABAP, one port per sample.",
    read: readControls,
  },
  {
    id: "stack",
    repo: "abap2UI5/samples-stack",
    title: "Stack",
    blurb: "abap2UI5 with OData, RAP, WebSockets or the launchpad - every one of them needs a real system.",
    read: readStack,
  },
];

const str = (v) => (typeof v === "string" ? v : "");
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : str(v) ? str(v).split(/\s+/) : []);

/* A path out of a catalogue becomes a URL under its own repository, and only a
 * plain relative one does. The playground's own loader checks the host and the
 * file name again (src/shell/deep-link.mjs); this check is about not letting a
 * catalogue point anywhere its repository is not. */
function urls(repo, file, branch = "main") {
  if (!/^[\w./-]+\.clas\.abap$/.test(file) || file.startsWith("/") || file.includes("..")) return undefined;
  if (!/^[\w.-]+$/.test(branch)) return undefined;
  return {
    raw: `https://raw.githubusercontent.com/${repo}/${branch}/${file}`,
    github: `https://github.com/${repo}/blob/${branch}/${file}`,
  };
}

/* One fetch, cached on disk for a day. The cache is for the dozen local
 * rebuilds somebody does while working on the page, not for CI: a fresh
 * runner has no build/ at all, so a deploy always fetches. `--fresh` forces
 * it here too. */
async function fetchJson(repo, name) {
  const url = `https://raw.githubusercontent.com/${repo}/main/${name}`;
  const cached = path.join(CACHE, `${repo.replace("/", "-")}-${name}`);
  const fresh = process.argv.includes("--fresh");
  if (!fresh && fs.existsSync(cached) && Date.now() - fs.statSync(cached).mtimeMs < 24 * 60 * 60 * 1000) {
    try {
      return JSON.parse(fs.readFileSync(cached, "utf8"));
    } catch {
      // A half-written cache file is not an error, it is a re-fetch.
    }
  }
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const text = await response.text();
    const data = JSON.parse(text);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(cached, text);
    return data;
  } catch {
    /* Offline, refused, or an answer that is not JSON. A stale cache beats
     * nothing at all - the page would rather be a day old than empty. */
    if (fs.existsSync(cached)) {
      try {
        return JSON.parse(fs.readFileSync(cached, "utf8"));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/* ------------------------------------------------------------ the readers */

// abap2UI5/samples: samples[] with a learning-path `stage`, and learningPath[]
// naming the stages in reading order. The order is the repository's own
// teaching decision, so it travels with the entries rather than being sorted
// over again here.
function readLearn(source, data) {
  const entries = [];
  for (const sample of data.samples || []) {
    const link = urls(source.repo, str(sample.file));
    if (link === undefined) continue;
    entries.push({
      source: source.id,
      class: str(sample.class),
      title: str(sample.title) || str(sample.class),
      note: str(sample.description) || str(sample.summary),
      summary: str(sample.summary),
      group: str(sample.category),
      stage: str(sample.stage),
      keywords: list(sample.keywords),
      docs: list(sample.docs),
      ...link,
    });
  }
  const path_ = (data.learningPath || []).map((s) => ({
    id: str(s.id),
    title: str(s.title),
    blurb: str(s.blurb),
  }));
  return { entries, stages: path_ };
}

// abap2UI5/samples-controls: ports[], one per demo kit sample. Two of its
// categories are facts the page needs: src/02 is what needs a UI5 newer than
// the floor, src/03 the SAPUI5-only collection that has no OpenUI5 original
// and cannot render here at all.
function readControls(source, data) {
  const entries = [];
  for (const port of data.ports || []) {
    const link = urls(source.repo, str(port.file));
    if (link === undefined) continue;
    entries.push({
      source: source.id,
      class: str(port.class),
      title: str(port.title) || str(port.entity) || str(port.class),
      note: str(port.summary),
      summary: str(port.summary),
      group: str(port.library),
      entity: str(port.entity),
      sample: str(port.sample),
      collection: str(port.category) === "src/03",
      keywords: list(port.keywords),
      ...link,
    });
  }
  return { entries, stages: [] };
}

// abap2UI5/samples-stack: samples[], each delivered on a one-package branch of
// its own. None of them runs here - every one needs a real system, which is
// the whole point of that repository - so `needs` is what the row says
// instead, and it is the one fact that decides whether a reader can use it.
function readStack(source, data) {
  const entries = [];
  for (const sample of data.samples || []) {
    /* The overview app is not a sample: it is this same catalogue INSIDE a
     * system, and as a row it contradicts the list around it - "needs nothing
     * beyond abap2UI5" on a page whose stack rows are all about what a system
     * must have, plus a technology of its own that filters ten groups down to
     * one. Its own repository leaves it off its listings for exactly that
     * reason. The repositories are linked from the footer, where somebody
     * looking for it will look. */
    if (str(sample.technology) === "Overview") continue;
    const branch = str(sample.branch) || "main";
    const link = urls(source.repo, str(sample.path), branch);
    if (link === undefined) continue;
    entries.push({
      source: source.id,
      class: str(sample.class).toLowerCase(),
      title: str(sample.title) || str(sample.class),
      note: str(sample.summary),
      summary: str(sample.summary),
      group: str(sample.technology) || "Stack",
      keywords: list(sample.keywords),
      system: str(sample.needs),
      runsOn: str(sample.runsOn),
      cloud: sample.cloud === true,
      branch,
      ...link,
    });
  }
  return { entries, stages: [] };
}

/* ------------------------------------------------------------------ build */

const controlIds = new Map();
const idOf = (name) => {
  if (!controlIds.has(name)) controlIds.set(name, controlIds.size);
  return controlIds.get(name);
};

const entries = [];
const sources = [];
const stages = [];

for (const source of SOURCES) {
  const [catalogue, derived] = await Promise.all([
    fetchJson(source.repo, "catalogue.json"),
    fetchJson(source.repo, "catalogue-derived.json"),
  ]);

  if (catalogue === undefined) {
    log(`${source.repo}: no catalogue.json - listed as unavailable`);
    sources.push({ id: source.id, repo: source.repo, title: source.title, blurb: source.blurb, ok: false, count: 0 });
    continue;
  }

  let read;
  try {
    read = source.read(source, catalogue);
  } catch (err) {
    log(`${source.repo}: catalogue.json is in a shape this build does not know (${err.message}) - skipped`);
    sources.push({ id: source.id, repo: source.repo, title: source.title, blurb: source.blurb, ok: false, count: 0 });
    continue;
  }

  /* The derived half, keyed the way its own repository keys it. `class` is
   * the join, and samples-stack spells it in upper case in both files, so it
   * is lowercased on both sides rather than in one of them. */
  const facts = new Map();
  const dictionary = (derived?.controls || []).map(String);
  for (const row of derived?.ports || derived?.samples || []) {
    facts.set(str(row.class).toLowerCase(), row);
  }
  if (derived === undefined) {
    log(`${source.repo}: no catalogue-derived.json yet - listed without controls or release`);
  }

  for (const entry of read.entries) {
    const fact = facts.get(entry.class.toLowerCase());
    /* The dictionary index is per repository; this index is over all three,
     * so every name is re-registered here. */
    const controls = (fact?.controls || [])
      .map((i) => dictionary[i])
      .filter(Boolean);
    const libraries = [...new Set(controls.map(libraryOf))].sort();
    const minUi5 = str(fact?.minUi5) || MIN_UI5;

    /* Three separate reasons a sample does not run in this page, and the row
     * says which: a system it needs and this page is not, a library only
     * SAPUI5 has, a library this build does not carry. A sample whose
     * controls are unknown (no derived file) is offered - the checkers and
     * Run are the judge of typed code too, and refusing to list something
     * because a second file has not merged yet would be the worst of both. */
    const sapui5 = entry.collection === true || libraries.some(isSapui5Only);
    const missing = libraries.filter((l) => !isCarried(l));
    /* `needs` is a badge - three words, so a card stays a card. What it needs
     * in full is `needsDetail`, which the page hangs off the badge as its
     * title: a stack sample's prerequisite is a sentence, and a sentence in a
     * badge wraps a card to twice the height of its neighbours. */
    let needs;
    let needsDetail;
    if (entry.source === "stack") {
      needs = "needs a system";
      needsDetail = entry.system || undefined;
    } else if (sapui5) {
      needs = "needs SAPUI5";
      needsDetail = libraries.filter(isSapui5Only).join(", ") || undefined;
    } else if (missing.length) {
      needs = missing.length === 1 ? `needs ${missing[0]}` : `needs ${missing.length} libraries`;
      needsDetail = missing.join(", ");
    } else if (cmpVersion(minUi5, UI5_VERSION) > 0) {
      needs = `needs UI5 ${minUi5}`;
      needsDetail = `this site runs UI5 ${UI5_VERSION}`;
    }

    entries.push({
      ...entry,
      collection: undefined,
      system: undefined,
      controls: controls.map(idOf),
      libraries,
      minUi5,
      needs: needs || undefined,
      needsDetail,
      runs: needs === undefined,
      /* What made it that release - so a filtered list can be argued with
       * rather than only believed. */
      since: (fact?.needs || []).map((n) => ({ name: str(n.name), since: str(n.since) })),
      /* Not view code at all: the backend half of a stack story, or a class
       * the linter found no chain in. Different from "builds no controls". */
      noChain: fact?.noChain === true || undefined,
    });
  }

  for (const stage of read.stages) stages.push({ ...stage, source: source.id });
  sources.push({
    id: source.id,
    repo: source.repo,
    title: source.title,
    blurb: source.blurb,
    ok: true,
    derived: derived !== undefined,
    count: read.entries.length,
  });
  log(`${source.repo}: ${read.entries.length} samples${derived === undefined ? " (no derived facts)" : ""}`);
}

const controls = [...controlIds.keys()];
const releases = [...new Set(entries.map((e) => e.minUi5))].sort(cmpVersion);
const libraries = [...new Set(entries.flatMap((e) => e.libraries))].sort();

const index = {
  note: "Generated by tools/build-catalogue.mjs from the six committed catalogues. Not committed.",
  built: new Date().toISOString(),
  ui5: UI5_VERSION,
  minUi5: MIN_UI5,
  carries: UI5_LIBRARIES,
  sources,
  stages,
  releases,
  libraries,
  /* One dictionary over all three corpora: the same control names would
   * otherwise be repeated some hundreds of times. */
  controls,
  entries,
};

/* The pages that index implies: one per sample, the full list, the sitemap.
 * Same data, same moment - see tools/sample-pages.mjs for why a catalogue that
 * is one JavaScript-rendered URL is a catalogue no search engine can return a
 * sample from. It runs BEFORE the index is written because it stamps `page`
 * on every entry it made a page for: which entries get one is its rule (a
 * class name that is a class name, a source URL that is https), and the
 * catalogue page and the dialog link to what it actually wrote rather than
 * repeating that rule and drifting from it.
 *
 * It is also the second thing in this build that talks to the network: the
 * pages print the ABAP itself, and tools/sample-sources.mjs fetches it one
 * tarball per ref. That fetch degrades exactly like the six above - a ref that
 * does not arrive costs its samples their code block and nothing else. */
await writeSamplePages(index, path.join(ROOT, "dist"));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
/* Undefined values drop out of JSON.stringify on their own, which is what the
 * `undefined`s above are for - a row carries a key only when it means
 * something. */
fs.writeFileSync(OUT, `${JSON.stringify(index)}\n`);

const size = (fs.statSync(OUT).size / 1024).toFixed(0);
log(
  `${entries.length} samples from ${sources.filter((s) => s.ok).length}/${SOURCES.length} repositories, `
  + `${controls.length} controls, ${libraries.length} libraries, `
  + `${entries.filter((e) => e.runs).length} runnable here -> dist/samples/apps.json (${size} KB)`,
);
