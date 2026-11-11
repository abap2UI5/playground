// The Log tab: the one message the page has for the reader - a startup note,
// an ABAP error, a dump (ui.mjs keeps it; showOutput( ) writes it). Anything
// written there opens the panel on this tab (setUpInsight( ) in insight.mjs).
import { currentLog, hideOutput } from "./ui.mjs";
import { blockHead, empty } from "./insight-common.mjs";
import { getFiles } from "../editor/editor.mjs";
import { embedded } from "./page.mjs";
import { shareUrl } from "./share.mjs";

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
  if (entry.action) {
    const act = document.createElement("button");
    act.type = "button";
    act.className = "primary log-action";
    act.textContent = entry.action.label;
    act.addEventListener("click", () => entry.action.act());
    wrap.append(act);
  }
  if (!embedded && !entry.reader && !NOT_OURS.has(entry.title)) wrap.append(reportLink(entry));
  return wrap;
}

// "Report this" under what the page itself got wrong: a prefilled issue on
// GitHub, opened in a new tab, and nothing sent until the reader presses
// Submit there - there is no server behind this page and no telemetry.
//
// Not under what is about the reader's own code - an entry written with
// `reader` (the file and its class disagree, the transpiler refused a
// statement, the ABAP never finished), or a "Link" whose code could not be
// read - a report of those would be a report of somebody's typo. The code itself goes along only
// when asked, as a share link, and only while the address stays under what
// GitHub takes (ISSUE_URL_MAX); the box says so when it is too long.
const NOT_OURS = new Set(["Link"]);
const ISSUE_URL_MAX = 8000;
const ISSUES = "https://github.com/abap2UI5/playground/issues/new";

/** The new-issue address for a log entry - pure, for the test. */
export function issueUrl(entry, { versions = "", agent = "", page = "", code = "" } = {}) {
  const text = String(entry.body).slice(0, 1500);
  const body = [
    `**What the Log said** (${entry.title}):`,
    "",
    "```",
    text,
    "```",
    "",
    `- Versions: ${versions || "unknown"}`,
    `- Browser: ${agent || "unknown"}`,
    `- Page: ${page || "unknown"}`,
    ...(code ? [`- The code: ${code}`] : []),
    "",
    "What I did before it happened:",
    "",
  ].join("\n");
  const firstLine = text.split("\n", 1)[0].slice(0, 80);
  const url = new URL(ISSUES);
  url.searchParams.set("title", `${entry.title}: ${firstLine}`);
  url.searchParams.set("body", body);
  return url.href;
}

function reportLink(entry) {
  const row = document.createElement("p");
  row.className = "log-report";
  const link = document.createElement("a");
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Report this";
  link.title = "Opens a new issue on GitHub with this message filled in - nothing is sent until you submit it there";
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  label.append(box, " include my code as a share link");
  const said = document.createElement("span");
  said.className = "log-report-note";

  // The page's address without its query and fragment: a fragment IS code,
  // and a ?src= or ?gist= names somebody's file.
  const context = () => ({
    versions: document.getElementById("versions")?.textContent?.trim() ?? "",
    agent: navigator.userAgent,
    page: `${location.origin}${location.pathname}`,
  });
  let version = 0;
  const write = async () => {
    const mine = ++version;
    let code = "";
    said.textContent = "";
    if (box.checked) {
      try {
        code = await shareUrl(getFiles());
      } catch {
        code = "";
      }
      if (mine !== version) return;
      if (issueUrl(entry, { ...context(), code }).length > ISSUE_URL_MAX) {
        code = "";
        box.checked = false;
        said.textContent = " - too long for an issue's address; paste the Share link into the issue instead";
      }
    }
    link.href = issueUrl(entry, { ...context(), code });
  };
  box.addEventListener("change", write);
  write();
  row.append(link, " · ", label, said);
  return row;
}
