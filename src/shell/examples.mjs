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
// Run are the judge of that, exactly as they are for typed code. What can be
// known for certain is said on the row instead of hidden: a port whose
// library the site does not carry (see ui5-libraries.mjs) or from the SAPUI5-
// only src/03 collection "needs SAPUI5", a sample from abap2UI5/samples-stack
// "needs a system" - both are listed, because this browser is where the
// repositories' own pages used to be and a sample somebody cannot find is
// worse than one they cannot run - and both open for reading rather than
// running. The filters beside the search (source, runtime, release) are how
// the list is cut down to what one is looking for; every one starts on.
import { SAMPLES } from "../editor/samples.mjs";
import { deleteDraft, draftNameProblem, listDrafts, saveDraft } from "./drafts.mjs";
import { readStoredJson, writeStoredJson } from "./storage.mjs";
import { UI5_LIBRARIES } from "./ui5-libraries.mjs";

// The filters, as the checkboxes in the dialog's head name them - see
// index.html: the three repositories (on), "OpenUI5 only" (off - it narrows,
// and the list is meant to be everything until somebody says otherwise), and
// "newer than 1.71" (on - off, it hides what needs a UI5 newer than the
// floor). Kept between visits: somebody who only ever wants what runs here
// on OpenUI5 should not have to say so every time.
const FILTERS_KEY = "abap2ui5-playground:samples-filters";
const FILTERS = ["learn", "controls", "stack", "openui5only", "newer"];
let filters = { learn: true, controls: true, stack: true, openui5only: false, newer: true };

// A day: long enough that browsing costs one request per repository and short
// enough that a merged sample shows up tomorrow.
const TTL = 24 * 60 * 60 * 1000;
const cacheKey = (repo) => `abap2ui5-playground:catalogue:${repo}`;

const CATALOGUES = [
  { repo: "abap2UI5/samples", read: readSamples },
  { repo: "abap2UI5/samples-controls", read: readControls },
  { repo: "abap2UI5/samples-stack", read: readStack },
];

// Libraries that only SAPUI5 carries - none of them can be in an OpenUI5
// build, so a port that names one needs SAPUI5 whatever else is true of it.
// The site's own list (UI5_LIBRARIES) is what decides "runs here"; this is
// the finer question of why something does not.
const SAPUI5_ONLY = /^(sap\.suite\.|sap\.ui\.comp|sap\.viz|sap\.gantt|sap\.ndc|sap\.ui\.vbm|sap\.ushell|sap\.fe|sap\.ui\.richtexteditor|sap\.ui\.export)/;

const str = (v) => (typeof v === "string" ? v : "");

// A path from a catalogue becomes a URL under its repository - and only a
// plain, relative one does. deep-link.mjs checks the host and the file name
// again on its own; this check is about not letting a catalogue point the
// playground somewhere the catalogue's repository is not.
function rawUrl(repo, file, branch = "main") {
  if (!/^[\w./-]+\.clas\.abap$/.test(file) || file.startsWith("/") || file.includes("..")) return undefined;
  if (!/^[\w.-]+$/.test(branch)) return undefined;
  return `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
}

// The same file as the page a human reads it on - every row links there,
// because the repositories' own pages are gone and this list is where one
// looks a sample up now.
const githubUrl = (repo, file, branch = "main") => `https://github.com/${repo}/blob/${branch}/${file}`;

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
      github: githubUrl(repo, str(sample.file)),
      source: "learn",
      sapui5: false,
      newer: false,
      runs: true,
    };
    const keywords = Array.isArray(sample.keywords) ? sample.keywords.join(" ") : str(sample.keywords);
    entry.haystack = `${entry.title} ${entry.note} ${str(sample.summary)} ${entry.who} ${keywords}`.toLowerCase();
    groupFor(str(sample.stage) || "more").entries.push(entry);
  }
  return [...groups.values()].filter((g) => g.entries.length > 0);
}

// abap2UI5/samples-controls: `ports[]`, one per UI5 demo kit sample, grouped
// here by the library the control lives in. Its categories say two things
// the filters ask about: src/02 is the ports that need a UI5 newer than
// 1.71, src/03 the SAPUI5-only collection. A port whose library is not built
// into this site names controls that cannot load here, so it is offered for
// reading and says what it needs.
function readControls(repo, data) {
  if (!Array.isArray(data?.ports)) return [];
  const carried = new Set(UI5_LIBRARIES);
  const groups = new Map();
  for (const port of data.ports) {
    const library = str(port?.library);
    const category = str(port?.category);
    const url = rawUrl(repo, str(port.file));
    if (url === undefined) continue;
    const sapui5 = category === "src/03" || SAPUI5_ONLY.test(library);
    const runs = carried.has(library) && category !== "src/03";
    const entry = {
      title: str(port.title) || str(port.entity) || str(port.class),
      note: str(port.summary),
      who: str(port.class),
      url,
      github: githubUrl(repo, str(port.file)),
      source: "controls",
      sapui5,
      newer: category === "src/02",
      runs,
      needs: runs ? undefined : sapui5 ? "needs SAPUI5" : `needs ${library}`,
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

// abap2UI5/samples-stack: `samples[]`, each on a delivery branch of its own
// (`branch`, with `path` under it) and grouped by `technology` - OData, RAP,
// WebSockets, the launchpad. None of them runs here: every one needs a real
// system, which is the whole point of that repository. They are listed so
// they can be found, and open for reading; `needs` says what a system has
// to have, and a sample that names SAPUI5 there counts as SAPUI5-only.
function readStack(repo, data) {
  if (!Array.isArray(data?.samples)) return [];
  const groups = new Map();
  for (const sample of data.samples) {
    const url = rawUrl(repo, str(sample?.path), str(sample?.branch) || "main");
    if (url === undefined) continue;
    const technology = str(sample.technology) || "Stack";
    const needs = str(sample.needs);
    const entry = {
      title: str(sample.title) || str(sample.class),
      note: str(sample.summary),
      who: str(sample.class).toLowerCase(),
      url,
      github: githubUrl(repo, str(sample.path), str(sample.branch) || "main"),
      source: "stack",
      sapui5: /sapui5/i.test(needs),
      newer: false,
      runs: false,
      needs: needs ? `needs a system: ${needs}` : "needs a system",
    };
    const keywords = Array.isArray(sample.keywords) ? sample.keywords.join(" ") : str(sample.keywords);
    entry.haystack = `${entry.title} ${entry.note} ${entry.who} ${technology} ${needs} ${keywords}`.toLowerCase();
    if (!groups.has(technology)) groups.set(technology, { title: `Stack — ${technology}`, blurb: "", entries: [] });
    groups.get(technology).entries.push(entry);
  }
  return [...groups.values()].filter((g) => g.entries.length > 0);
}

// Which entries the filters let through. The built-ins are always there:
// they are the page's own and every filter is about the repositories - and
// so are the reader's own drafts.
function passes(entry) {
  if (entry.sampleId !== undefined || entry.draft !== undefined) return true;
  if (!filters[entry.source]) return false;
  if (filters.openui5only && entry.sapui5) return false;
  if (entry.newer && !filters.newer) return false;
  return true;
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

// The always-there group: the built-in samples, which have no other way in -
// there is no sample menu in the bar - so the browser has something to search
// and to open even when no catalogue can be reached.
const builtIn = {
  title: "Built in",
  blurb: "A handful to start from. These live in the page and need no network.",
  entries: SAMPLES.map((sample) => ({
    title: sample.title,
    note: sample.note,
    who: "built in",
    haystack: `${sample.title} ${sample.note}`.toLowerCase(),
    sampleId: sample.id,
    runs: true,
    github: "https://github.com/abap2UI5/playground/blob/main/src/editor/samples.mjs",
  })),
};

// One slot per catalogue, filled as each answers, so the samples repository
// keeps its place above the controls even when the answers cross on the wire.
const loadedGroups = CATALOGUES.map(() => []);

// The reader's own drafts, first in the list: what one saved is what one
// is most likely to be looking for. Read on every render, because saving
// and deleting happen in the same dialog. See src/shell/drafts.mjs.
function draftsGroup() {
  const entries = listDrafts().map((draft) => ({
    title: draft.name,
    note: `${draft.files.map((f) => f.name).join(", ")} · saved ${new Date(draft.at).toLocaleString()}`,
    who: "draft",
    haystack: `${draft.name} ${draft.files.map((f) => f.name).join(" ")}`.toLowerCase(),
    draft,
    runs: true,
  }));
  return {
    title: "Your drafts",
    blurb:
      entries.length === 0
        ? "Nothing saved yet. Name what is in the editor and save it here to come back to it another day."
        : "Saved in this browser. Opening one replaces what is in the editor - the current draft stays one Undo away.",
    entries,
    saveRow: true,
  };
}

// The row that saves what is in the editor: a name, and Save. Enter in the
// input saves too, and it is not inside the dialog's form on purpose -
// there, Enter would close the dialog instead.
function saveRow() {
  const row = document.createElement("div");
  row.className = "drafts-save";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "drafts-name";
  input.placeholder = "name this draft";
  input.setAttribute("aria-label", "Name for the draft");
  input.maxLength = 60;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "drafts-save-button";
  button.textContent = "Save what is open";
  const said = document.createElement("span");
  said.className = "config-said";
  const save = () => {
    const problem = draftNameProblem(input.value);
    if (problem) {
      said.className = "config-said is-error";
      said.textContent = problem;
      input.focus();
      return;
    }
    const kept = saveDraft(input.value, callbacks.currentFiles());
    if (!kept) {
      said.className = "config-said is-error";
      said.textContent = "This browser would not store it.";
      return;
    }
    render();
  };
  button.addEventListener("click", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  });
  row.append(input, button, said);
  return row;
}

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

  // The filters: what was kept from last time, if anything, and every change
  // both re-renders and is kept. A stored value that is not a boolean is
  // ignored rather than trusted.
  const stored = readStoredJson(FILTERS_KEY);
  for (const f of FILTERS) if (typeof stored?.[f] === "boolean") filters[f] = stored[f];
  for (const box of dialog.querySelectorAll("input[data-filter]")) {
    const f = box.dataset.filter;
    box.checked = filters[f] === true;
    box.addEventListener("change", () => {
      filters[f] = box.checked;
      writeStoredJson(FILTERS_KEY, filters);
      render();
    });
  }
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
  let total = 0;

  for (const group of [draftsGroup(), builtIn, ...loadedGroups.flat()]) {
    total += group.entries.length;
    const entries = group.entries.filter((e) => passes(e) && (needle === "" || e.haystack.includes(needle)));
    // The drafts group stays on screen with no drafts in it, because its
    // save row is how the first one gets there - but not while a search is
    // narrowing the list to something else.
    if (entries.length === 0 && !(group.saveRow && needle === "")) continue;
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
    if (group.saveRow) frag.append(saveRow());
    if (entries.length === 0) continue;

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
  // How much the search and the filters let through, so an empty-looking
  // list says whether it is the words or the boxes.
  const count = document.getElementById("examples-count");
  if (count) count.textContent = loading ? "" : `${shown} of ${total}`;
}

// One entry: a button that opens it here, and beside it a link to where it
// lives on GitHub. The button rather than a click handler on the item,
// because this is the only way into the examples for somebody who is not
// using a mouse, and a <li> is not focusable, not in the tab order and does
// not answer Enter or Space. The link is outside the button, because a link
// inside a button is not HTML.
//
// A sample that cannot run here - one that needs a system, or SAPUI5 - is
// listed, says so, and its button is disabled: clicking would only have
// opened code that fails on the first roundtrip. The link beside it is how
// one still gets to it.
function row(entry) {
  const item = document.createElement("li");
  item.className = "example-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "insight-row example-row";
  // The built-ins by id, so a test can pick one without matching its title.
  if (entry.sampleId !== undefined) button.dataset.sample = entry.sampleId;
  if (entry.draft !== undefined) button.dataset.draft = entry.draft.name;

  const title = document.createElement("span");
  title.className = "example-title";
  title.textContent = entry.title;

  const note = document.createElement("span");
  note.className = "insight-what example-note";
  note.textContent = entry.note;

  const who = document.createElement("span");
  who.className = "insight-who";
  who.textContent = entry.who;

  button.append(title, note);
  if (entry.needs) {
    const needs = document.createElement("span");
    needs.className = "example-needs";
    needs.textContent = entry.needs;
    button.append(needs);
    button.disabled = true;
    button.title = `Does not run in the playground: ${entry.needs}`;
    item.classList.add("is-unavailable");
  }
  button.append(who);
  button.addEventListener("click", () => {
    dialog.close();
    if (entry.draft !== undefined) callbacks.openDraft(entry.draft.files);
    else if (entry.sampleId !== undefined) callbacks.openSample(entry.sampleId);
    else callbacks.openLinked(entry.url);
  });
  item.append(button);

  // A draft can be deleted where it is listed. One click, no question: the
  // list is the reader's own, and a draft deleted by mistake is a Save away
  // while its files are still in the editor.
  if (entry.draft !== undefined) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost example-delete";
    remove.textContent = "✕";
    remove.title = `Delete the draft ${entry.draft.name}`;
    remove.setAttribute("aria-label", `Delete the draft ${entry.draft.name}`);
    remove.addEventListener("click", () => {
      deleteDraft(entry.draft.name);
      render();
    });
    item.append(remove);
  }

  if (entry.github) {
    const link = document.createElement("a");
    link.className = "example-github";
    link.href = entry.github;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "GitHub";
    link.title = `Open ${entry.who} on GitHub`;
    item.append(link);
  }
  return item;
}
