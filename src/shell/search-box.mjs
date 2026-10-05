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
 * Nothing is fetched until somebody OPENS the box: the index is 700 kB (180
 * over the wire) and a reader who never searches must not pay for it. Opened -
 * or pointed at, or tabbed to - it is fetched at once rather than on the first
 * keystroke, so the first character typed already has something to match
 * against.
 */
import { search, grouped, highlight, loadIndex, rememberQuery, recallQuery, forgetQuery } from "./search-engine.mjs";
import { arrivedBy } from "./site-memory.mjs";

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
  /* BOTH KEYS, ON THE BOX ITSELF. The panel's foot has always said "/ or ⌘K
     from anywhere" - and it says it to a reader who has already found the
     panel. The box is what a reader looks at when they are wondering how to
     open it, and it advertised one of the two. `⌘K` is the combination people
     arrive expecting, because every documentation site they have used shows
     it; `/` is the one key that needs no modifier. The platform decides which
     of ⌘ and Ctrl is named, exactly as the foot does - naming one of them to
     everybody is an instruction that does not work for half the readers. */
  const onApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  button.append(
    el("span", "search-label", "Search"),
    el("kbd", "search-key", "/"),
    el("kbd", "search-key search-key-combo", onApple ? "\u2318K" : "Ctrl K"),
  );
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
  /* The DIALOG is named ("Search", above); the field inside it was not, so a
     screen reader announced it as an unnamed edit box. A placeholder is not a
     name - it is gone after the first keystroke, and not every browser and
     reader pair falls back to it. This is the one control the bar has, and the
     bar is on all four deployments, so the name is missing on the manual's 166
     pages, the catalogue, the full list and all 771 sample pages at once. */
  input.setAttribute("aria-label", "Search the documentation and every sample");
  const close = el("button", "search-close", "Esc");
  close.type = "button";
  field.append(input, close);

  const results = el("div", "search-results");
  /* A COMBOBOX, SAID AS ONE. The arrows moved a mark that was a CSS class
     and nothing else: focus stays in the field, as it should, but a screen
     reader heard neither the hit that was marked nor how many there were, and
     Enter opened a page the reader had never been told about. The field owns
     the list (aria-controls) and names the marked row (aria-activedescendant);
     the list is a listbox while it holds hits, and what it says otherwise -
     "Loading", "Nothing matches" - goes to a status line beside it. */
  results.id = "search-results";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", results.id);
  input.setAttribute("aria-expanded", "false");
  const status = el("p", "search-status");
  status.setAttribute("role", "status");
  status.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;padding:0";

  /* THE KEYS, ALWAYS ON SCREEN. They used to be part of the line the empty
     state showed, which is the one moment a reader is not using them: the
     first keystroke replaced that line with results and took the only mention
     of the arrows and Enter with it. And the shortcut that OPENS the box was
     printed on the button outside and nowhere inside, so once you were in you
     were told nothing at all. */
  const keys = el("div", "search-keys");
  const hint = (text, keyNames, endOfRow) => {
    const span = el("span", endOfRow ? "search-keys-end" : null);
    keyNames.forEach((k, i) => {
      /* "or" between alternatives, nothing between the two arrows: a row that
         read "/Ctrl K from anywhere" names one key nobody has. The separator
         is only ever needed at the end of the row, where the two ways in are
         listed, so it is the "or" that belongs there and not a comma. */
      if (i) span.append(document.createTextNode(endOfRow ? " or " : ""));
      span.append(el("kbd", null, k));
    });
    span.append(document.createTextNode(text));
    return span;
  };
  /* \u2318 on an Apple keyboard and Ctrl on every other one. The handler takes
     either (`metaKey || ctrlKey`); naming one of them to everybody is an
     instruction that does not work for half the readers. */
  const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  keys.append(
    hint(" to move", ["\u2191", "\u2193"]),
    hint(" to open", ["\u21B5"]),
    hint(" to close", ["esc"]),
    hint(" from anywhere", ["/", apple ? "\u2318K" : "Ctrl K"], true),
  );

  panel.append(field, results, status, keys);
  scrim.append(panel);
  document.body.append(scrim);

  let entries = null;
  /* Why there are no entries, once a load has failed: draw( ) says this in
     place of "Loading the index…", which it said forever after a failed load
     as soon as the reader typed. Cleared by the next open( ), which tries again. */
  let failed = null;
  let rows = [];
  let active = 0;

  /* Not a list: the role comes off, and the field says nothing is marked. */
  const unlisted = () => {
    results.removeAttribute("role");
    results.removeAttribute("aria-label");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const note = (text) => {
    unlisted();
    results.replaceChildren(el("p", "search-note", text));
    status.textContent = text;
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
      line.textContent = "Every page of the documentation and every sample in the three catalogs.";
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
    unlisted();
    status.textContent = "";
    results.replaceChildren(box);
  }

  function draw() {
    const query = input.value.trim();
    rows = [];
    if (!entries) return note(failed ?? "Loading the index…");
    if (!query) return invite();
    /* A high limit, and the grouping does the capping: search( ) slices to
       thirty by default, and a group would then say "eight of twenty-nine" for
       a word with two hundred and thirty-one answers - a number worse than no
       number. Scoring is over ~940 short entries and costs nothing. */
    const hits = search(entries, query, { limit: 500 });
    const groups = grouped(hits);
    if (!groups.length) return note(`Nothing matches ${query}.`);

    const frag = document.createDocumentFragment();
    /* What answered, when it was not what was typed: a typo corrected or a
       word set aside (search-engine.mjs). Said above the results, and the
       marks in the rows are of the query that answered. */
    const shown = hits.relaxedTo || query;
    if (hits.relaxedTo) {
      const line = el("p", "search-note");
      // Inside the listbox, where only options belong; the status line says
      // the same thing to a screen reader ("N results for …").
      line.setAttribute("aria-hidden", "true");
      line.append(
        document.createTextNode("Nothing matches "), el("strong", null, query),
        document.createTextNode(" \u2014 showing "), el("strong", null, hits.relaxedTo),
        document.createTextNode("."),
      );
      frag.append(line);
    }
    let count = 0;
    for (const [g, group] of groups.entries()) {
      const box = el("div", "search-group");
      box.setAttribute("role", "group");
      const head = el("div", "search-group-head", group.label);
      head.id = `search-group-${g}`;
      box.setAttribute("aria-labelledby", head.id);
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
        row.append(marked(hit.entry.title, shown, "search-hit-title"));
        if (hit.heading) row.append(el("span", "search-hit-where", `› ${hit.heading.text}`));
        if (hit.entry.code) row.append(marked(hit.entry.code, shown, "search-hit-code"));
        if (hit.entry.text) row.append(marked(hit.entry.text, shown, "search-hit-text"));
        const at = rows.length;
        row.id = `search-hit-${at}`;
        row.setAttribute("role", "option");
        count += 1;
        row.addEventListener("mouseenter", () => { active = at; mark(); });
        rows.push(row);
        box.append(row);
      }
      frag.append(box);
    }
    results.replaceChildren(frag);
    results.setAttribute("role", "listbox");
    results.setAttribute("aria-label", "Results");
    input.setAttribute("aria-expanded", "true");
    status.textContent = `${count} result${count === 1 ? "" : "s"}${hits.relaxedTo ? ` for ${hits.relaxedTo}` : ""}`;
    active = 0;
    mark();
  }

  const mark = () => {
    rows.forEach((row, i) => {
      row.classList.toggle("active", i === active);
      row.setAttribute("aria-selected", String(i === active));
    });
    if (rows[active]) input.setAttribute("aria-activedescendant", rows[active].id);
    else input.removeAttribute("aria-activedescendant");
  };

  /**
   * The arrow keys move the mark AND bring the row into view.
   *
   * They moved the mark alone, and the list did not follow: eight rows a group
   * over four groups is more than the panel holds, so walking down with the
   * keyboard marked rows nobody could see, and the reader was pressing Enter
   * on something off the bottom of the box.
   *
   * `block: "nearest"` rather than a centring scroll: it moves the list by the
   * one row that is needed and leaves it alone while the mark is already on
   * screen, which is what makes a long walk down read as a list scrolling
   * rather than as a list jumping. Only from HERE - the mouse sets `active`
   * too, and a list that scrolled under the pointer would move the row out
   * from under it.
   */
  function move(step) {
    active = Math.min(Math.max(active + step, 0), rows.length - 1);
    mark();
    rows[active]?.scrollIntoView({ block: "nearest" });
  }

  /* The page behind the panel is inert while it is open: the panel says it
     is modal (aria-modal), and Shift+Tab out of the field walked straight
     into the page underneath. Only what this made inert is given back. */
  let madeInert = [];
  async function open() {
    scrim.hidden = false;
    madeInert = [...document.body.children].filter((n) => n !== scrim && !n.inert);
    for (const n of madeInert) n.inert = true;
    /* The last thing that was searched for, if a hit was opened recently
       (search-engine.mjs). Selected, not merely filled in: the reader who
       wants it presses Enter or arrows, and the reader who wants something
       else types over it without reaching for Backspace. */
    if (!input.value) input.value = recallQuery();
    input.focus();
    if (input.value) input.select();
    draw();
    if (entries) return;
    failed = null;
    try {
      entries = (await loadIndex(INDEX_URL)).entries;
    } catch {
      /* An index that did not arrive says so. "Nothing found" would be an
       * answer about the project, and a wrong one. */
      failed = "The search index could not be loaded. The documentation and the sample catalog are both browsable without it.";
      return note(failed);
    }
    draw();
  }

  function hide() {
    /* WHERE THE FOCUS GOES WHEN THE PANEL CLOSES. Hiding the box it is in
       hands the focus to <body>, so the reader's next Tab started again at
       the top of the page - the whole bar, on every Escape. It goes back to
       the button that opened it, which is where it came from and what the
       menu beside it already does. Only if it is in here: closing by a click
       on the scrim must not take the focus away from wherever that reader
       actually is. */
    const leaving = scrim.contains(document.activeElement);
    for (const n of madeInert) n.inert = false;
    madeInert = [];
    scrim.hidden = true;
    input.value = "";
    rows = [];
    if (leaving) button.focus();
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
  /* The middle button is not a click: browsers fire auxclick for it, and the
     tab it opens would otherwise start with an empty box. Remembered, not
     closed - this tab keeps its results. */
  results.addEventListener("auxclick", (e) => {
    if (e.button === 1 && e.target.closest?.("a.search-hit")) rememberQuery(input.value);
  });

  button.addEventListener("click", open);
  /* A pointer over the button, or the keyboard focus on it, is the moment a
     reader is about to search - so the fetch starts there, a hundred-odd
     milliseconds before the click, and the box opens on a loaded index more
     often than not. Still nothing for the reader who never comes near it.
     A failure is open( )'s to report; loadIndex forgets it and tries again. */
  const warm = () => { if (!entries) loadIndex(INDEX_URL).catch(() => {}); };
  button.addEventListener("pointerenter", warm, { once: true });
  button.addEventListener("focus", warm, { once: true });
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
      /* Nor under a modal dialog: the scrim would open in the inert layer
       * beneath it, refuse the focus, and take the arrow keys and Enter away
       * from the dialog the reader is looking at. */
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key === "k")) { e.preventDefault(); open(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); hide(); return; }
    /* The arrows and Enter belong to the FIELD. A result reached with Tab, or
       the Esc button, is a link or a button that answers Enter itself - taken
       over here, Enter on the third result opened the first, and Enter on
       Esc opened a result. And an Enter that confirms an input method's
       composition (Japanese, Chinese) is not a request to leave the page. */
    if (e.target !== input || e.isComposing) return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter" && rows[active]) { e.preventDefault(); rows[active].click(); }
  });
}

/** The three documents here all mount it the same way: into whatever carries
 *  `data-search`, if the page has one. */
export function setUpSearch(root = document) {
  /* A REFRESH STARTS THE SITE OVER, and the last thing you searched for is a
   * memory of the visit before it like every other (site-memory.mjs, which
   * drops the rest of them). Here rather than there because the key is this
   * box's: the module that owns a memory is the one that forgets it. */
  if (arrivedBy() === "reload") forgetQuery();
  mountSearch(root.querySelector("[data-search]"));
}
