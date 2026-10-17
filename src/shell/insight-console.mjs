// The Console tab: what the app WRITEs, one block per roundtrip that wrote
// anything, headed by the roundtrip it came with - the same number and event
// the Roundtrips tab lists it under. On a system a WRITE in an abap2UI5 app
// goes to a list screen nobody sees; here it is the quickest way to look at a
// value, so it is kept where it can be read. It lives on the roundtrips
// (roundtrips.mjs), so it is bounded with them and a Run starts it afresh;
// insight-roundtrips.mjs follows them for both tabs.
import { roundtripList } from "./roundtrips.mjs";
import { blockHead, empty } from "./insight-common.mjs";

// The roundtrips that WRITE something, by how many: a count, not a dot - the
// output is the app talking, not something gone wrong, and it never takes the
// panel the way a Log entry does.
export function paintConsoleCount() {
  const badge = document.getElementById("console-count");
  if (!badge) return;
  const written = roundtripList().filter((r) => r.console !== "").length;
  badge.textContent = written === 0 ? "" : String(written);
  badge.className = "insight-badge";
}

export function consoleTab() {
  const written = roundtripList().filter((r) => r.console !== "");
  if (written.length === 0) {
    return empty("Nothing written yet. What the app WRITEs lands here, under the roundtrip that wrote it - a Run starts it afresh.");
  }
  const wrap = document.createElement("div");
  wrap.className = "console";
  for (const entry of written) {
    const head = blockHead(`#${entry.n} ${entry.args.length > 0 ? `${entry.event} (${entry.args.join(", ")})` : entry.event}`);
    const pre = document.createElement("pre");
    pre.className = "log-body console-body";
    pre.textContent = entry.console;
    wrap.append(head, pre);
  }
  return wrap;
}
