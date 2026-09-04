// The two bits of chrome every other module needs: the status line in the bar,
// and the longer text that goes under it.
import { announceStatus } from "./embed.mjs";

const statusEl = () => document.getElementById("status");

export function setStatus(text, isError = false) {
  const el = statusEl();
  el.textContent = text;
  el.classList.toggle("error", isError);
  // Under ?view=full there is no bar at all, and the status line is the only
  // channel that mode has left - the panel the log lands in lives in the pane
  // it hides. So trouble brings the bar back rather than being written into
  // something nobody can see, and a status that is no longer an error takes it
  // away again. Everywhere else the class does nothing.
  document.body.classList.toggle("has-trouble", isError);
  // An embedded playground hides most of its bar, so the page around it is
  // where a reader would look for this. Sent from here rather than from the
  // callers, so a status that is set anywhere is a status that travels.
  announceStatus(text, isError);
}

// What the page has to say at length - a startup failure, a dump, the errors
// that stopped a Run. It lands in the panel's Log tab rather than in a window
// of its own: one place at the bottom of the page, not two.
//
// Kept here rather than in insight.mjs because everything that reports already
// calls these two, and the panel is a detail of where the text ends up.
let log = { title: "", body: "" };
const listeners = new Set();

export const currentLog = () => ({ ...log });
export const onLogChange = (fn) => listeners.add(fn);
const announce = () => {
  for (const fn of listeners) fn(currentLog());
};

export function showOutput(title, body) {
  log = { title, body };
  announce();
}

// An error as text somebody can act on: what went wrong, then where.
//
// `String(e.stack)` looks like it says both and only says both in Chrome. V8
// begins a stack with "RangeError: message" and everything else - WebKit, Gecko
// - puts frames in `stack` and nothing else. So the startup failure this page
// reports read as a wall of minified frames on an iPhone with no message
// anywhere in it, and "RangeError: Maximum call stack size exceeded" - the
// whole of what had gone wrong, and the only part worth reading - never reached
// the screen. The report has to carry the message itself rather than trust the
// stack to have brought it.
export function describeError(e) {
  const message = String(e?.message ?? e);
  const name = typeof e?.name === "string" && e.name !== "" ? e.name : "";
  const headline = name && !message.startsWith(name) ? `${name}: ${message}` : message;
  const stack = typeof e?.stack === "string" ? e.stack : "";
  if (stack === "") return headline;
  // Where the browser did put the message at the top, this would repeat it.
  return stack.split("\n", 1)[0].includes(message) ? stack : `${headline}\n${stack}`;
}

export function hideOutput() {
  if (log.title === "" && log.body === "") return;
  log = { title: "", body: "" };
  announce();
}
