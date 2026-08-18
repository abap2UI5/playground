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
export function announceAppHeight(frame) {
  if (!enabled) return;
  const doc = sameOriginDocument(frame);
  if (!doc) return;
  const height = Math.ceil(
    Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0),
  );
  if (height > 0) send({ type: "height", height });
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
