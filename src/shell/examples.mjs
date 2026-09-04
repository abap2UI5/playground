// The examples browser: what the sample repositories hold, listed and
// searchable, one click from running here.
//
// It reads ONE file, and it is this site's own: `samples/apps.json`, written
// at build time by tools/build-catalogue.mjs from the six catalogues the three
// repositories commit. This module used to fetch those catalogues itself, from
// raw.githubusercontent.com, and shape them here - three readers, three cache
// entries, three chances to be wrong about a repository's format. The
// catalogue PAGE at /samples/ needs the same list in the same shape, and two
// implementations of one list is exactly the drift the sample repositories
// avoid by generating their four views from one scan. So there is one index,
// and this is a menu in front of it.
//
// It is a BIG modal, and that is the whole shape of it: the catalogue is
// 770-odd samples, and a narrow column of one-line rows was a keyhole onto a
// list that size. Full width, the filters down the side, the rows in as many
// columns as the screen has room for - the page it covers is out of the way
// while somebody is looking through it, which is what somebody looking for a
// sample wants of the editor behind it.
//
// It carries the same facts the catalogue page does, and the same three
// facets - the control a sample BUILDS, the library that control ships in,
// and the release it needs - because those are the two questions the sample
// repositories' own catalogues cannot answer and the reason the index carries
// the linter's derived half at all.
//
// What the page has that this does not is an ADDRESS: its filters live in the
// URL, so a search can be linked. What this has that the page does not is
// being here, in the bar, one key away from the editor - and the reader's own
// drafts, which are in this browser and on no page. Neither replaces the
// other, and the dialog's side links across.
//
// Not every sample runs here - the transpiler has limits, a library may not be
// in this build, and everything in samples-stack needs a real system. The
// index says which and why (`runs`, `needs`), computed once at build time
// against UI5_LIBRARIES and the release this site pins. Those rows are still
// LISTED, because a sample somebody cannot find is worse than one they cannot
// run, and they open for reading rather than running.
//
// When the index cannot be had - a broken deploy, an offline first visit
// before the service worker has it - the browser degrades without a word to
// what is always here: the samples the page carries and the reader's drafts.
// No error, no console noise of this module's making.
import { SAMPLES } from "../editor/samples.mjs";
import { deleteDraft, draftNameProblem, listDrafts, saveDraft } from "./drafts.mjs";
import { readStoredJson, writeStoredJson } from "./storage.mjs";

// The boxes, as the dialog's side names them - see index.html: the three
// repositories (on), "Only what runs here" (off), "OpenUI5 only" (off - it
// narrows, and the list is meant to be everything until somebody says
// otherwise), and "newer than 1.71" (on - off, it hides what needs a UI5
// newer than the floor). Kept between visits, together with the three facets
// below: somebody who only ever wants what runs here on OpenUI5 should not
// have to say so every time.
const FILTERS_KEY = "abap2ui5-playground:samples-filters";
const FILTERS = ["learn", "controls", "stack", "runsonly", "openui5only", "newer"];
const PICKS = ["control", "library", "release"];
const DEFAULTS = { learn: true, controls: true, stack: true, runsonly: false, openui5only: false, newer: true };
let filters = { ...DEFAULTS };
// The three selects: a control something builds, the library it ships in, and
// the release a system runs. Empty is "any", which is what they start as.
let picks = { control: "", library: "", release: "" };

/* The floor every sample is held to, and therefore the release a row has to
 * exceed to count as "newer than 1.71". The index carries the number so this
 * does not restate it; the fallback is for an index too old to have it. */
let floor = "1.71";

const str = (v) => (typeof v === "string" ? v : "");

/** Compare two dotted UI5 versions numerically ("1.9" < "1.71" < "1.120"). */
function cmpVersion(a, b) {
  const pa = str(a).split(".").map(Number);
  const pb = str(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Which entries the boxes and the facets let through.
//
// The samples the page carries and the reader's own drafts pass the BOXES:
// every one of them is about which repository a row came from, and these came
// with the page. They do not pass a FACET, because a facet asks something only
// the index can answer - which control a class builds, which library that is,
// what release it needs - and a row that has no answer is not a match for one.
function passes(entry) {
  const own = entry.sampleId !== undefined || entry.draft !== undefined;
  if (own) return picks.control === "" && picks.library === "" && picks.release === "";
  if (!filters[entry.source]) return false;
  if (filters.runsonly && !entry.runs) return false;
  if (filters.openui5only && entry.sapui5) return false;
  if (!filters.newer && cmpVersion(entry.minUi5, floor) > 0) return false;
  if (picks.control !== "" && !entry.controlNames.includes(picks.control)) return false;
  if (picks.library !== "" && !entry.libraries.includes(picks.library)) return false;
  /* "Runs on 1.84" means "needs 1.84 or less" - the question is what a system
   * can render, not what a sample was filed under. */
  if (picks.release !== "" && cmpVersion(entry.minUi5, picks.release) > 0) return false;
  return true;
}

/** Is anything narrowing the list - so the Clear button is worth offering? */
function isNarrowed() {
  if (search && search.value.trim() !== "") return true;
  if (PICKS.some((p) => picks[p] !== "")) return true;
  return FILTERS.some((f) => filters[f] !== DEFAULTS[f]);
}

// The index, or undefined where there is none to be had. Same-origin, so the
// service worker has it after the first visit and an offline second visit is
// a cache hit rather than a failure.
async function loadIndex() {
  try {
    const response = await fetch("samples/apps.json");
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    // Offline, refused, or an answer that is not JSON - all the same: no
    // catalogue today, and no error either. The carried samples are the menu.
    return undefined;
  }
}

// The index's flat list of entries, as the groups this dialog draws: the
// learning path in its own reading order first, then one group per library
// for the ports, then one per technology for the stack samples. The ORDER
// within a group is the index's, which is the repositories' own.
function groupsFrom(data) {
  floor = str(data.minUi5) || floor;
  const names = data.controls || [];
  const sources = new Map((data.sources || []).map((s) => [s.id, s]));
  const stages = (data.stages || []).filter((s) => s.source === "learn");

  const groups = new Map();
  const groupFor = (key, title, blurb) => {
    if (!groups.has(key)) groups.set(key, { title, blurb: blurb || "", entries: [] });
    return groups.get(key);
  };
  /* Seeded in the learning path's own order, so the stages keep it even
   * though the entries arrive in one flat list. */
  for (const stage of stages) groupFor(`learn:${stage.id}`, str(stage.title) || stage.id, str(stage.blurb));

  for (const entry of data.entries || []) {
    const controls = (entry.controls || []).map((i) => names[i]).filter(Boolean);
    const libraries = (entry.libraries || []).filter((l) => typeof l === "string");
    const row = {
      title: str(entry.title) || str(entry.class),
      note: str(entry.note),
      who: str(entry.class),
      url: str(entry.raw),
      github: str(entry.github),
      docs: (entry.docs || []).filter((d) => typeof d === "string"),
      source: str(entry.source),
      group: str(entry.group),
      minUi5: str(entry.minUi5) || floor,
      sapui5: entry.needs === "needs SAPUI5",
      runs: entry.runs === true,
      needs: entry.runs === true ? undefined : str(entry.needs) || undefined,
      /* The long half of "needs": what a stack sample's system must have,
       * which libraries are missing, or what made it that release. It is the
       * row's tooltip, the way the catalogue page hangs it off the badge -
       * a filtered list one can argue with rather than only believe. */
      why: [
        str(entry.needsDetail),
        ...(entry.since || []).map((s) => `${str(s.name)} since ${str(s.since)}`),
      ].filter(Boolean),
      controlNames: controls,
      libraries,
      haystack: `${entry.title} ${entry.note} ${entry.summary || ""} ${entry.class} `
        + `${entry.entity || ""} ${entry.sample || ""} ${entry.group || ""} ${entry.runsOn || ""} `
        + `${(entry.keywords || []).join(" ")} ${libraries.join(" ")} ${controls.join(" ")}`.toLowerCase(),
    };
    if (row.url === "") continue;

    if (row.source === "learn") {
      const stage = str(entry.stage);
      groupFor(`learn:${stage || "more"}`, stage || "More").entries.push(row);
    } else {
      const label = sources.get(row.source);
      const title = `${label ? label.title : row.source} — ${str(entry.group) || "Other"}`;
      groupFor(`${row.source}:${entry.group}`, title).entries.push(row);
    }
  }

  /* Learn first in path order, then the others sorted by their own group
   * label - the same shape the three repositories' pages had. */
  const learn = [...groups.entries()].filter(([k]) => k.startsWith("learn:")).map(([, g]) => g);
  const rest = [...groups.entries()]
    .filter(([k]) => !k.startsWith("learn:"))
    .sort((a, b) => a[1].title.localeCompare(b[1].title))
    .map(([, g]) => g);
  return [...learn, ...rest].filter((g) => g.entries.length > 0);
}

let dialog;
let body;
let search;
let clear;
const facet = {};
let callbacks;
let started = false;
let loading = false;

// The always-there group: the samples the page carries, which have no other way
// in - there is no sample menu in the bar - so the browser has something to
// search and to open even when no catalogue can be reached. They come out of
// abap2UI5/samples like every other row; what is different about them is only
// that they travelled with the page (src/editor/sample-list.mjs).
const builtIn = {
  title: "In the page",
  blurb: "A handful from abap2UI5/samples that the page carries, so it has something to open with no network.",
  entries: SAMPLES.map((sample) => ({
    title: sample.title,
    note: sample.note,
    who: "in the page",
    group: sample.group,
    docs: sample.docs,
    haystack: `${sample.title} ${sample.note} ${sample.group}`.toLowerCase(),
    sampleId: sample.id,
    runs: true,
    // The same file every catalogued row links to, in the same repository:
    // these ARE catalogue entries, carried with the page rather than fetched -
    // so they carry the same group badge and the same documentation link too.
    github: sample.github,
  })),
};

// The groups the index produced - empty until it has landed, and empty for
// good when it could not be had.
let loadedGroups = [];

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

/** Options onto a facet's select, and the select is only usable once it has any. */
function fill(select, values, label) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label ? label(value) : value;
    select.append(option);
  }
  select.disabled = select.options.length <= 1;
}

// The three facets, from the index the fetch brought back: the controls the
// corpus actually BUILDS (the UI5 universe has thousands; this list is of what
// is in these 770 samples), the libraries those ship in, and the releases they
// need. A stored pick that is not among them is dropped rather than kept as a
// filter nothing can match.
function fillFacets(data) {
  const names = data.controls || [];
  const used = new Set();
  for (const entry of data.entries || []) {
    for (const i of entry.controls || []) if (names[i]) used.add(names[i]);
  }
  fill(facet.control, [...used].sort());
  fill(facet.library, (data.libraries || []).filter((l) => typeof l === "string"));
  /* Highest first: somebody on a new system reads down to their release,
   * somebody on 1.71 is looking at the bottom of a short list either way. */
  fill(facet.release, [...(data.releases || [])].sort(cmpVersion).reverse(), (r) => `${r} or older`);
  for (const p of PICKS) {
    if (picks[p] !== "" && ![...facet[p].options].some((o) => o.value === picks[p])) picks[p] = "";
    facet[p].value = picks[p];
  }
}

export function setUpExamples(handlers) {
  callbacks = handlers;
  dialog = document.getElementById("examples-dialog");
  body = document.getElementById("examples-body");
  search = document.getElementById("examples-search");
  clear = document.getElementById("examples-clear");
  for (const p of PICKS) facet[p] = document.getElementById(`examples-${p}`);

  search.addEventListener("input", () => render());
  // A click on the backdrop closes it, the way a modal is expected to.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  // What was kept from last time, if anything, and every change both
  // re-renders and is kept. A stored value of the wrong type is ignored
  // rather than trusted.
  const stored = readStoredJson(FILTERS_KEY);
  for (const f of FILTERS) if (typeof stored?.[f] === "boolean") filters[f] = stored[f];
  for (const p of PICKS) if (typeof stored?.[p] === "string") picks[p] = stored[p];

  for (const box of dialog.querySelectorAll("input[data-filter]")) {
    const f = box.dataset.filter;
    box.checked = filters[f] === true;
    box.addEventListener("change", () => {
      filters[f] = box.checked;
      keep();
      render();
    });
  }
  for (const p of PICKS) {
    // Empty until the index lands, and unusable while it is: a select with
    // nothing in it but "any" is a control that cannot do anything.
    facet[p].disabled = true;
    facet[p].addEventListener("change", () => {
      picks[p] = facet[p].value;
      keep();
      render();
    });
  }
  clear.addEventListener("click", () => {
    filters = { ...DEFAULTS };
    picks = { control: "", library: "", release: "" };
    search.value = "";
    reflect();
    keep();
    render();
    search.focus();
  });
}

/** The boxes and the picks, kept between visits. */
function keep() {
  writeStoredJson(FILTERS_KEY, { ...filters, ...picks });
}

/** The controls, from the state - after a Clear. */
function reflect() {
  for (const box of dialog.querySelectorAll("input[data-filter]")) box.checked = filters[box.dataset.filter] === true;
  for (const p of PICKS) facet[p].value = picks[p];
}

export function openExamples() {
  if (!dialog) return;
  if (!started) {
    started = true;
    loading = true;
    loadIndex()
      .then((data) => {
        try {
          loadedGroups = data === undefined ? [] : groupsFrom(data);
          if (data !== undefined) fillFacets(data);
        } catch {
          // An index in a shape this module does not know is treated like a
          // missing one - the next deploy of the playground writes both.
          loadedGroups = [];
        }
      })
      .finally(() => {
        loading = false;
        render();
      });
  }
  reflect();
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
  /* Every word has to be somewhere in the row, in any order: "table select"
   * finds the selection-modes sample whichever way round it was typed, which
   * one string compared whole would not. */
  const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (entry) => terms.every((t) => entry.haystack.includes(t));
  const frag = document.createDocumentFragment();
  let shown = 0;
  let total = 0;

  for (const group of [draftsGroup(), builtIn, ...loadedGroups]) {
    total += group.entries.length;
    const entries = group.entries.filter((e) => passes(e) && hit(e));
    // The drafts group stays on screen with no drafts in it, because its
    // save row is how the first one gets there - but not while a search or a
    // facet is narrowing the list to something else.
    const bare = terms.length === 0 && picks.control === "" && picks.library === "" && picks.release === "";
    if (entries.length === 0 && !(group.saveRow && bare)) continue;
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
    list.className = "insight-list examples-list";
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
  body.scrollTop = 0;
  // How much the search and the filters let through, so an empty-looking
  // list says whether it is the words or the boxes.
  const count = document.getElementById("examples-count");
  if (count) count.textContent = loading ? "" : `${shown} of ${total}`;
  if (clear) clear.hidden = !isNarrowed();
}

/** A badge on a row: what the index knows about it in one or two words. */
function badge(text, className = "") {
  const node = document.createElement("span");
  node.className = `example-badge ${className}`.trim();
  node.textContent = text;
  return node;
}

// One entry: a button that opens it here, and beside it the links to where it
// lives. The button rather than a click handler on the item, because this is
// the only way into the examples for somebody who is not using a mouse, and a
// <li> is not focusable, not in the tab order and does not answer Enter or
// Space. The links are outside the button, because a link inside a button is
// not HTML.
//
// Two lines: what it is called and what the index knows about it, then what it
// does and the class it is. A sample that cannot run here - one that needs a
// system, or SAPUI5 - is listed, says so, and its button is disabled: clicking
// would only have opened code that fails on the first roundtrip. The links
// beside it are how one still gets to it.
function row(entry) {
  const item = document.createElement("li");
  item.className = "example-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "insight-row example-row";
  // The carried samples by id, so a test can pick one without matching its title.
  if (entry.sampleId !== undefined) button.dataset.sample = entry.sampleId;
  if (entry.draft !== undefined) button.dataset.draft = entry.draft.name;

  const line = document.createElement("span");
  line.className = "example-line";

  const title = document.createElement("span");
  title.className = "example-title";
  title.textContent = entry.title;
  line.append(title);

  const badges = document.createElement("span");
  badges.className = "example-badges";
  /* The group the repository filed it under - unless that is what the row is
   * already called, which is most of the learning path: a "Binding" badge on
   * a row titled Binding is a word twice. */
  if (entry.group && entry.group.toLowerCase() !== entry.title.toLowerCase()) badges.append(badge(entry.group));
  // The release, only where it is above the floor - "UI5 1.71" on seven
  // hundred rows says nothing that the floor does not already say.
  if (entry.minUi5 && cmpVersion(entry.minUi5, floor) > 0) badges.append(badge(`UI5 ${entry.minUi5}`));
  if (entry.needs) {
    const needs = badge(entry.needs, "example-needs");
    if (entry.why && entry.why.length) needs.title = entry.why.join("\n");
    badges.append(needs);
    button.disabled = true;
    button.title = `Does not run in the playground: ${entry.needs}`;
    item.classList.add("is-unavailable");
  }
  if (badges.childElementCount > 0) line.append(badges);

  const note = document.createElement("span");
  note.className = "insight-what example-note";
  note.textContent = entry.note;

  const who = document.createElement("span");
  who.className = "insight-who";
  who.textContent = entry.who;

  const second = document.createElement("span");
  second.className = "example-line is-second";
  second.append(note, who);

  button.append(line, second);
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
    // The file, not the row's label: a carried sample's label is "in the page", which
    // says nothing about what the link opens.
    link.title = `Open ${entry.github.slice(entry.github.lastIndexOf("/") + 1)} on GitHub`;
    item.append(link);
  }

  // Where the documentation says more about what the sample is showing - the
  // learning path carries those links, and they are the half of a sample that
  // is prose rather than ABAP.
  if (entry.docs && entry.docs.length) {
    const docs = document.createElement("a");
    docs.className = "example-docs";
    docs.href = entry.docs[0];
    docs.target = "_blank";
    docs.rel = "noopener";
    docs.textContent = "Docs";
    docs.title = `Read the documentation for ${entry.title}`;
    item.append(docs);
  }
  return item;
}
