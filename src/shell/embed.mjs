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
//   { source: "abap2ui5-playground", type: "edited", edited: true | false }
//
// "edited" is sent when the reader's code stops being the code the page
// embedded, and again (edited: false) when it is that code once more - undone
// back to it, or Reset. Only on the change, never per keystroke.
//
// And ONE message the other way, the single exception to "it does not
// command": { source: "abap2ui5-embed", type: "reset" } puts the code the page
// embedded back and runs it - the loader's "Reset example" button. Accepted
// only from the window that framed this one (e.source === window.parent), the
// same check the loader makes the other way round; the origin is not knowable,
// and nothing here needs it to be - the worst a stranger can do with it is
// show the reader the example the page asked for.
//
// Sent to "*", because the embedding page's origin is not knowable from here
// and the content is a height and a status line - nothing that is worth
// protecting and nothing an attacker could not read by loading the same URL.
import { getFiles, lockEditor, markLines, setFiles } from "../editor/editor.mjs";
import { onFrameMessage } from "./frame-link.mjs";

const SOURCE = "abap2ui5-playground";
// The loader's name on the one message it sends in (abap2ui5-embed.js).
const HOST = "abap2ui5-embed";

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
// Measured by the frame itself, whenever what it rendered changes size
// (frontend-bridge.js, asked for in the "settings" frame-link.mjs sends an
// app-only page's frame): this page does not reach into the frame's
// document. The load event alone was not enough: an abap2UI5 app grows
// after it starts - a table fills, a panel opens, a dialog pushes the page
// down - and every one of those left the demo in the box it was given at
// boot, scrolling inside somebody's documentation page. The frame's
// reports are what make the height message a live figure rather than a
// first impression; from the Run's first, once the app is up.
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
  watched = frame;
  if (latest > 0) consider(latest);
}

// The last height sent, so a resize that settles on the same pixel does not
// spend a message. UI5 lays a view out more than once before it is done.
let lastHeight = 0;
let sent = 0;
// The frame whose height is said (Run's, once an app is up), the document
// it last reported from and the last height it reported.
let watched;
let heightDoc;
let latest = 0;

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

function consider(height) {
  if (height <= 0 || height === lastHeight || sent >= MAX_HEIGHT_MESSAGES) return;
  lastHeight = height;
  sent += 1;
  send({ type: "height", height });
}

onFrameMessage("height", (link, m) => {
  if (!enabled || typeof m.height !== "number") return;
  // Reset with the document: the new app is not the old one, may
  // legitimately want the height the old one had, and gets its own allowance
  // of messages.
  if (m.doc !== heightDoc) {
    heightDoc = m.doc;
    lastHeight = 0;
    sent = 0;
  }
  latest = Math.ceil(m.height);
  if (link.frame === watched) consider(latest);
});

// ------------------------------------------------- what the page asked for

// `?lines=12-18,25` - the lines an embedding page wants read first. Written
// the way a sample page's address is too (#L42-L58), so a link copied off one
// of those works here as it stands: "L42-L58", "#L42-L58" and "42-58" are all
// the same range. Lines count from 1; anything else in the list is skipped
// rather than refusing the rest, and a page cannot make this walk more than a
// handful of ranges.
export function parseLines(text) {
  const ranges = [];
  for (const part of String(text ?? "").split(/[\s,]+/).filter(Boolean).slice(0, 20)) {
    const m = /^#?L?(\d+)(?:-L?(\d+))?$/i.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b < 1) continue;
    ranges.push({ from: Math.min(a, b), to: Math.max(a, b) });
  }
  return ranges;
}

// What the embedding page asked for, applied once the editor exists:
// read-only, marked lines, and the code it embedded kept for "edited" and for
// Reset. Called by main.mjs on an embedded playground only.
//
//   ?readonly=1   the editor takes no typing; Format, Undo, Redo, Fix them and
//                 the View tab's Edit go with it (body.is-read-only in
//                 shell.css). Run still runs - the point of a read-only
//                 example is that it is read AND seen working.
//   ?lines=…      see parseLines( ) above.
//
// `run` is the playground's Run, for Reset to start the restored code with.
let original;
let originalFiles;
let edited = false;
let ranges = [];

export function setUpEmbeddedEditor(params, { run }) {
  originalFiles = getFiles();
  original = JSON.stringify(originalFiles);
  const readOnly = params.has("readonly") && params.get("readonly") !== "0";
  if (readOnly) {
    lockEditor();
    document.body.classList.add("is-read-only");
  }
  ranges = parseLines(params.get("lines"));
  if (ranges.length) markLines(ranges);

  window.addEventListener("message", (e) => {
    if (!enabled || e.source !== window.parent) return;
    if (e.data?.source !== HOST || e.data.type !== "reset") return;
    if (readOnly || !edited) return;
    // Through setFiles( ), which rewrites a file still open as an edit: the
    // reader who pressed Reset by mistake has their version a Ctrl+Z away.
    setFiles(originalFiles);
    if (ranges.length) markLines(ranges);
    run();
  });
}

// Every debounced change to the files comes through here (main.mjs's
// remember( )). Said to the page only when the answer changes.
export function announceEdited(files) {
  if (original === undefined) return;
  const now = JSON.stringify(files) !== original;
  if (now === edited) return;
  edited = now;
  send({ type: "edited", edited: now });
}
