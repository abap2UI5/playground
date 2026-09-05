/*
 * The search box in the bar, for the three documents of this repository — the
 * playground, the sample catalogue and every per-sample page.
 *
 * One box for the whole project: the pages of the documentation AND all ~770
 * samples, over the one index the documentation builds and publishes
 * (/docs/search-index.json). Before this, the catalogue's own field searched
 * the catalogue, the documentation's searched the documentation, and a reader
 * who typed "carousel" into the wrong one was told there was nothing.
 *
 * The catalogue keeps its own field. That one is a FILTER — it narrows the 770
 * rows on the page in front of you, with the three facets beside it, and the
 * URL it writes is shareable. This is a different question ("where is X in
 * this project"), asked from any of the four bars, answered by leaving the
 * page. Both belong.
 *
 * The counterpart over there is docs/.vitepress/theme/SearchBox.vue, which is
 * this box as a Vue component; the matching underneath both is
 * search-engine.mjs, which is a copy of the documentation's file. This one is
 * plain DOM because two of the three documents that use it have no framework
 * and one of them is written 772 times by a build script.
 *
 * Nothing is fetched until somebody types: the index is 700 kB (180 over the
 * wire) and a reader who never searches must not pay for it.
 */
import { search, grouped, highlight, loadIndex, rememberQuery, recallQuery } from "./search-engine.mjs";

/* The index is published by the documentation, on the origin all four
 * documents share. Absolute, because these pages are served from three
 * different depths (/, /samples/, /samples/<class>/) and one of them is also
 * served under a sub-path by the dev server. */
const INDEX_URL = "https://abap2ui5.github.io/docs/search-index.json";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const GLYPH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">'
  + '<circle cx="11" cy="11" r="6.4" fill="none" stroke="currentColor" stroke-width="1.9"/>'
  + '<path d="M15.8 15.8 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

/** `text` with the parts that matched `query` wrapped, as nodes rather than as
 *  a string of HTML: what is being highlighted is a sample title out of
 *  somebody else's JSON, and it goes into the page as text. */
function marked(text, query, className) {
  const span = el("span", className);
  for (const [part, on] of highlight(text, query)) {
    if (!part) continue;
    span.append(on ? el("mark", "hl", part) : document.createTextNode(part));
  }
  return span;
}

/**
 * Put the box in `host` (the bar), and the panel it opens in the document.
 *
 * Returns nothing to call later: the box owns its own state, and every
 * document that has one wants exactly one.
 */
export function mountSearch(host) {
  if (!host) return;

  /* ---- the button in the bar, drawn as the field it opens ---- */
  const button = el("button", "search-button");
  button.type = "button";
  button.setAttribute("aria-label", "Search the documentation and the samples");
  button.innerHTML = GLYPH;
  button.append(el("span", "search-label", "Search"), el("kbd", "search-key", "/"));
  host.append(button);

  /* ---- the panel, built once and kept hidden ---- */
  const scrim = el("div", "search-scrim");
  scrim.hidden = true;
  const panel = el("div", "search-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Search");

  const field = el("div", "search-field");
  field.innerHTML = GLYPH;
  const input = el("input");
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "Search the documentation and every sample";
  const close = el("button", "search-close", "Esc");
  close.type = "button";
  field.append(input, close);

  const results = el("div", "search-results");

  /* THE KEYS, ALWAYS ON SCREEN. They used to be part of the line the empty
     state showed, which is the one moment a reader is not using them: the
     first keystroke replaced that line with results and took the only mention
     of the arrows and Enter with it. And the shortcut that OPENS the box was
     printed on the button outside and nowhere inside, so once you were in you
     were told nothing at all. */
  const keys = el("div", "search-keys");
  const hint = (text, keyNames, endOfRow) => {
    const span = el("span", endOfRow ? "search-keys-end" : null);
    for (const k of keyNames) span.append(el("kbd", null, k));
    span.append(document.createTextNode(text));
    return span;
  };
  keys.append(
    hint(" to move", ["\u2191", "\u2193"]),
    hint(" to open", ["\u21B5"]),
    hint(" to close", ["esc"]),
    hint(" from anywhere", ["/"], true),
  );

  panel.append(field, results, keys);
  scrim.append(panel);
  document.body.append(scrim);

  let entries = null;
  let rows = [];
  let active = 0;

  const note = (text) => {
    results.replaceChildren(el("p", "search-note", text));
  };

  /* SOMETHING TO PRESS WHEN YOU DO NOT KNOW WHAT TO ASK. A box that opens on
     one grey line is a question put to somebody who came to look around. So it
     says what is in it, in the two numbers that mean something, and offers
     eight words to press. They are not decoration: each one opens a shelf (the
     smallest, `chart`, returns sixteen hits across three areas), and pressing
     one fills the field, so the next thing the reader does is edit a real
     query rather than compose one from nothing. */
  const SUGGESTIONS = ["table", "dialog", "value help", "upload", "chart", "navigation", "binding", "launchpad"];

  function invite() {
    const box = el("div", "search-empty");
    const line = el("p", "search-note");
    if (entries) {
      const docs = entries.filter((e) => e.area === "docs").length;
      line.append(
        el("strong", null, String(docs)),
        document.createTextNode(" pages of the manual and "),
        el("strong", null, String(entries.length - docs)),
        document.createTextNode(" working samples, in one box \u2014 search by control, by class name, or by what you are trying to do."),
      );
    } else {
      line.textContent = "Every page of the documentation and every sample in the three catalogues.";
    }
    const try_ = el("div", "search-try");
    try_.append(el("span", "search-try-head", "Have a look at"));
    for (const word of SUGGESTIONS) {
      const chip = el("button", "search-chip", word);
      chip.type = "button";
      chip.addEventListener("click", () => {
        input.value = word;
        input.focus();
        draw();
      });
      try_.append(chip);
    }
    box.append(line, try_);
    results.replaceChildren(box);
  }

  function draw() {
    const query = input.value.trim();
    rows = [];
    if (!entries) return note("Loading the index…");
    if (!query) return invite();
    /* A high limit, and the grouping does the capping: search( ) slices to
       thirty by default, and a group would then say "eight of twenty-nine" for
       a word with two hundred and thirty-one answers - a number worse than no
       number. Scoring is over ~940 short entries and costs nothing. */
    const groups = grouped(search(entries, query, { limit: 500 }));
    if (!groups.length) return note(`Nothing matches ${query}.`);

    const frag = document.createDocumentFragment();
    for (const group of groups) {
      const box = el("div", "search-group");
      const head = el("div", "search-group-head", group.label);
      /* Eight of two hundred and thirty-one is a different answer from eight,
         and the difference is whether there is more to look at. */
      head.append(el("span", "search-count",
        group.total > group.hits.length ? ` ${group.hits.length} of ${group.total}` : ` ${group.total}`));
      box.append(head);
      for (const hit of group.hits) {
        const row = el("a", "search-hit");
        row.href = hit.entry.url + (hit.heading ? `#${hit.heading.anchor}` : "");
        /* Every hit leaves this document - a page of the manual is another
         * deployment from here, a sample is another page - and all of them
         * open in the same tab, which is what the bar's own items promise. */
        row.target = "_self";
        row.append(marked(hit.entry.title, query, "search-hit-title"));
        if (hit.heading) row.append(el("span", "search-hit-where", `› ${hit.heading.text}`));
        if (hit.entry.code) row.append(marked(hit.entry.code, query, "search-hit-code"));
        if (hit.entry.text) row.append(marked(hit.entry.text, query, "search-hit-text"));
        const at = rows.length;
        row.addEventListener("mouseenter", () => { active = at; mark(); });
        rows.push(row);
        box.append(row);
      }
      frag.append(box);
    }
    results.replaceChildren(frag);
    active = 0;
    mark();
  }

  const mark = () => rows.forEach((row, i) => row.classList.toggle("active", i === active));

  async function open() {
    scrim.hidden = false;
    /* The last thing that was searched for, if a hit was opened recently
       (search-engine.mjs). Selected, not merely filled in: the reader who
       wants it presses Enter or arrows, and the reader who wants something
       else types over it without reaching for Backspace. */
    if (!input.value) input.value = recallQuery();
    input.focus();
    if (input.value) input.select();
    draw();
    if (entries) return;
    try {
      entries = (await loadIndex(INDEX_URL)).entries;
    } catch {
      /* An index that did not arrive says so. "Nothing found" would be an
       * answer about the project, and a wrong one. */
      return note("The search index could not be loaded. The documentation and the sample catalogue are both browsable without it.");
    }
    draw();
  }

  function hide() {
    scrim.hidden = true;
    input.value = "";
    rows = [];
  }

  /* A hit was opened - by a click, by Enter (which clicks the active row), or
     by a middle click that opened it in a tab of its own. Written down BEFORE
     hide(), which empties the field. */
  function leave() {
    rememberQuery(input.value);
    hide();
  }
  results.addEventListener("click", (e) => {
    if (e.target.closest?.("a.search-hit")) leave();
  });

  button.addEventListener("click", open);
  close.addEventListener("click", hide);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) hide(); });
  input.addEventListener("input", draw);

  document.addEventListener("keydown", (e) => {
    if (scrim.hidden) {
      /* Two ways in, and neither of them while the reader is typing - in the
       * editor above all, which on the playground is most of the page. */
      const target = e.target;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "")
        || target?.isContentEditable
        || target?.closest?.(".monaco-editor");
      if (typing) return;
      if (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key === "k")) { e.preventDefault(); open(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); hide(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, rows.length - 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); mark(); }
    else if (e.key === "Enter" && rows[active]) { e.preventDefault(); rows[active].click(); }
  });
}

/** The three documents here all mount it the same way: into whatever carries
 *  `data-search`, if the page has one. */
export function setUpSearch(root = document) {
  mountSearch(root.querySelector("[data-search]"));
}
