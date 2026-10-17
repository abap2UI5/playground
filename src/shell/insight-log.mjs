// The Log tab: the one message the page has for the reader - a startup note,
// an ABAP error, a dump (ui.mjs keeps it; showOutput( ) writes it). Anything
// written there opens the panel on this tab (setUpInsight( ) in insight.mjs).
import { currentLog, hideOutput } from "./ui.mjs";
import { blockHead, empty } from "./insight-common.mjs";

// A dot on the Log tab while there is something unread in it, so switching
// away does not hide that something went wrong.
export function paintLogDot(entry = currentLog()) {
  const dot = document.getElementById("log-dot");
  if (!dot) return;
  const has = entry.body !== "";
  dot.textContent = has ? "!" : "";
  dot.className = `insight-badge${has ? " is-error" : ""}`;
}

export function logTab() {
  const entry = currentLog();
  if (entry.body === "") {
    return empty("Nothing has gone wrong yet. Startup notes, ABAP errors and dumps land here.");
  }

  const wrap = document.createElement("div");
  wrap.className = "log";

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "ghost";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => hideOutput());

  const body = document.createElement("pre");
  body.className = "log-body";
  body.textContent = entry.body;

  wrap.append(blockHead(entry.title, clear), body);
  return wrap;
}
