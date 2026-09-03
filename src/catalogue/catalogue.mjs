// The sample catalogue: 770-odd samples from three repositories, filtered.
//
// Plain ES2020, no dependency, one module. It reads ONE same-origin file,
// samples/apps.json, written at build time by tools/build-catalogue.mjs from
// the six catalogues the repositories commit. Nothing here fetches from
// another host, which is what lets the page be indexed and what makes a
// filtered list linkable.
//
// THE FILTERS LIVE IN THE URL. `?q=table&lib=sap.m&rel=1.84` is the state, and
// the address bar is where it is kept - so a search can be sent to somebody,
// bookmarked, or linked from a documentation page. That was the one thing the
// examples dialog in the playground could never do and the reason this page
// exists beside it rather than instead of it.
//
// Every row that can run opens in the playground with `?src=` (the loader in
// src/shell/deep-link.mjs) and `&from=catalogue`, which is what puts "back to
// the catalogue" in the playground's bar instead of the GitHub link. The round
// trip is the point: find it here, run it there, come back and keep looking.
import { cmpVersion } from "../shell/ui5-libs.mjs";

const $ = (id) => document.getElementById(id);

/* The URL parameter each control owns. Short names, because they end up in
 * links people paste. */
const PARAMS = { q: "q", source: "src", control: "ctl", library: "lib", release: "rel", runs: "runs" };

const el = {};
let index;
/* Rows never change after the fetch, so the haystack each one is searched
 * against is built once rather than on every keystroke. */
let rows = [];

/* ------------------------------------------------------------------ state */

const state = { q: "", source: "", control: "", library: "", release: "", runs: false };

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.q = p.get(PARAMS.q) || "";
  state.source = p.get(PARAMS.source) || "";
  state.control = p.get(PARAMS.control) || "";
  state.library = p.get(PARAMS.library) || "";
  state.release = p.get(PARAMS.release) || "";
  state.runs = p.get(PARAMS.runs) === "1";
}

/* replaceState, not pushState: typing a query is not five history entries to
 * back out of one character at a time. */
function writeUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set(PARAMS.q, state.q);
  if (state.source) p.set(PARAMS.source, state.source);
  if (state.control) p.set(PARAMS.control, state.control);
  if (state.library) p.set(PARAMS.library, state.library);
  if (state.release) p.set(PARAMS.release, state.release);
  if (state.runs) p.set(PARAMS.runs, "1");
  const query = p.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

const isFiltered = () =>
  state.q !== "" || state.source !== "" || state.control !== "" || state.library !== ""
  || state.release !== "" || state.runs;

/* ------------------------------------------------------------------ theme */

const THEME_KEY = "abap2ui5-playground:theme";

function setUpTheme() {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const system = () => (media.matches ? "dark" : "light");
  el.theme.addEventListener("click", () => {
    const now = document.documentElement.dataset.theme || system();
    const next = now === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      /* A choice that equals the system is forgotten rather than stored, so a
       * page switched back follows the system again from then on. Same rule as
       * src/shell/theme.mjs, and the same key, so the two pages agree. */
      if (next === system()) localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // A browser that refuses storage still gets the switch, just not the memory.
    }
  });
}

/* ------------------------------------------------------------------- data */

function prepare(data) {
  const names = data.controls || [];
  return (data.entries || []).map((entry) => {
    const controls = (entry.controls || []).map((i) => names[i]).filter(Boolean);
    return {
      ...entry,
      controlNames: controls,
      /* Searched as one lowercase string. The control names are in it, so
       * typing "wizard" finds a port that BUILDS a Wizard as well as the one
       * named after it - which is the whole difference between this and
       * scrolling SAMPLES.md. */
      haystack: [
        entry.title, entry.note, entry.summary, entry.class, entry.group,
        entry.entity, entry.sample, entry.runsOn,
        (entry.keywords || []).join(" "),
        controls.join(" "),
      ].filter(Boolean).join(" ").toLowerCase(),
    };
  });
}

/* ---------------------------------------------------------------- filters */

function matches(row) {
  if (state.source && row.source !== state.source) return false;
  if (state.runs && !row.runs) return false;
  if (state.library && !(row.libraries || []).includes(state.library)) return false;
  if (state.control && !row.controlNames.includes(state.control)) return false;
  /* "Runs on 1.84" means "needs 1.84 or less" - the question is what a system
   * can render, not what a sample was filed under. */
  if (state.release && cmpVersion(row.minUi5, state.release) > 0) return false;
  if (state.q && !row.haystack.includes(state.q.toLowerCase())) return false;
  return true;
}

/* ---------------------------------------------------------------- drawing */

const text = (tag, className, content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
};

function card(row) {
  const node = text("article", "card");
  node.append(text("h3", "", row.title));
  if (row.note && row.note !== row.title) node.append(text("p", "sub", row.note));

  const badges = text("div", "badges");
  const source = index.sources.find((s) => s.id === row.source);
  if (source) badges.append(text("span", "badge", source.title));
  if (row.group) badges.append(text("span", "badge", row.group));
  if (row.minUi5 && row.minUi5 !== index.minUi5) badges.append(text("span", "badge", `UI5 ${row.minUi5}`));
  if (row.needs) {
    const needs = text("span", "badge needs", row.needs);
    /* The long half: what a stack sample's system must have, which libraries
     * are missing, or what made it that release - as the tooltip, so a
     * filtered list can be argued with rather than only believed, and a card
     * still fits beside its neighbours. */
    const why = [
      row.needsDetail,
      ...(row.since || []).map((s) => `${s.name} since ${s.since}`),
    ].filter(Boolean);
    if (why.length) needs.title = why.join("\n");
    badges.append(needs);
  }
  node.append(badges);
  node.append(text("p", "who", row.class));

  const actions = text("div", "actions");
  if (row.runs) {
    const run = text("a", "run", "Run it");
    /* `back` is this page's own query string, so the playground's bar can
     * offer the way back to the SEARCH rather than to the top of the list -
     * see showSourceLink( ) in src/shell/main.mjs. Empty when nothing is
     * filtered, which keeps a plain link plain. */
    const back = location.search.replace(/^\?/, "");
    run.href = `../?src=${encodeURIComponent(row.raw)}&from=catalogue`
      + (back ? `&back=${encodeURIComponent(back)}` : "");
    run.title = "Open this class in the playground and run it here";
    actions.append(run);
  }
  const read = text("a", "", row.runs ? "Source" : "Read the source");
  read.href = row.github;
  read.target = "_blank";
  read.rel = "noopener";
  actions.append(read);
  if (row.docs && row.docs.length) {
    const docs = text("a", "", "Docs");
    docs.href = row.docs[0];
    docs.target = "_blank";
    docs.rel = "noopener";
    actions.append(docs);
  }
  node.append(actions);
  return node;
}

/* The learning path is an ORDER, not a search result: the repository decides
 * where a sample belongs in it, and that decision is the one thing on this
 * page nobody could derive. So an unfiltered list, or one narrowed to Learn
 * alone, is drawn in stages with their headings; anything else is one flat
 * list, because a relevance-free grouping of search hits is just noise. */
function grouped(hits) {
  const learn = index.stages.filter((s) => s.source === "learn");
  if (!learn.length) return null;
  if (state.source !== "" && state.source !== "learn") return null;
  if (state.q || state.control || state.library || state.release) return null;

  const groups = [];
  const seen = new Set();
  for (const stage of learn) {
    const entries = hits.filter((h) => h.source === "learn" && h.stage === stage.id);
    for (const e of entries) seen.add(e);
    if (entries.length) groups.push({ title: stage.title, blurb: stage.blurb, entries });
  }
  const rest = hits.filter((h) => !seen.has(h));
  if (rest.length) {
    for (const source of index.sources) {
      if (source.id === "learn") continue;
      const entries = rest.filter((h) => h.source === source.id);
      if (entries.length) groups.push({ title: source.title, blurb: source.blurb, entries });
    }
  }
  return groups;
}

function render() {
  const hits = rows.filter(matches);
  const frag = document.createDocumentFragment();

  if (hits.length === 0) {
    frag.append(text("p", "empty", "Nothing matches that. Try fewer filters, or a word from what the sample does rather than what it is called."));
  } else {
    const groups = grouped(hits);
    if (groups) {
      for (const group of groups) {
        const head = text("section", "stage");
        head.append(text("h2", "", group.title));
        if (group.blurb) head.append(text("p", "", group.blurb));
        frag.append(head);
        const cards = text("div", "cards");
        for (const row of group.entries) cards.append(card(row));
        frag.append(cards);
      }
    } else {
      const cards = text("div", "cards");
      for (const row of hits) cards.append(card(row));
      frag.append(cards);
    }
  }

  el.results.replaceChildren(frag);
  el.count.textContent = hits.length === rows.length
    ? `${rows.length} samples`
    : `${hits.length} of ${rows.length} samples`;
  el.clear.hidden = !isFiltered();
}

/* ------------------------------------------------------------------ setup */

function fill(select, values, label) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label ? label(value) : value;
    select.append(option);
  }
}

function bind() {
  /* The search box is not debounced on purpose: filtering 770 rows against a
   * prepared string is well under a frame, and a delay on a list this size is
   * felt as lag rather than read as thrift. */
  el.q.addEventListener("input", () => {
    state.q = el.q.value.trim();
    writeUrl();
    render();
  });
  for (const [key, node] of [["source", el.source], ["control", el.control], ["library", el.library], ["release", el.release]]) {
    node.addEventListener("change", () => {
      state[key] = node.value;
      writeUrl();
      render();
    });
  }
  el.runs.addEventListener("change", () => {
    state.runs = el.runs.checked;
    writeUrl();
    render();
  });
  el.clear.addEventListener("click", () => {
    state.q = "";
    state.source = "";
    state.control = "";
    state.library = "";
    state.release = "";
    state.runs = false;
    reflect();
    writeUrl();
    render();
  });
  /* Back and forward through pasted links, which is the only way the history
   * gets entries here. */
  window.addEventListener("popstate", () => {
    readUrl();
    reflect();
    render();
  });
}

/** The controls, from the state - after a URL read or a Clear. */
function reflect() {
  el.q.value = state.q;
  el.source.value = state.source;
  el.control.value = state.control;
  el.library.value = state.library;
  el.release.value = state.release;
  el.runs.checked = state.runs;
}

async function start() {
  for (const [key, id] of [
    ["q", "q"], ["source", "f-source"], ["control", "f-control"], ["library", "f-library"],
    ["release", "f-release"], ["runs", "f-runs"], ["results", "results"], ["count", "count"],
    ["clear", "clear"], ["theme", "theme"], ["built", "built"],
  ]) el[key] = $(id);

  setUpTheme();

  let data;
  try {
    const response = await fetch("apps.json");
    if (!response.ok) throw new Error(String(response.status));
    data = await response.json();
  } catch {
    el.results.replaceChildren(
      text("p", "empty", "The catalogue could not be loaded. It is written when this site is built, so this is a broken deploy rather than something you did - the three repositories are readable on GitHub in the meantime."),
    );
    return;
  }

  index = data;
  rows = prepare(data);

  fill(el.source, index.sources.filter((s) => s.ok).map((s) => s.id), (id) => index.sources.find((s) => s.id === id).title);
  /* Only the controls something actually builds, sorted by name - the UI5
   * universe has thousands and this list is of what is IN the corpus. */
  fill(el.control, [...new Set(rows.flatMap((r) => r.controlNames))].sort());
  fill(el.library, index.libraries);
  /* Highest first: somebody on a new system reads down to their release,
   * somebody on 1.71 is looking at the bottom of a short list either way. */
  fill(el.release, [...index.releases].sort(cmpVersion).reverse(), (r) => `${r} or older`);

  readUrl();
  reflect();
  bind();
  render();

  if (index.built) {
    const when = new Date(index.built);
    if (!Number.isNaN(when.valueOf())) el.built.textContent = `Last built ${when.toISOString().slice(0, 10)}.`;
  }
}

document.documentElement.classList.remove("no-js");
start();
