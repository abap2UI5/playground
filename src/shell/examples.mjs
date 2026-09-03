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
// What the page has that this does not is an ADDRESS: its filters live in the
// URL, so a search can be linked. What this has that the page does not is
// being here, in the bar, one key away from the editor - and the reader's own
// drafts, which are in this browser and on no page. Neither replaces the
// other, and the dialog's head links across.
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

// The filters, as the checkboxes in the dialog's head name them - see
// index.html: the three repositories (on), "OpenUI5 only" (off - it narrows,
// and the list is meant to be everything until somebody says otherwise), and
// "newer than 1.71" (on - off, it hides what needs a UI5 newer than the
// floor). Kept between visits: somebody who only ever wants what runs here
// on OpenUI5 should not have to say so every time.
const FILTERS_KEY = "abap2ui5-playground:samples-filters";
const FILTERS = ["learn", "controls", "stack", "openui5only", "newer"];
let filters = { learn: true, controls: true, stack: true, openui5only: false, newer: true };

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

// Which entries the filters let through. The samples the page carries are
// always there - every filter is about which repository a row came from, and
// these came with the page - and so are the reader's own drafts.
function passes(entry) {
  if (entry.sampleId !== undefined || entry.draft !== undefined) return true;
  if (!filters[entry.source]) return false;
  if (filters.openui5only && entry.sapui5) return false;
  if (!filters.newer && cmpVersion(entry.minUi5, floor) > 0) return false;
  return true;
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
    const row = {
      title: str(entry.title) || str(entry.class),
      note: str(entry.note),
      who: str(entry.class),
      url: str(entry.raw),
      github: str(entry.github),
      source: str(entry.source),
      minUi5: str(entry.minUi5) || floor,
      sapui5: entry.needs === "needs SAPUI5",
      runs: entry.runs === true,
      needs: entry.runs === true ? undefined : str(entry.needs) || undefined,
      haystack: `${entry.title} ${entry.note} ${entry.summary || ""} ${entry.class} `
        + `${entry.entity || ""} ${entry.sample || ""} ${(entry.keywords || []).join(" ")} `
        + `${controls.join(" ")}`.toLowerCase(),
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
    haystack: `${sample.title} ${sample.note}`.toLowerCase(),
    sampleId: sample.id,
    runs: true,
    // The same file every catalogued row links to, in the same repository:
    // these ARE catalogue entries, carried with the page rather than fetched.
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
    loadIndex()
      .then((data) => {
        try {
          loadedGroups = data === undefined ? [] : groupsFrom(data);
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

  for (const group of [draftsGroup(), builtIn, ...loadedGroups]) {
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
  // The carried samples by id, so a test can pick one without matching its title.
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
    // The file, not the row's label: a carried sample's label is "in the page", which
    // says nothing about what the link opens.
    link.title = `Open ${entry.github.slice(entry.github.lastIndexOf("/") + 1)} on GitHub`;
    item.append(link);
  }
  return item;
}
