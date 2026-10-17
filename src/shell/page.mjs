// Which page this is. One bundle runs five of them - the playground, the
// playground embedded in somebody else's page, the app on its own, the AI
// Studio and the AI Pilot - and what each of them restores, stores and shows
// is decided by the answers here, read once from the address and the
// document. Kept apart from main.mjs because the run, the opening of files
// and Auto all ask the same questions.

export const params = new URLSearchParams(window.location.search);

// Embedded in somebody else's page: no chrome, no sample menu, just the code it
// was given and the app it produces. `?embed=1` in the query, the code in the
// fragment as usual.
export const embedded = params.get("embed") === "1";

// The AI Studio's page (ai/index.html, written by tools/build-site.mjs from
// this document): the studio opens on its own, on the minimal class of
// ai-starter.mjs, and what is built there is neither restored from nor stored
// over the playground's own draft. The playground itself has no way into the studio while it is being
// built - its address is the door.
export const aiPage = document.documentElement.dataset.page === "ai";

// The AI Pilot's page (pilot/index.html, written the same way): a chat in
// which Claude operates the running app while the reader watches - see
// src/shell/pilot.mjs. It opens on what a link carries, else on the default
// sample, and like the studio it neither restores nor stores the
// playground's draft.
export const pilotPage = document.documentElement.dataset.page === "pilot";

// The app and nothing else - no editor, and no bar over it either, so what is
// on screen is the app rather than a playground showing one. Two names for it,
// because they are two different asks with the same answer: `?view=full` is
// what the Full screen button opens, and `?view=app` is the paragraph in a
// documentation page that wants to show the result rather than the code that
// produced it. The code is still what runs; it is just not on screen, so the
// page stays a playground rather than a screenshot.
//
// The bar used to stay in `?view=app` on the theory that a demo which cannot
// be restarted is a screenshot. It is not: an embedded demo runs by itself,
// and everything the bar offered next to it - Run again, the source, undo -
// is a click away in "Open in the playground", which the page around the
// frame already prints. What it did instead was put a strip of somebody
// else's furniture across the top of a documentation page. The one thing that
// still brings it back is trouble (`has-trouble`): in this view the status
// line is the only channel there is, so a link that could not be followed has
// to have somewhere to say so.
export const appOnly = params.get("view") === "app" || params.get("view") === "full";

// The playground proper: the one page that keeps the reader's draft, which
// file was on screen and the named drafts. Neither an embedding (it shows what
// its page asked for), nor the AI Studio (its own key, see remember( ) in
// main.mjs), nor the AI Pilot (it operates an app rather than editing one).
export const keepsDrafts = !embedded && !aiPage && !pilotPage;

/* Opened from the sample catalogue - see showSourceLink( ) in main.mjs.
 * `back` is that page's own query string, passed through so the reader lands
 * on the search they had narrowed the list to. It is rebuilt through
 * URLSearchParams rather than pasted into the href, so nothing a link carries
 * escapes into the markup: what comes back out is a query string and only
 * ever that. */
export const cameFromCatalogue = params.get("from") === "catalogue";
export const catalogueQuery = (() => {
  const back = params.get("back") || "";
  if (back === "") return "";
  const clean = new URLSearchParams(back).toString();
  return clean === "" ? "" : `?${clean}`;
})();

// The app frame on the right - Run's, and on the Pilot's page the first of
// its tabs.
export const frame = document.getElementById("app");

// Whether the app frames of this page run on an OPAQUE origin - an iframe
// sandbox without allow-same-origin (src/shell/frame-link.mjs) - so that an
// app's own script cannot reach into this page. On the AI Studio's and the
// AI Pilot's pages: that is where the reader's API key is typed and held,
// and where a link's code (the Pilot's) runs beside it.
//
// Not on the playground, the embeds and ?view=app, and for a measured
// reason: a document on an opaque origin gets no HTTP cache in Chromium
// (its requests carry a one-off network isolation key) and is controlled by
// no service worker. The frame's first load - UI5's core, the library
// preloads, the theme, the fonts - was then downloaded in full for every
// frame document on every visit (served by tools/serve.mjs with a ten-minute
// max-age, a reload of an isolated frame asked the server for all of it
// again, a frame that is not isolated for none of it), warm-up.mjs warmed a
// cache the frame could not read, and the installed playground could not
// start an app offline at all. A documentation page with five embedded demos
// would download UI5 five times. Those pages hold no key; the playground's
// one secret, the Gist token, is behind the question linked-code.mjs asks.
// The bridge speaks the same messages either way, so this is the one switch.
export const frameIsolated = aiPage || pilotPage;
