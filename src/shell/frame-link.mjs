// @ts-check
// The page's half of the line to an app frame - frontend-bridge.js is the
// other half. Nothing crosses it but messages: the page never reaches into
// the frame's document or window, and the frame never reaches into this
// page. That is what lets the frame live on an OPAQUE origin (a `sandbox`
// without allow-same-origin, see `isolate( )`): the app's own script - a
// view's core:HTML, anything the app loads - then cannot read this page's
// DOM (the key forms of the AI Studio and the AI Pilot), its memory, its
// storage, or patch its fetch. The frame's messages say what the app asks
// and how the frame is; the page's say what the frame is answered and
// asked. Neither carries anything this page would mind the app reading:
// the app's own roundtrip answers, its theme, whether to leave the focus
// alone, whether the page takes dropped files.
//
// The protocol. Every message is an object with `z2ui5Frame: 1` and a
// `type`; the frame's also carry `doc`, the id of the document that sent
// it (a reload is a new document, and a late message of the old one is not
// the new one's).
//
//   frame -> page (to this page's origin only)
//     state      { href, readyState, ui5, app, restarts, busy, slots,
//                pending, seen }
//                whenever it changes: where the document is, and what the
//                AI reads before it acts. `seen` is the last call answered.
//     roundtrip  { id, body, href }  the frontend's POST - answered by
//                "answer" { id, status, reason, body } or { id, error }
//     reply      { id, ok, value, error }  the answer to a "call"
//     drop       { files }  files dropped on the app (pages that take them)
//     height     { height }  the document's height (embedded ?view=app)
//   page -> frame (to "*": an opaque origin has no name to address it by,
//   which is why nothing secret is ever sent)
//     answer     see above
//     call       { id, op, args }  op: roundtrip, frontend, fill, carry,
//                restart, state - see frontend-bridge.js
//     theme      { theme }
//     hold       { hold }  whether a focus( ) in the frame is to be skipped
//     settings   { takesFiles, height }
//
// A message is taken only from the window of a frame registered here
// (`e.source`), with the origin that frame has: "null" for an isolated one,
// this page's own for one that is not.
import { appOnly, frame as runFrame, frameIsolated } from "./page.mjs";

/** The sandbox an isolated frame gets: scripts (UI5 is nothing but), forms
 *  (an app's own submit), popups (a link the app opens - in a sandbox of its
 *  own, since allow-popups-to-escape-sandbox is not here), modals (a
 *  confirm( ) an app may still call), downloads (a file the app offers).
 *  Not allow-same-origin - the whole point - and not allow-top-navigation:
 *  an app cannot take the page away from the reader. */
export const SANDBOX = "allow-scripts allow-forms allow-popups allow-modals allow-downloads";

/** Puts a frame on an opaque origin - effective from its next navigation. */
export function isolate(frame) {
  frame.setAttribute("sandbox", SANDBOX);
}

const isIsolated = (frame) => frame.hasAttribute("sandbox") && !/\ballow-same-origin\b/.test(frame.getAttribute("sandbox") ?? "");

/** @type {Map<HTMLIFrameElement, ReturnType<typeof createLink>>} */
const links = new Map();

/**
 * What the page does for the frames - set by agent-hooks.mjs once the
 * runtime is up: `roundtrip(body, from, frame)` answers { status, reason,
 * body }, `dropFiles(files)` when the page takes them, `holdFocus( )`
 * whether a frame should leave the focus alone right now.
 * @type {{ roundtrip?: Function, dropFiles?: Function, holdFocus?: () => boolean }}
 */
let host = {};
/** @type {Map<string, Set<Function>>} */
const listeners = new Map();

function createLink(frame) {
  let nextCall = 1;
  /** @type {Map<number, { resolve: Function, reject: Function, timer: any }>} */
  const calls = new Map();
  /** @type {any} */
  let state = null;
  let doc = null;
  let staleDoc = null;
  // The last roundtrip call: until the frame has reported after answering
  // it, the frame counts as busy - its own report may still be on its way.
  let roundtripCall = 0;
  /** @type {Function[]} */
  let upWaiters = [];

  function post(message) {
    try {
      frame.contentWindow?.postMessage({ z2ui5Frame: 1, ...message }, "*");
    } catch {
      // a frame being removed
    }
  }

  function call(op, args = [], ms = 15000) {
    if (!state) return Promise.reject(new Error("the app frame is not there"));
    const id = nextCall++;
    if (op === "roundtrip") roundtripCall = id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        calls.delete(id);
        reject(new Error(`the app frame did not answer (${op})`));
      }, ms);
      calls.set(id, { resolve, reject, timer });
      post({ type: "call", id, op, args });
    });
  }

  // A call whose answer nobody waits for: refused or lost, the same as false.
  const quietly = (op, args) => call(op, args).catch(() => false);

  /** The frame's document went (a navigation): what it said is not the
   *  next one's, and what was asked of it is not coming. */
  function reset() {
    staleDoc = doc ?? staleDoc;
    doc = null;
    state = null;
    for (const { reject, timer } of calls.values()) {
      clearTimeout(timer);
      reject(new Error("the app frame was reloaded"));
    }
    calls.clear();
  }

  function settings() {
    post({ type: "settings", takesFiles: typeof host.dropFiles === "function", height: appOnly && frame === runFrame });
    post({ type: "hold", hold: Boolean(host.holdFocus?.()) });
  }

  function heard(message) {
    if (message.doc === staleDoc) return false;
    if (message.doc !== doc) {
      // A document this link has not heard from: the old one's calls are
      // over, and the new one is told how this page wants it.
      if (doc !== null) reset();
      doc = message.doc;
      settings();
    }
    if (message.type === "state") {
      state = message;
      if (state.ui5) {
        for (const resolve of upWaiters.splice(0)) resolve(true);
      }
    } else if (message.type === "reply") {
      const waiting = calls.get(message.id);
      if (!waiting) return true;
      calls.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.ok) waiting.resolve(message.value);
      else waiting.reject(new Error(String(message.error ?? "the app frame refused")));
    }
    return true;
  }

  // What the AI rooms used to read off the frame's window
  // (__z2ui5PlaygroundPilot): the same names, the reads answered from the
  // frame's last report, the rest asked by message. Null until the frame's
  // bridge has spoken - an error page, or a frame not loaded yet.
  const api = {
    busy: () => Boolean(state?.busy) || (state?.seen ?? 0) < roundtripCall,
    slots: () => (Array.isArray(state?.slots) ? state.slots : null),
    pending: () => (state?.pending && typeof state.pending === "object" ? state.pending : {}),
    /** A fresh report, waited for - before the screen is read for the model. */
    refresh: () => call("state", [], 5000).catch(() => false),
    /** Answers whether the frame sent it: false when there is no app. */
    roundtrip: () => call("roundtrip").then((sent) => sent === true, () => false),
    frontend: (args) => quietly("frontend", [args]),
    fill: (slot, path, value) => quietly("fill", [slot, path, value]),
    carry: (paths) => quietly("carry", [paths]),
  };

  return {
    frame,
    heard,
    reset,
    post,
    call,
    settings,
    get state() {
      return state;
    },
    api: () => (state ? api : null),
    /** Resolves true once the frame's document has UI5 up, false after `ms`. */
    up(ms) {
      if (state?.ui5) return Promise.resolve(true);
      return new Promise((resolve) => {
        const done = (v) => {
          clearTimeout(timer);
          upWaiters = upWaiters.filter((w) => w !== done);
          resolve(v);
        };
        const timer = setTimeout(() => done(false), ms);
        upWaiters.push(done);
      });
    },
  };
}

/** The line to `frame`, made on first use. Every app frame on the page is
 *  one: Run's (#app), and the AI Pilot's tabs (pilot.mjs). */
export function linkOf(frame) {
  let link = links.get(frame);
  if (!link) {
    link = createLink(frame);
    links.set(frame, link);
  }
  return link;
}

/** A frame taken off the page (a Pilot tab closed). */
export function unlink(frame) {
  links.get(frame)?.reset();
  links.delete(frame);
}

/** The AI rooms' handle on a frame's app, or null - see `api` above. */
export const frameApi = (frame) => (frame ? (links.get(frame)?.api() ?? null) : null);

/*
 * Loads `href` into the frame, replacing the document it holds rather than
 * pushing one: setting `src` on an iframe adds an entry to the TAB's history,
 * so after a few Runs the Back button stepped through old app frames
 * instead of leaving the page. location.replace( ) is one of the two things
 * a page may do to a frame of another origin, so it works on an isolated
 * frame too. The first load (nothing in the frame that spoke yet) sets
 * `src`, which has nothing to replace.
 */
export function navigate(frame, href) {
  const link = linkOf(frame);
  const loaded = link.state !== null;
  link.reset();
  frame.dataset.src = href;
  if (loaded) {
    try {
      frame.contentWindow?.location.replace(href);
      return;
    } catch {
      // set src instead
    }
  }
  frame.src = href;
}

/** `fn(link, message)` for every message of `type` a frame sends. */
export function onFrameMessage(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)?.add(fn);
}

/** What the page does for its frames (agent-hooks.mjs), and each frame told. */
export function serveFrames(given) {
  host = given;
  for (const link of links.values()) if (link.state) link.settings();
}

/** Says something to every app frame - the theme, a hold on the focus. */
export function tellFrames(message) {
  for (const link of links.values()) link.post(message);
}

function linkFrom(e) {
  for (const link of links.values()) {
    if (link.frame.contentWindow !== e.source || !e.source) continue;
    const origin = isIsolated(link.frame) ? "null" : window.location.origin;
    return e.origin === origin ? link : null;
  }
  return null;
}

// The pilot tab a roundtrip claims (?pilot=) has to be the frame's own: an
// app cannot take a request the Pilot parked for another tab.
function sameTab(link, from) {
  try {
    const claimed = new URL(from, document.baseURI).searchParams.get("pilot");
    const own = link.frame.dataset.src ? new URL(link.frame.dataset.src, document.baseURI).searchParams.get("pilot") : null;
    return claimed === own;
  } catch {
    return false;
  }
}

async function answerRoundtrip(link, m) {
  const reply = (fields) => link.post({ type: "answer", id: m.id, ...fields });
  if (typeof m.body !== "string" || typeof m.href !== "string") {
    reply({ error: "a roundtrip without a body" });
    return;
  }
  if (!host.roundtrip) {
    reply({ error: "the playground is not ready to answer the app yet" });
    return;
  }
  if (!sameTab(link, m.href)) {
    reply({ error: "this app is not the one in this frame" });
    return;
  }
  try {
    const response = await host.roundtrip(m.body, m.href, link.frame);
    // What the frontend reads, and nothing else the runtime said (the
    // console, the state snapshot - this page's to show).
    reply({ status: response.status, reason: response.reason ?? "", body: String(response.body ?? "") });
  } catch (e) {
    reply({ error: String(e?.message ?? e) });
  }
}

window.addEventListener("message", (e) => {
  const m = e.data;
  if (!m || typeof m !== "object" || m.z2ui5Frame !== 1 || typeof m.type !== "string" || typeof m.doc !== "string") return;
  const link = linkFrom(e);
  if (!link || !link.heard(m)) return;
  if (m.type === "roundtrip" && typeof m.id === "number") {
    answerRoundtrip(link, m);
  } else if (m.type === "drop" && Array.isArray(m.files)) {
    const files = m.files.filter((f) => f instanceof File);
    if (files.length > 0) host.dropFiles?.(files);
  }
  for (const fn of listeners.get(m.type) ?? []) fn(link, m);
});

// Whether a frame should leave the focus alone, told to every frame when the
// answer changes: the frame cannot ask at the moment of its focus( ) - that
// is synchronous - so it is told ahead of it. What can change the answer is
// the focus moving on this page, and a dialog opening or closing.
let held = false;
function sayHold() {
  const now = Boolean(host.holdFocus?.());
  if (now === held) return;
  held = now;
  tellFrames({ type: "hold", hold: now });
}
const sayHoldSoon = () => setTimeout(sayHold, 0);
document.addEventListener("focusin", sayHold);
document.addEventListener("focusout", sayHoldSoon);
window.addEventListener("blur", sayHoldSoon);
window.addEventListener("focus", sayHoldSoon);
new MutationObserver(sayHold).observe(document.documentElement, {
  subtree: true,
  attributes: true,
  attributeFilter: ["open", "hidden"],
});

// Run's frame, from the start - and on an opaque origin where the page
// says so (page.mjs), before anything is loaded into it.
if (runFrame instanceof HTMLIFrameElement) {
  if (frameIsolated) isolate(runFrame);
  linkOf(runFrame);
}
