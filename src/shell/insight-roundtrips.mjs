// The Roundtrips tab: the conversation between the frontend and the app, one
// row per roundtrip (recorded by the bridge in main.mjs into roundtrips.mjs) -
// the event, how long the ABAP took, and what the answer did: a view, a
// popup, a model update, a dump. A row opens up into the request and the
// response as they travelled, and the view XML the answer carried, one
// element per line.
import { onRoundtrip, roundtripList } from "./roundtrips.mjs";
import { copyToClipboard } from "./share.mjs";
import { prettyXml } from "./xml-pretty.mjs";
import { highlighted } from "./highlight.mjs";
import { blockHead, empty, openTab, redraw } from "./insight-common.mjs";
import { paintConsoleCount } from "./insight-console.mjs";

// Which roundtrip is opened up in the list, by its number; a new Run starts
// the numbering over and clears this (the onRoundtrip listener below).
let openedRoundtrip;

// The two tabs drawn off the roundtrips, this one and the Console.
const FED = ["roundtrips", "console"];

// A roundtrip landing while its tab is open is listed as it lands; the badges
// count them whichever tab is open. `body` is the panel's body, where a
// selection somebody is making holds the redraw back.
export function followRoundtrips(body) {
  let behind = false;
  const selectingInBody = () => {
    const sel = document.getSelection();
    return !!sel && !sel.isCollapsed && sel.rangeCount > 0 && body.contains(sel.getRangeAt(0).commonAncestorContainer);
  };

  onRoundtrip(() => {
    // A cleared list is a new Run, whose numbering starts over at #1 - so the
    // row that was open would otherwise reopen as the new run's #1.
    if (roundtripList().length === 0) openedRoundtrip = undefined;
    paintRoundtripCount();
    paintConsoleCount();
    if (!FED.includes(openTab())) return;
    // Not under a selection somebody is making in a request or a response:
    // the redraw replaced the text they were selecting. The list catches up
    // once the selection is let go.
    if (selectingInBody()) {
      behind = true;
      return;
    }
    redraw();
  });
  document.addEventListener("selectionchange", () => {
    if (!behind || selectingInBody()) return;
    behind = false;
    if (FED.includes(openTab())) redraw();
  });
}

function paintRoundtripCount() {
  const badge = document.getElementById("roundtrip-count");
  if (!badge) return;
  const list = roundtripList();
  const failed = list.some((r) => r.status >= 400);
  badge.textContent = list.length === 0 ? "" : String(list.length);
  badge.className = `insight-badge${failed ? " is-error" : ""}`;
}

export function roundtripsTab() {
  const list = roundtripList();
  if (list.length === 0) {
    return empty("Nothing yet. Every request the app sends and every answer it gets lands here, with the time the ABAP took.");
  }

  const wrap = document.createElement("div");
  wrap.className = "roundtrips";

  const rows = document.createElement("ul");
  rows.className = "insight-list";
  for (const entry of list) {
    const item = document.createElement("li");
    item.className = "roundtrip-item";
    const row = document.createElement("button");
    row.type = "button";
    row.className = `insight-row roundtrip-row${entry.status >= 400 ? " is-error" : ""}${entry.n === openedRoundtrip ? " is-open" : ""}`;
    row.setAttribute("aria-expanded", String(entry.n === openedRoundtrip));
    row.dataset.focus = `roundtrip ${entry.n}`;

    const n = document.createElement("span");
    n.className = "insight-where";
    n.textContent = `#${entry.n}`;

    const what = document.createElement("span");
    what.className = "insight-what";
    what.textContent = entry.args.length > 0 ? `${entry.event} (${entry.args.join(", ")})` : entry.event;

    const did = document.createElement("span");
    did.className = "roundtrip-did";
    did.textContent = entry.did.join(" · ");

    const ms = document.createElement("span");
    ms.className = "insight-who";
    ms.textContent = `${entry.ms} ms`;

    row.append(n, what, did, ms);
    row.addEventListener("click", () => {
      openedRoundtrip = openedRoundtrip === entry.n ? undefined : entry.n;
      redraw();
    });
    item.append(row);
    if (entry.n === openedRoundtrip) item.append(roundtripDetail(entry));
    rows.append(item);
  }
  wrap.append(rows);
  return wrap;
}

function roundtripDetail(entry) {
  const detail = document.createElement("div");
  detail.className = "roundtrip-detail";
  const block = (title, text, kind) => {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ghost";
    copy.textContent = "Copy";
    copy.dataset.focus = `roundtrip ${entry.n} ${title}`;
    copy.addEventListener("click", async () => {
      copy.textContent = (await copyToClipboard(text)) ? "copied" : "Copy";
    });
    const pre = document.createElement("pre");
    pre.className = "log-body roundtrip-body";
    pre.append(highlighted(text, kind));
    detail.append(blockHead(title, copy), pre);
  };
  for (const view of entry.views) block(`View for slot ${view.slot}`, prettyXml(view.xml), "xml");
  if (entry.console !== "") block("Console", entry.console, "text");
  // A request and a response are objects the runtime hands over, so they are
  // JSON here - `asText` only stringifies what is not already a string, and a
  // body that came as a string (a dump) is not JSON and is left grey.
  block("Request", asText(entry.request), kindOf(entry.request));
  block(
    entry.status >= 400 ? `Response (${entry.status})` : "Response",
    asText(entry.response),
    kindOf(entry.response),
  );
  return detail;
}

const asText = (value) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));
const kindOf = (value) => (typeof value === "string" ? "text" : "json");
