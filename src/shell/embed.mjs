// What an embedded playground tells the page that embedded it.
//
// A documentation page putting a live demo in an iframe needs two things it
// cannot find out on its own: when the demo is up (to take a spinner away, or
// to reveal the frame at all), and how tall it wants to be (an app that is four
// fields high should not sit in the middle of a 520px box).
//
// Both travel as postMessage. The protocol is deliberately one-way and tiny -
// the embedding page listens, it does not command. Anything it could ask for it
// can already put in the URL.
//
//   { source: "abap2ui5-playground", type: "ready" }
//   { source: "abap2ui5-playground", type: "height", height: <css pixels> }
//   { source: "abap2ui5-playground", type: "status", state: "running" | "error",
//     message: <the line the status bar shows> }
//
// Sent to "*", because the embedding page's origin is not knowable from here
// and the content is a height and a status line - nothing that is worth
// protecting and nothing an attacker could not read by loading the same URL.
const SOURCE = "abap2ui5-playground";

let enabled = false;

export function startEmbedMessages() {
  // Only when actually framed. A playground opened directly has no parent to
  // talk to, and window.parent is itself when there is no frame.
  enabled = window.parent !== window;
}

function send(message) {
  if (!enabled) return;
  try {
    window.parent.postMessage({ source: SOURCE, ...message }, "*");
  } catch {
    // A parent that cannot be posted to is a parent that does not want to
    // listen. Nothing here is worth failing a run over.
  }
}

export function announceReady() {
  send({ type: "ready" });
}

export function announceStatus(message, isError) {
  send({ type: "status", state: isError ? "error" : "running", message });
}

// How tall the app in the frame would like to be, measured from the document
// the app rendered rather than from the box it was given - the box is what we
// are trying to correct. Only answerable in app-only mode: with an editor
// beside it, the height is whatever the embedding page decided the editor
// deserves, and no measurement here improves on that.
//
// Measured once when the frame loads and then whenever what it rendered
// changes size. The load event alone was not enough: an abap2UI5 app grows
// after it starts - a table fills, a panel opens, a dialog pushes the page
// down - and every one of those left the demo in the box it was given at
// boot, scrolling inside somebody's documentation page. The observer is what
// makes the height message a live figure rather than a first impression.
//
// What this can and cannot answer, because it has been read as more than it
// is: `scrollHeight` is never SMALLER than the box, so a document reports a
// height above the one it was given only when it overflows. An app laid out at
// 100% of its box - a `Shell` around a `Page`, which is most of them - never
// overflows, so every measurement here confirms the box it already has. That
// is not a defect to fix here; it is the shape of the question. It means the
// starting height the embedding page chooses is the height such an app is read
// at, and the loader's default is set for that rather than for growing into.
export function announceAppHeight(frame) {
  if (!enabled) return;
  watchAppHeight(frame);
  measureAndSend(frame);
}

// The last height sent, so a resize that settles on the same pixel does not
// spend a message. UI5 lays a view out more than once before it is done.
let lastHeight = 0;
let observer;
let observed;
let pending = 0;
let sent = 0;

// How many times one app document may change this page's mind about its height.
//
// The loop this bounds is real rather than theoretical: the page around us sets
// the frame's height from what we send, that resizes the document we are
// measuring, and that is a resize event. It settles - the parent applies what we
// send, so the next measurement matches and nothing more goes out - unless the
// app's layout is responsive in a way that reflows to a different height at the
// height we just asked for, which is the one shape that can oscillate. Twenty is
// far past what settling takes and turns an oscillation into a stationary demo
// rather than a message every frame forever.
const MAX_HEIGHT_MESSAGES = 20;

function measureAndSend(frame) {
  const doc = sameOriginDocument(frame);
  if (!doc) return;
  const height = Math.ceil(
    Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0),
  );
  if (height <= 0 || height === lastHeight) return;
  if (sent >= MAX_HEIGHT_MESSAGES) {
    observer?.disconnect();
    return;
  }
  lastHeight = height;
  sent += 1;
  send({ type: "height", height });
}

// Coalesced to one measurement a frame. A UI5 view settling fires the observer
// several times in a row, and each one would otherwise be a postMessage and a
// height the parent applies and immediately replaces.
function measureSoon(frame) {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    measureAndSend(frame);
  });
}

// One observer, re-pointed at whatever document the frame currently holds.
// Run replaces that document on every press, and an observer left watching the
// old one would report the height of a page that is gone.
//
// Both the root element and the body are watched: which of the two actually
// changes size depends on how the app's own view is laid out, and an app whose
// body is a fixed 100% grows only at the root.
function watchAppHeight(frame) {
  if (typeof ResizeObserver !== "function") return;
  const doc = sameOriginDocument(frame);
  const root = doc?.documentElement;
  if (!root || root === observed) return;

  observer?.disconnect();
  // Reset with the document: the new app is not the old one, may legitimately
  // want the height the old one had, and gets its own allowance of messages.
  lastHeight = 0;
  sent = 0;
  observed = root;
  observer = new ResizeObserver(() => measureSoon(frame));
  observer.observe(root);
  if (doc.body) observer.observe(doc.body);
}

function sameOriginDocument(frame) {
  try {
    // Same origin by construction - the app is served from this site - but a
    // frame mid-navigation answers with null rather than a document.
    return frame.contentDocument;
  } catch {
    return undefined;
  }
}
