// Where you were, on each of the two sites the bar moves between.
//
// The playground, the sample catalogue and the documentation are three
// deployments on ONE origin (abap2ui5.github.io/playground, /playground/samples
// and /docs), which is what makes this possible at all: they share a
// localStorage the way they already share the theme. Each page writes down
// where it is, and the nav item that points at the OTHER site is lifted to
// whatever that site wrote last. Docs -> Samples -> Docs comes back to the
// page you left rather than to the front of the manual, and because the
// catalogue keeps its filters in its URL (?q=table&lib=sap.m), a filtered
// catalogue comes back filtered.
//
// The href in the markup stays the section's front page. That is what a
// crawler, a reader with no JavaScript and a first visit all get, and it is
// what this falls back to at every step below - nothing here ever makes a link
// worse than the one that was written.
//
// THE PLAYGROUND IS REMEMBERED TOO, and it did not used to be. The reasoning
// against it was that its URL carries the code in the editor, so an item that
// reopened yesterday's sample would be a different promise from the one the
// word makes: samples and docs are places, the playground is a workbench.
//
// What that argument missed is the case it creates. A reader who opens a
// SAMPLE in the playground has code that is not a draft - a sample that was
// picked and read is deliberately not stored (main.mjs) - so pressing
// Documentation and then Playground threw it away and started them on the
// default sample. Their own edits survived that trip; the sample they were
// reading did not, and nothing on the screen said why.
//
// So the workbench is a place after all. Two things are still never written:
// an EMBEDDED playground, which is furniture in somebody else's page, and an
// app-only view (?view=app, ?view=full), which is a running app rather than a
// place to come back to.
import { readStored, writeStored } from "./storage.mjs";

/* The playground's namespace, for a key the documentation site writes too.
 * It is the wrong word for a value shared by three deployments and it is the
 * namespace every other key on this origin already uses - including the theme,
 * which crossed the same line first. One slightly misnamed prefix beats two
 * prefixes that have to be remembered separately. */
const KEY = {
  samples: "abap2ui5-playground:last-samples",
  docs: "abap2ui5-playground:last-docs",
  playground: "abap2ui5-playground:last-playground",
};

/** Where this page is, in the form a link can be set to. */
const here = () => location.pathname + location.search + location.hash;

/** Each lifted link's href as the markup wrote it - the section it points at. */
const written = new WeakMap();

/**
 * Write down that the reader is here. `site` is "samples" or "docs" - the
 * section this page belongs to, not the one it links at.
 */
export function rememberHere(site) {
  if (KEY[site]) writeStored(KEY[site], here());
}

/**
 * Lift every `[data-site]` nav link to the page that site was last left on.
 *
 * A stored value is untrusted: anything running on this origin can put
 * anything in it, and a stale one outlives the page it named. So it is not
 * assigned, it is CHECKED - resolved against this origin first, and kept only
 * if what comes back is still inside the path the markup's own href points at.
 * That is what turns "//evil.example/x" (a different origin), "/docs/../x" (a
 * path that normalises out of the section) and "javascript:…" (an origin of
 * "null") into three links that are simply left alone.
 */
export function upgradeSiteLinks(root = document) {
  for (const a of root.querySelectorAll("a[data-site]")) {
    /* The section, from the link as it was WRITTEN - kept from the first
     * time round, because after a lift the attribute is the page that was
     * restored, and a sample's own page is not a section a narrowed list is
     * inside of. Taking it from the markup rather than from a constant is
     * what lets this work unchanged on a dev server, where the three sites
     * sit at other paths - and what makes a link to another HOST (no shared
     * storage, so nothing to restore) fall through the origin test below. */
    const home = written.get(a) ?? a.getAttribute("href");
    written.set(a, home);
    const last = readStored(KEY[a.dataset.site]);
    if (!last) continue;
    try {
      /* What the stored value has to be INSIDE is normally the link's own
       * href, and for the Samples item it still is. The Documentation item is
       * the exception the `data-scope` attribute exists for: it opens the
       * first page of the manual rather than its front page, so a stored
       * /docs/cookbook/... is not inside its href and every restore would
       * fall back. The scope is the section - /docs/ - while the href stays
       * the page a reader with nothing stored should land on.
       *
       * It is an attribute of the MARKUP, not of the stored value, so this
       * widens nothing: what may be restored is still declared by the
       * document and still checked against this origin below. */
      const base = new URL(a.dataset.scope || home, location.href);
      if (base.origin !== location.origin) continue;
      const target = new URL(last, location.origin);
      if (target.origin !== location.origin) continue;
      if (!target.pathname.startsWith(base.pathname)) continue;
      /* The catalogue lives UNDER the playground's path, so a stored
       * playground position that names a sample page passes the test above
       * - and the Playground item would open a page of the catalogue. The
       * playground never writes such a value (main.mjs), which is exactly
       * why a stored one is somebody else's, and refused. */
      if (a.dataset.site === "playground" && /\/samples(\/|$)/.test(target.pathname.slice(base.pathname.length - 1))) continue;
      a.href = target.pathname + target.search + target.hash;
    } catch {
      /* A stored value that will not parse as a URL at all. The link keeps the
       * href it was written with. */
    }
  }
}

/**
 * Lift the links now, and again whenever they can have gone stale.
 *
 * A lift at boot answers a page that was just loaded. A page that stays open
 * does not stay current: the catalogue narrowed in another tab, a
 * documentation page read and left, a Back that brought this page out of the
 * back-forward cache - each moves what the other site last wrote, and a link
 * lifted once would still carry the position from before, which reads as a
 * memory that does not work. So the lift is repeated at the moments it can be
 * behind: when the page is shown again, when the tab is looked at again, and -
 * the one that cannot be missed - on the click itself, before the browser
 * follows the href. Capture phase, so nothing that stops the click's
 * propagation is in front of it.
 */
export function keepSiteLinksCurrent(root = document) {
  const lift = () => upgradeSiteLinks(root);
  lift();
  addEventListener("pageshow", (e) => {
    lift();
    /* A page handed back alive by the back/forward cache is where the reader
     * left it, offset and all - so the record a bar link wrote on the way out
     * (handOff below) is spent. Left there, the next arrival at this page
     * within its half minute would inherit it. */
    if (e.persisted) writeStored(HANDOFF_KEY, "");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") lift();
  });
  /* How long the history was when this page arrived - what the step back
   * below compares against where there is no Navigation API to ask. */
  const arrived = history.length;
  root.addEventListener("click", (e) => {
    if (e.target.closest?.("a[data-site]")) lift();
    /* ...and, AFTER the lift, the record that says where the reader is being
     * sent, so the page that arrives can put them back where they were in it
     * rather than at the top of it. `data-back` rather than every link in the
     * bar: the Playground item opens a workbench whose URL carries the code in
     * the editor, which is not a position to come back to. */
    const back = e.target.closest?.("a[data-back]");
    if (back) {
      rememberScroll();
      handOff(back.href);
    }
    /* ...and then the item itself, which goes BACK to its page when that page
     * is still in this tab's history rather than building it again. After
     * the lift, so the page it looks for is the one the href now opens, and
     * after the record, so a step back that turns out to be a reload still
     * lands the reader where they were on the page. */
    const item = e.target.closest?.(".bar-nav a[href]");
    if (item) returnTo(e, item, arrived);
  }, true);
  /* The other moment the offset can be lost: a reader who leaves by any route
   * that is not one of those links. Cheap, and it is the last chance. */
  addEventListener("pagehide", () => rememberScroll());
  restoreScroll();
}

/* ── THE BAR GOES BACK to a page that is still behind you ───────────────────
 *
 * Reported as: press Playground in the bar and the app is built and run again,
 * although it was running a moment ago. Then, once that item went back, the
 * same for the documentation's front door, whose Try it out now example is a
 * playground in a frame. Both true, and for one reason. An item in the bar is
 * a link, a link makes a NEW document, and a new playground boots the whole
 * ABAP runtime and runs the app from the top - two to three seconds, and the
 * app's own state, a half-filled form or a table scrolled to row 200, gone
 * with the document that held it. No browser keeps a running page across a
 * forward navigation. Exactly one mechanism keeps one at all: the back/forward
 * cache, and it applies to a page the reader has BEEN on and is going back
 * (or forward) to.
 *
 * So when the page an item opens is still in this tab's history, the item
 * goes to it there instead of loading it again - Home, Documentation, Samples
 * and Playground alike, which is why this is one rule and not four. The item
 * for the page the reader is ON (Samples on the catalogue, Documentation on
 * every page of the manual) is the browser's to handle, as it always was: a
 * step back to an older copy of the page you are looking at would be a
 * surprise. Two ways of knowing which entry:
 *
 *   - The Navigation API. navigation.entries() is the tab's same-origin
 *     history, and the nearest entry that IS the item's page - same path,
 *     same query - is the one. Any distance, either direction: a reader who
 *     went Samples, then a sample's page, then pressed Playground is two
 *     steps behind it, and one who left it with the Back button is one step
 *     in FRONT of it.
 *   - Without that API, the one case that can be known: this document was
 *     opened from that page (document.referrer) and nothing has been pushed
 *     onto the history since. One step back, then.
 *
 * Where the browser declines to hand the page back alive, a traversal is a
 * reload of that entry - what the link would have done anyway - and the
 * playground says why in the console (main.mjs). And a press has to
 * navigate: a traversal the browser cannot make rejects, a document still
 * here after a moment follows the link after all, and the timer behind that
 * is dropped on pagehide, so a document that WAS handed back does not fire it
 * on the way in and bounce the reader out of the page they returned to.
 *
 * The documentation's bar does the same in scripts/site-js/site.js over in
 * abap2UI5/docs, with entryOf( ) copied into theme/site-memory.js there and
 * pinned by test/bar-back.test.mjs. Change one, change the other. The sample
 * pages import THIS file, through samples/page.mjs.
 */

/** A page, as two history entries are compared: origin, path and query, a
 *  trailing index.html taken off. The fragment is left out - it carries the
 *  code, and the playground drops it from its own URL once the code has been
 *  read (main.mjs), so the entry and the remembered URL can differ in it and
 *  still be one page. */
const pageOf = (url) => url.origin + url.pathname.replace(/index\.html$/, "") + url.search;

/**
 * The key of the history entry nearest to `current` that is the page `href`
 * opens, or null. `entries` is what navigation.entries() answers and `current`
 * the index of the entry the reader is on. Nearest first, because the newer of
 * two playgrounds is the one the href was lifted to; either direction, because
 * the reader may have LEFT the playground with the Back button.
 */
export function entryOf(entries, current, href, base = location.href) {
  let want;
  try {
    want = pageOf(new URL(href, base));
  } catch {
    return null;
  }
  const is = (entry) => {
    try {
      return typeof entry?.url === "string" && pageOf(new URL(entry.url)) === want;
    } catch {
      return false;
    }
  };
  for (let d = 1; d < entries.length; d++) {
    for (const i of [current - d, current + d]) {
      if (i >= 0 && i < entries.length && is(entries[i])) return entries[i].key ?? null;
    }
  }
  return null;
}

/** Without the Navigation API: was this document opened FROM the page `href`
 *  opens, and has nothing been pushed onto the history since it arrived? A
 *  sample's page lives under the playground's path and is a different page,
 *  which is why the whole URL is compared and not the section. */
function cameFrom(href, arrived) {
  if (history.length < 2 || history.length !== arrived) return false;
  try {
    return pageOf(new URL(document.referrer)) === pageOf(new URL(href, location.href));
  } catch {
    /* No referrer, or one that is not a URL: nothing is known. */
    return false;
  }
}

/** A press that means "in a new tab" or "in a new window" still means that. */
const plain = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/* Long enough for a slow connection to commit a traversal that is a reload,
 * short enough that a press which went nowhere is not a dead press. */
const FOLLOW_AFTER = 1500;

function returnTo(e, a, arrived) {
  if (e.defaultPrevented || !plain(e)) return;
  /* A link that opens elsewhere has nothing to go back to. */
  if (a.target && a.target !== "_self") return;
  const href = a.href;
  let want;
  try {
    want = pageOf(new URL(href, location.href));
  } catch {
    return;
  }
  if (want === pageOf(new URL(location.href))) return;
  const nav = globalThis.navigation;
  let step;
  if (nav?.entries && nav.traverseTo) {
    const key = entryOf(nav.entries(), nav.currentEntry?.index ?? -1, href);
    if (key === null) return;
    step = () => nav.traverseTo(key).committed;
  } else if (cameFrom(href, arrived)) {
    step = () => history.back();
  } else {
    return;
  }
  e.preventDefault();
  const follow = () => location.assign(href);
  const later = setTimeout(follow, FOLLOW_AFTER);
  addEventListener("pagehide", () => clearTimeout(later), { once: true });
  Promise.resolve()
    .then(step)
    .catch(() => {
      clearTimeout(later);
      follow();
    });
}

/* ── WHERE ON THE PAGE, not only which page ─────────────────────────────────
 *
 * The links above come back to the page the reader left. They came back to the
 * TOP of it, which on the catalogue - 770 rows, and the whole reason somebody
 * scrolls at all - is most of the way to not having been remembered: the
 * reader who was at sample 400, looked something up in the manual and pressed
 * Samples, arrived at sample 1.
 *
 * So the offset is written down per path, and restored on ARRIVAL BY THE BAR
 * and nowhere else. That last part is the design. A page that restored its
 * offset on every load would fight the browser, which already does it for back
 * and forward, and would surprise a reader who followed an ordinary link to a
 * page they happen to have read before. The bar writes one record - "I am
 * sending you back to X" - and the page that IS X, arriving within seconds,
 * honours it. Everything else ignores it.
 *
 * The counterpart is theme/site-memory.js in abap2UI5/docs: same three keys,
 * same checks, same half of the bar. Change one, change the other.
 */

const SCROLL_KEY = "abap2ui5-playground:scroll";
const HANDOFF_KEY = "abap2ui5-playground:returning";
/* Enough paths to move between the four sections without losing one, and few
 * enough that the value stays a few hundred bytes. */
const SCROLL_MAX = 12;
/* A click and the page it opens are one navigation. Half a minute is a slow
 * connection; older than that is a journey that ended some other way. */
const HANDOFF_TTL = 30_000;

/** This document, as the scroll map keys it - the hash left out, because it is
 *  one page wherever in it the reader entered. */
const path = () => location.pathname + location.search;

const readMap = () => {
  try {
    const map = JSON.parse(readStored(SCROLL_KEY) || "{}");
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  } catch {
    return {};
  }
};

/** Write down how far down this page the reader is. */
export function rememberScroll(y = scrollY, at = path()) {
  if (!Number.isFinite(y) || y < 0) return;
  const map = readMap();
  /* Re-inserted, so the key order is oldest first and the oldest is what falls
   * off the end. */
  delete map[at];
  map[at] = Math.round(y);
  for (const old of Object.keys(map).slice(0, -SCROLL_MAX)) delete map[old];
  writeStored(SCROLL_KEY, JSON.stringify(map));
}

/** The offset stored for a path, or 0. Checked, not followed: anything on this
 *  origin can write there, and scrollTo takes whatever it is given. */
export function scrollOf(at = path()) {
  const y = readMap()[at];
  return Number.isFinite(y) && y >= 0 && y < 1e7 ? y : 0;
}

/** "The reader is being sent to `href`" - written by a bar link as it is
 *  clicked. A link to another host shares no storage, so it writes nothing. */
export function handOff(href) {
  if (!href) return;
  try {
    const to = new URL(href, location.href);
    if (to.origin !== location.origin) return;
    writeStored(HANDOFF_KEY, JSON.stringify({ to: to.pathname + to.search, at: Date.now() }));
  } catch {
    /* Not a URL. Nothing is restored, which is the behaviour without any of
     * this and not a broken one. */
  }
}

/**
 * Put the reader back where they were, but only if the bar just sent them
 * here. Reading the record CONSUMES it: it describes one arrival, and a second
 * read would be a later navigation inheriting somebody else's destination.
 */
export function restoreScroll() {
  let record = null;
  try {
    record = JSON.parse(readStored(HANDOFF_KEY) || "null");
  } catch {
    record = null;
  }
  writeStored(HANDOFF_KEY, "");
  if (!record || typeof record.to !== "string" || typeof record.at !== "number") return;
  const age = Date.now() - record.at;
  /* Backwards too: a clock that moved, or a timestamp written into the future,
   * is not an age this trusts. */
  if (!(age >= 0 && age < HANDOFF_TTL)) return;
  /* The record has to name THIS page. It is written before a navigation that
   * may never happen - a middle click, a reader who went somewhere else - so
   * arriving anywhere but at `to` means it was not this journey. */
  if (record.to !== path()) return;
  /* A destination the reader named beats one this remembered. */
  if (location.hash) return;
  const y = scrollOf(record.to);
  if (y > 0) settle(y);
}

/**
 * Scroll to `y`, and keep scrolling to it until it takes.
 *
 * One `scrollTo` is not enough on the page this exists for: the catalogue
 * draws its 770 rows from a fetch, so at the moment this runs the document is
 * a header and nothing else, and the browser clamps an offset a short document
 * cannot reach - to zero. It went to the top, which is exactly what it is here
 * to stop. So it is re-applied as the page grows, for up to three seconds.
 *
 * WHAT CANCELS IT IS THE READER, AND NOTHING ELSE. It used to stop as soon as
 * `scrollY` was not where the last frame put it, on the theory that a scroll
 * this did not cause is the reader taking over. It is not: a page still
 * loading moves its own scroll - the browser's scroll anchoring shifts the
 * offset to keep the content under your eyes steady as things arrive above it.
 * That read as a reader, and the restore gave up a little way down. So the
 * reader is asked directly: a wheel, a touch, a key, a pointer. Layout
 * settling is not one of those.
 */
function settle(y) {
  const until = Date.now() + 2000;
  const MOVED = ["wheel", "touchstart", "keydown", "pointerdown"];
  let stopped = false;
  const stop = () => {
    stopped = true;
    for (const e of MOVED) removeEventListener(e, stop, true);
  };
  for (const e of MOVED) addEventListener(e, stop, { capture: true, passive: true });

  /* IT HOLDS THE POSITION, it does not merely reach it. Reaching it once and
   * stopping is how this failed over on the documentation, whose router draws
   * the page and then scrolls it to the top ITSELF, after this - measured, in
   * that order, `scrollTo(0, 1600)` and then `scrollTo(0, 0)`. Two seconds of
   * holding covers that and a page still growing underneath.
   *
   * Holding is only safe BECAUSE the reader can take it back: the four events
   * above end it on the first wheel, key, touch or pointer - a scrollbar drag
   * included - so nothing is ever fought with. */
  const put = () => {
    if (stopped) return;
    if (Math.round(scrollY) !== y) scrollTo(0, y);
    if (Date.now() < until) requestAnimationFrame(put);
    else stop();
  };
  requestAnimationFrame(put);
}
