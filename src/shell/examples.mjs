// The examples browser: what the sample repositories hold, listed and
// searchable, one click from running here.
//
// The repositories each commit a machine-readable catalogue.json at their root
// (abap2UI5/samples lists its learning path, abap2UI5/samples-controls its
// ports of the UI5 demo kit). This module fetches those catalogues from
// raw.githubusercontent.com - a host ?src= already trusts (deep-link.mjs) -
// and turns each entry into the raw URL of its class, which then travels the
// exact loading path a ?src= link travels. There is one loader in this
// playground, and this is a menu in front of it, not a second one.
//
// Nothing is fetched until the button is clicked. Partly because a page should
// not spend requests on a menu nobody opened - but mostly because a catalogue
// that is not there answers 404, the browser writes its own line to the console
// for that, and the promise everywhere else is a page that loads clean. When a
// catalogue cannot be had (not published yet, offline, malformed), the browser
// degrades without a word to what is always here: the built-in samples,
// searchable. No error, no console noise of this module's making.
//
// Not every catalogued sample runs in the playground - the transpiler has
// limits and z2ui5.cc custom controls are not on board. The two checkers and
// Run are the judge of that, exactly as they are for typed code; the one
// filter applied here is the cheap, certain one: samples-controls entries
// whose library the site does not carry (see ui5-libraries.mjs), and its
// src/03 collection, which is SAPUI5-only by definition.
import { SAMPLES } from "../editor/samples.mjs";
import { readStoredJson, writeStoredJson } from "./storage.mjs";
import { UI5_LIBRARIES } from "./ui5-libraries.mjs";

// A day: long enough that browsing costs one request per repository and short
// enough that a merged sample shows up tomorrow.
const TTL = 24 * 60 * 60 * 1000;
const cacheKey = (repo) => `abap2ui5-playground:catalogue:${repo}`;

const CATALOGUES = [
  { repo: "abap2UI5/samples", read: readSamples },
  { repo: "abap2UI5/samples-controls", read: readControls },
];

const str = (v) => (typeof v === "string" ? v : "");

// A path from a catalogue becomes a URL under its repository - and only a
// plain, relative one does. deep-link.mjs checks the host and the file name
// again on its own; this check is about not letting a catalogue point the
// playground somewhere the catalogue's repository is not.
function rawUrl(repo, file) {
  if (!/^[\w./-]+\.clas\.abap$/.test(file) || file.startsWith("/") || file.includes("..")) return undefined;
  return `https://raw.githubusercontent.com/${repo}/main/${file}`;
}

// abap2UI5/samples: `samples[]`, each with a learning-path `stage`, and
// `learningPath[]` naming the stages in reading order. The groups here are
// those stages; a stage the path does not name still gets listed, under its
// own id, because hiding an entry over its label would be silly.
function readSamples(repo, data) {
  if (!Array.isArray(data?.samples)) return [];
  const path = Array.isArray(data.learningPath) ? data.learningPath : [];
  const groups = new Map();
  const groupFor = (stage) => {
    if (!groups.has(stage)) {
      const named = path.find((p) => str(p?.id) === stage);
      groups.set(stage, { title: str(named?.title) || stage, blurb: str(named?.blurb), entries: [] });
    }
    return groups.get(stage);
  };
  // Seeded in path order, so the groups keep the reading order even though the
  // entries arrive grouped by whatever order the catalogue lists them in.
  for (const stage of path) if (str(stage?.id)) groupFor(str(stage.id));

  for (const sample of data.samples) {
    const url = rawUrl(repo, str(sample?.file));
    if (url === undefined) continue;
    const entry = {
      title: str(sample.title) || str(sample.class),
      note: str(sample.description) || str(sample.summary),
      who: str(sample.class),
      url,
    };
    const keywords = Array.isArray(sample.keywords) ? sample.keywords.join(" ") : str(sample.keywords);
    entry.haystack = `${entry.title} ${entry.note} ${str(sample.summary)} ${entry.who} ${keywords}`.toLowerCase();
    groupFor(str(sample.stage) || "more").entries.push(entry);
  }
  return [...groups.values()].filter((g) => g.entries.length > 0);
}

// abap2UI5/samples-controls: `ports[]`, one per UI5 demo kit sample, grouped
// here by the library the control lives in. Two kinds are left out rather
// than offered and watched fail: src/03 is the SAPUI5-only collection, and a
// port whose library is not built into this site names controls that cannot
// load - no checker needed to know that.
function readControls(repo, data) {
  if (!Array.isArray(data?.ports)) return [];
  const carried = new Set(UI5_LIBRARIES);
  const groups = new Map();
  for (const port of data.ports) {
    const library = str(port?.library);
    if (str(port?.category) === "src/03" || !carried.has(library)) continue;
    const url = rawUrl(repo, str(port.file));
    if (url === undefined) continue;
    const entry = {
      title: str(port.title) || str(port.entity) || str(port.class),
      note: str(port.summary),
      who: str(port.class),
      url,
    };
    entry.haystack =
      `${entry.title} ${entry.note} ${entry.who} ${str(port.entity)} ${str(port.sample)} ${str(port.keywords)}`.toLowerCase();
    if (!groups.has(library)) groups.set(library, { title: `Controls — ${library}`, blurb: "", entries: [] });
    groups.get(library).entries.push(entry);
  }
  return [...groups.keys()]
    .sort()
    .map((library) => groups.get(library))
    .filter((g) => g.entries.length > 0);
}

// The raw catalogue, from localStorage within the day or from the network, and
// undefined where there is none to be had. The misses are cached like the
// hits: today the catalogues' pull requests are still open and 404 is the
// normal answer, so without this every open would re-ask a question whose
// answer is not changing before tomorrow.
async function loadCatalogue(repo) {
  const stored = readStoredJson(cacheKey(repo));
  if (stored && typeof stored.at === "number" && Date.now() - stored.at < TTL) return stored.data;

  let data;
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/main/catalogue.json`);
    if (response.ok) data = await response.json();
  } catch {
    // Offline, refused, or an answer that is not JSON - all the same: no
    // catalogue today, and no error either. The built-ins carry the menu.
  }
  // A cache that cannot be written only makes tomorrow's open slower.
  writeStoredJson(cacheKey(repo), { at: Date.now(), data });
  return data;
}

let dialog;
let body;
let search;
let callbacks;
let started = false;
let loading = false;

// The always-there group: the same nine the Sample menu offers, so the browser
// has something to search and to open even when no catalogue can be reached.
const builtIn = {
  title: "Built in",
  blurb: "The Sample menu, searchable. These live in the page and need no network.",
  entries: SAMPLES.map((sample) => ({
    title: sample.title,
    note: sample.note,
    who: "built in",
    haystack: `${sample.title} ${sample.note}`.toLowerCase(),
    sampleId: sample.id,
  })),
};

// One slot per catalogue, filled as each answers, so the samples repository
// keeps its place above the controls even when the answers cross on the wire.
const loadedGroups = CATALOGUES.map(() => []);

export function setUpExamples(handlers) {
  callbacks = handlers;
  dialog = document.getElementById("examples-dialog");
  body = document.getElementById("examples-body");
  search = document.getElementById("examples-search");

  search.addEventListener("input", () => render());
  // A click on the backdrop closes it, the way a modal is expected to.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}

export function openExamples() {
  if (!dialog) return;
  if (!started) {
    started = true;
    loading = true;
    Promise.all(
      CATALOGUES.map(async (catalogue, i) => {
        const data = await loadCatalogue(catalogue.repo);
        try {
          loadedGroups[i] = data === undefined ? [] : catalogue.read(catalogue.repo, data);
        } catch {
          // A catalogue in a shape this module does not know is treated like a
          // missing one - the next deploy of the playground can learn it.
          loadedGroups[i] = [];
        }
        render();
      }),
    ).then(() => {
      loading = false;
      render();
    });
  }
  render();
  // Nothing here defends the focus this takes, and that is not an oversight:
  // the app frame is what takes it away - UI5 focuses a control as a render
  // settles, in a document showModal() has no reach into. It is stopped at the
  // source, in src/shell/frontend-bridge.js, because a search box that gets
  // the focus back after the typing has gone to the app is still empty.
  dialog.showModal();
  search.select();
}

function render() {
  if (!body) return;
  const needle = search.value.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  let shown = 0;

  for (const group of [builtIn, ...loadedGroups.flat()]) {
    const entries = needle === "" ? group.entries : group.entries.filter((e) => e.haystack.includes(needle));
    if (entries.length === 0) continue;
    shown += entries.length;

    const head = document.createElement("h3");
    head.className = "examples-group";
    head.textContent = group.title;
    frag.append(head);
    if (group.blurb !== "") {
      const blurb = document.createElement("p");
      blurb.className = "examples-blurb";
      blurb.textContent = group.blurb;
      frag.append(blurb);
    }

    const list = document.createElement("ul");
    list.className = "insight-list";
    for (const entry of entries) list.append(row(entry));
    frag.append(list);
  }

  if (loading) {
    const note = document.createElement("p");
    note.className = "insight-empty";
    note.textContent = "looking in the sample repositories…";
    frag.append(note);
  } else if (shown === 0) {
    const note = document.createElement("p");
    note.className = "insight-empty";
    note.textContent = "Nothing here matches that.";
    frag.append(note);
  }

  body.replaceChildren(frag);
}

// One entry. The row is a button inside its list item rather than a list item
// with a click handler on it: this is the only way into the examples for
// somebody who is not using a mouse, and a <li> is not focusable, not in the
// tab order and does not answer Enter or Space.
function row(entry) {
  const item = document.createElement("li");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "insight-row example-row";

  const title = document.createElement("span");
  title.className = "example-title";
  title.textContent = entry.title;

  const note = document.createElement("span");
  note.className = "insight-what example-note";
  note.textContent = entry.note;

  const who = document.createElement("span");
  who.className = "insight-who";
  who.textContent = entry.who;

  button.append(title, note, who);
  button.addEventListener("click", () => {
    dialog.close();
    if (entry.sampleId !== undefined) callbacks.openSample(entry.sampleId);
    else callbacks.openLinked(entry.url);
  });
  item.append(button);
  return item;
}
