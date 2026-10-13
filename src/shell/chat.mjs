// The chat on screen - the AI Studio: describe an app, watch it being built.
//
// The switch in the toolbar (AI, beside Samples) turns the whole page into
// the AI Studio: the site's bar and the toolbar step aside, the chat runs
// down the left, and a stage beside it shows the app, the code, or both
// (`body.is-studio[data-stage]`, "AI Studio" in shell.css). Nothing is moved
// in the DOM - the app frame least of all, since a moved iframe reloads.
// Every change the model makes goes through the editor, the same undo stack
// and the same Run, so the code on screen is the code that runs
// (src/shell/ai-agent.mjs says why nothing there bypasses them).
//
// The conversation and the SDK live in the agent's chunk, imported the first
// time somebody sends a message: a reader who never opens the chat downloads
// none of it. What stays here is the markup's behaviour and the key.
//
// The key is the reader's own Anthropic API key. It is held in this page's
// memory for as long as the page is open, and sent to api.anthropic.com and
// nowhere else. It is NOT kept in localStorage any more: the playground runs
// ABAP from any link it is handed, in this same origin - a view's core:HTML
// in the app frame, a `WRITE '@KERNEL …'` in the runtime worker - and both
// can read this origin's storage. A key stored there was one shared link
// away from somebody else's account. A key typed again per visit is the
// price; one that was stored by an earlier version is removed on load. An embedded playground never shows the chat at all: a demo in
// somebody's documentation page is not where a reader types a key.
import { isUntouchedStarter } from "./ai-starter.mjs";
import { listenForFileDrops, listSentFiles, setUpAttaching } from "./attach-ui.mjs";
import { abapGitZip, download } from "./export.mjs";
import { createDriver } from "./frame-drive.mjs";
import { readStored, removeStored, writeStored } from "./storage.mjs";
import { setStatus } from "./ui.mjs";

const KEY_STORAGE = "abap2ui5-playground:anthropic-key";
// The key, for this page's lifetime only (see above).
let sessionKey = null;
const storedKey = () => sessionKey;
// The workspace a key that is not tied to one sends its requests to - the
// API refuses such a key without the anthropic-workspace-id header. Empty
// for the ordinary key, which belongs to a workspace already.
const WORKSPACE_STORAGE = "abap2ui5-playground:anthropic-workspace";
// Thorough, Balanced or Fast (SPEEDS in ai-agent.mjs). Kept only while it
// differs from Balanced, the rule the page's other preferences follow.
const SPEED_STORAGE = "abap2ui5-playground:ai-speed";
const DEFAULT_SPEED = "balanced";
// The stage the studio last showed - kept, the way a split is.
const STAGE_STORAGE = "abap2ui5-playground:ai-stage";
const STAGES = ["chat", "preview", "code", "split"];
// The one width the stylesheet and layout.mjs share for "a phone".
const narrow = () => window.matchMedia("(max-width: 820px)").matches;

const SUGGESTIONS = [
  "A table of flights with a search field that filters by carrier",
  "A form to enter a travel request - name, destination, dates - with validation and a confirmation popup",
  "A to-do list where I can add, tick off and delete entries",
  "A maintenance app for the rows of the Excel sheet I attach - a table to edit them, and a form to add one",
];

let host;
let agent;
// Run's frame as the model's transport, and the mirror of its screen - what
// lets the model try the app it built (look and act in ai-agent.mjs, the
// operator in ai-operator.mjs, as in the Pilot). The driver is here from the
// start, so an answer from before the agent's chunk landed is kept for the
// mirror; the mirror needs the chunk and is made with the agent.
const driver = createDriver();
let mirror;
const frameApi = () => document.getElementById("app")?.contentWindow?.__z2ui5PlaygroundPilot;
// The agent whose turn is running, which is not always `agent`: a new key or
// New chat replaces `agent` while a turn may still be under way, and Stop has
// to reach the turn that is actually running.
let active;
// Stop pressed while the chat's chunk was still downloading, before there
// was an agent to tell.
let stopAsked = false;
// Bumped by everything that starts the conversation over. A turn still
// running from before draws nothing into the new log.
let generation = 0;
// What the running turn is drawing: the answer being written, its raw
// markdown, the progress note, and each tool call's row by its id.
let current;
let raw = "";
let note;
const rows = new Map();
let busy = false;
let open = false;
let el;
// The files going with the next message (attach-ui.mjs, shared with the Pilot).
let attaching;
// The conversation as text, for the export: { role, text } per line.
let transcript = [];
// The reader's latest message, which can be edited and sent again once the
// turn is over (rewind( ) in ai-agent.mjs takes the exchange out).
let lastUser;

/**
 * `chatHost` is the page (main.mjs): files(), setFiles(files), run(),
 * currentFiles for the export. `onToggle(open)` lets the page bring the
 * left pane forward on a phone.
 */
export function setUpChat(chatHost, { onToggle, startOpen = false } = {}) {
  host = chatHost;
  // A key an earlier version of this page stored is taken out of storage,
  // where any code a link runs on this origin could read it (see above).
  removeStored(KEY_STORAGE);
  el = {
    toggle: document.getElementById("ai"),
    pane: document.getElementById("pane-left"),
    chat: document.getElementById("chat"),
    log: document.getElementById("chat-log"),
    compose: document.getElementById("chat-compose"),
    input: document.getElementById("chat-input"),
    send: document.getElementById("chat-send"),
    keyForm: document.getElementById("chat-key"),
    keyInput: document.getElementById("chat-key-input"),
    workspaceInput: document.getElementById("chat-workspace-input"),
    keyButton: document.getElementById("chat-key-button"),
    keyRemove: document.getElementById("chat-key-remove"),
    usage: document.getElementById("chat-usage"),
    download: document.getElementById("chat-download"),
    export: document.getElementById("chat-export"),
    reset: document.getElementById("chat-new"),
    speed: document.getElementById("chat-speed"),
    bar: document.getElementById("studio-bar"),
    stages: [...document.querySelectorAll(".studio-stage")],
    fullscreen: document.getElementById("studio-fullscreen"),
    exit: document.getElementById("studio-exit"),
    url: document.getElementById("studio-url"),
    stage: document.getElementById("pane-right"),
    files: document.getElementById("chat-files"),
    attach: document.getElementById("chat-attach"),
    fileInput: document.getElementById("chat-file-input"),
  };

  // The switch is optional: the studio's own page opens it with startOpen and
  // carries no switch, and no way out to a playground under it.
  el.toggle?.addEventListener("click", () => {
    setOpen(!open);
    onToggle?.(open);
  });
  el.exit.hidden = startOpen;
  el.exit.addEventListener("click", () => {
    setOpen(false);
    onToggle?.(false);
  });
  for (const button of el.stages) button.addEventListener("click", () => setStage(button.dataset.stage, true));
  // The browser's own full screen, on top of the studio's: hidden where the
  // page may not have it (an iframe without allowfullscreen, an old Safari).
  el.fullscreen.hidden = !document.fullscreenEnabled;
  el.fullscreen.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  // Crossing the phone width changes which stages there are.
  window.matchMedia("(max-width: 820px)").addEventListener("change", () => {
    if (open) setStage(document.body.dataset.stage);
  });

  el.keyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = el.keyInput.value.trim();
    // The workspace can be added later on its own, to a key already stored.
    if (key === "" && storedKey() === null) return;
    if (key !== "") sessionKey = key;
    const workspace = el.workspaceInput.value.trim();
    if (workspace === "") removeStored(WORKSPACE_STORAGE);
    else writeStored(WORKSPACE_STORAGE, workspace);
    el.keyInput.value = "";
    // A new key is a new client; the conversation so far went with the old one,
    // and so does a turn still running on the old key.
    startOver();
    showKeyForm(false);
    el.input.focus();
  });
  el.keyRemove.addEventListener("click", () => {
    sessionKey = null;
    removeStored(WORKSPACE_STORAGE);
    el.workspaceInput.value = "";
    startOver();
    showKeyForm(true);
  });
  el.keyButton.addEventListener("click", () => showKeyForm(el.keyForm.hidden));

  el.compose.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) stopTurn();
    else submit();
  });
  el.log.addEventListener("scroll", () => {
    following = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 48;
  }, { passive: true });
  // Enter sends, Shift+Enter is a new line - what every chat does.
  el.input.addEventListener("keydown", (e) => {
    // Safari ends the composition BEFORE the Enter that commits it, so
    // isComposing is already false there; keyCode 229 is that Enter.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (!busy) submit();
    }
  });

  // Files for the next message: the paperclip, a paste, and - on the studio's
  // own page - a drop anywhere on it. The kinds and the limit are the agent
  // chunk's, imported the first time a file is added.
  attaching = setUpAttaching({
    prefix: "chat",
    button: el.attach,
    input: el.fileInput,
    list: el.files,
    textarea: el.input,
    rules: () => import("./ai-agent.mjs"),
    refused: (text) => addLine("notice is-error", text),
  });
  if (startOpen) listenForFileDrops({ highlight: el.chat, onFiles: (files) => chatDropped(files) });

  el.reset.addEventListener("click", () => {
    startOver();
    showWelcome();
  });

  el.download.addEventListener("click", () => {
    try {
      const zip = abapGitZip(host.files());
      download(zip.name, zip.bytes);
      setStatus(`${zip.name} is on its way`);
    } catch (e) {
      setStatus("the zip could not be written", true);
      addLine("notice", String(e?.message ?? e));
    }
  });

  // The conversation as a markdown file - what was asked, what the model
  // said and did - for an issue, a colleague or a note; the key never, the
  // files as the abapGit zip.
  el.export.addEventListener("click", () => {
    if (transcript.length === 0) {
      setStatus("nothing to export yet");
      return;
    }
    const name = `abap2ui5-ai-studio-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.md`;
    download(name, new TextEncoder().encode(transcriptMarkdown()), "text/markdown");
    setStatus(`${name} is on its way`);
  });

  // Asked before every request, so a change applies from the next turn on.
  const stored = readStored(SPEED_STORAGE);
  if (stored && [...el.speed.options].some((o) => o.value === stored)) el.speed.value = stored;
  el.speed.addEventListener("change", () => {
    if (el.speed.value === DEFAULT_SPEED) removeStored(SPEED_STORAGE);
    else writeStored(SPEED_STORAGE, el.speed.value);
  });

  // A reload or a closed tab takes the conversation with it, and the app
  // while a turn is still writing it: the browser asks first. The files
  // themselves are kept (the studio's draft in main.mjs), the chat is not.
  window.addEventListener("beforeunload", (e) => {
    if (!busy && host.files().every(isUntouchedStarter)) return;
    e.preventDefault();
    e.returnValue = "";
  });

  showWelcome();
  if (el.toggle) el.toggle.disabled = false;
  if (startOpen) setOpen(true);
}

export const chatOpen = () => open;

/** main.mjs, in the bridge's roundtrip( ): the model's request parked for
 *  Run's frame, taken - the one frame this page has (the Pilot has tabs). */
export function takePilotRequest() {
  return driver.take();
}

/** main.mjs, after every answer the framework gave the frame. */
export function sawRoundtrip(body, response) {
  driver.saw(body, response);
}

/** A file drop on the studio's page, or on the app in its frame (main.mjs,
 *  the bridge's dropFiles): to the chat, which a phone brings forward. */
export function chatDropped(files) {
  if (!attaching || !open || files.length === 0) return;
  if (narrow()) setStage("chat", true);
  attaching.add(files);
}

function stopTurn() {
  stopAsked = true;
  active?.stop();
}

// The conversation is over: the turn still running (if any) is stopped, and
// whatever it still says goes nowhere - see `generation`.
function startOver() {
  if (busy) stopTurn();
  agent = undefined;
  generation += 1;
  finishRows();
  // The old turn may still be inside a tool (a run, a sample being fetched)
  // and only unwinds when that ends; the new conversation is not busy.
  setBusy(false);
  // Its tokens went with it.
  el.usage.textContent = "";
  el.usage.title = "";
  transcript = [];
  lastUser = undefined;
}

function transcriptMarkdown() {
  const lines = [`# abap2UI5 AI Studio - ${new Date().toLocaleString()}`, ""];
  for (const { role, text } of transcript) {
    if (role === "user") lines.push(`## You`, "", text, "");
    else if (role === "assistant") lines.push(`## Claude`, "", text, "");
    else lines.push(`> ${role}: ${text.replace(/\n/g, "\n> ")}`, "");
  }
  lines.push("---", "", `Files in the editor: ${host.files().map((f) => f.name).join(", ")}`, "");
  return lines.join("\n");
}

// The files as they were before a step, offered back under its answer:
// Ctrl+Z is per file and knows no turn, and a step that went the wrong
// way is three files changed at once.
function addCheckpoint(before) {
  const line = document.createElement("div");
  line.className = "chat-checkpoint";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost chat-checkpoint-restore";
  button.textContent = "↩ Put the files back as before this step";
  button.addEventListener("click", () => {
    if (busy) return;
    try {
      host.setFiles(before);
    } catch (e) {
      addLine("notice is-error", `The files could not be put back: ${String(e?.message ?? e)}`);
      return;
    }
    line.remove();
    showAppName();
    addLine("notice", "The files are back as they were before that step - the model is told with your next message.");
    transcript.push({ role: "note", text: "the files were put back as before the last step" });
    host.run().catch(() => {});
  });
  line.append(button);
  el.log.append(line);
  scrollDown();
}

// "Edit" on the reader's latest message: the exchange is taken out of the
// conversation and the text put back to send again, changed.
function offerEdit() {
  if (!lastUser || !agent) return;
  const { div, text, files } = lastUser;
  if (div.querySelector(".chat-edit")) return;
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "chat-edit";
  edit.title = "Edit this message and send it again - the answer to it is taken back";
  edit.setAttribute("aria-label", "Edit this message and send it again");
  edit.textContent = "✎";
  edit.addEventListener("click", () => {
    if (busy || !agent?.rewind()) return;
    for (let node = div.nextSibling; node; ) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
    div.remove();
    rows.clear();
    const at = transcript.findLastIndex((t) => t.role === "user");
    if (at !== -1) transcript.length = at;
    lastUser = undefined;
    el.input.value = text;
    if (files.length > 0) attaching.add(files);
    el.input.focus();
    setStatus("edit the message and send it again");
  });
  div.append(edit);
}

// Every tool row still drawn as pending is a call that will not finish now -
// stopped, refused, or the request failed under it. Left as it was, it went
// on shimmering as if the work were still going on.
function finishRows() {
  for (const row of rows.values()) {
    row.className = "chat-msg chat-tool is-error";
    row.textContent = `${row.textContent.replace(/…$/, "")} - not finished`;
  }
  rows.clear();
}

function setOpen(value) {
  open = value;
  el.toggle?.setAttribute("aria-checked", String(open));
  if (el.toggle) el.toggle.title = open ? "Back to the ABAP editor" : "Build an app by describing it - an AI chat";
  el.chat.hidden = !open;
  el.bar.hidden = !open;
  document.body.classList.toggle("is-studio", open);
  // A turn that kept running while the studio was closed is still working.
  document.body.classList.toggle("is-ai-working", busy && open);
  if (!open) {
    delete document.body.dataset.stage;
    document.body.classList.remove("is-ai-working");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    return;
  }
  // The narrow layout hides one of the two panes by attribute; the studio
  // decides what is on screen by its stage alone.
  el.pane.hidden = false;
  el.stage.hidden = false;
  const stored = readStored(STAGE_STORAGE);
  // A phone starts on the conversation - the one thing on it nobody has
  // seen yet; a wide screen on the chat beside code and app.
  setStage(narrow() ? "chat" : stored ?? (window.innerWidth >= 1500 ? "split" : "preview"));
  showAppName();
  showKeyForm(storedKey() === null);
  if (el.keyForm.hidden) el.input.focus();
  else el.keyInput.focus();
}

// What the stage shows. A stage the width does not offer is mapped onto one
// it does: Split is Preview on a phone, and Chat is the whole studio on a
// phone and simply the chat column everywhere else.
function setStage(stage, chosen = false) {
  let next = STAGES.includes(stage) ? stage : "preview";
  if (narrow() && next === "split") next = "preview";
  if (!narrow() && next === "chat") next = "preview";
  document.body.dataset.stage = next;
  for (const button of el.stages) button.setAttribute("aria-selected", String(button.dataset.stage === next));
  if (chosen) writeStored(STAGE_STORAGE, next);
}

// The app's name in the window bar of the stage: the class Run starts.
function showAppName() {
  const first = host.files()[0];
  // The starting class, untouched, is nothing running yet.
  if (!first || isUntouchedStarter(first)) {
    el.url.textContent = "your app";
    return;
  }
  el.url.textContent = `${first.name.replace(/\.clas\.abap$/, "").toUpperCase()} · running in your browser`;
}

// A run that started the app, said in the conversation as a card: it brings
// the app forward where the stage was showing something else, and the stage
// flashes so the eye finds it.
function appUpdated() {
  showAppName();
  const card = document.createElement("button");
  card.type = "button";
  card.className = "chat-card";
  card.append("✦ App updated");
  const hint = document.createElement("span");
  hint.textContent = "show it";
  card.append(hint);
  card.addEventListener("click", () => {
    const stage = document.body.dataset.stage;
    if (stage === "code" || stage === "chat") setStage("preview", true);
    flashStage();
  });
  el.log.append(card);
  scrollDown();
  flashStage();
}

function flashStage() {
  el.stage.classList.remove("is-flash");
  void el.stage.offsetWidth;
  el.stage.classList.add("is-flash");
}

function showKeyForm(show) {
  el.keyForm.hidden = !show;
  el.keyRemove.hidden = storedKey() === null;
  if (show) el.workspaceInput.value = readStored(WORKSPACE_STORAGE) ?? "";
}

function showWelcome() {
  el.log.replaceChildren();
  const intro = document.createElement("div");
  intro.className = "chat-welcome";
  const title = document.createElement("h2");
  title.textContent = "What do you want to build?";
  const lead = document.createElement("p");
  lead.textContent =
    "Describe the app you want. Claude writes it as an abap2UI5 class into the editor, runs it here and fixes " +
    "what the checks find - the app appears on the right. Ask for changes until it fits, then download it for abapGit. " +
    "Add a specification, a screenshot or an Excel sheet with data with 📎 and Claude builds from it.";
  const list = document.createElement("div");
  list.className = "chat-suggestions";
  for (const text of SUGGESTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chat-suggestion";
    b.textContent = text;
    b.addEventListener("click", () => {
      el.input.value = text;
      el.input.focus();
    });
    list.append(b);
  }
  intro.append(title, lead, list);
  // The last build this browser kept (main.mjs stores the studio's files
  // under a key of its own): offered back, not opened by itself - the
  // studio starts on the minimal class every time, and the model is told
  // what the editor holds with the first message (<editor_files>).
  const last = host.lastBuild?.();
  if (last && host.files().every(isUntouchedStarter)) {
    const resume = document.createElement("div");
    resume.className = "chat-resume";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "chat-suggestion chat-resume-open";
    open.textContent = `Open the last build again · ${last[0].name.replace(/\.clas\.abap$/, "").toUpperCase()}${last.length > 1 ? ` · ${last.length} files` : ""}`;
    open.addEventListener("click", () => {
      try {
        host.setFiles(last);
      } catch (e) {
        addLine("notice is-error", `The last build could not be opened: ${String(e?.message ?? e)}`);
        return;
      }
      resume.remove();
      showAppName();
      addLine("notice", "The last build is back in the editor - ask for a change, or describe something new.");
      // Run, so the stage shows it; the report goes nowhere.
      host.run().catch(() => {});
    });
    const forget = document.createElement("button");
    forget.type = "button";
    forget.className = "ghost chat-resume-forget";
    forget.textContent = "forget it";
    forget.addEventListener("click", () => {
      host.forgetLastBuild?.();
      resume.remove();
    });
    resume.append(open, forget);
    intro.append(resume);
  }
  el.log.append(intro);
}

function addLine(kind, text) {
  const div = document.createElement("div");
  div.className = `chat-msg chat-${kind}`;
  div.textContent = text;
  el.log.append(div);
  scrollDown();
  return div;
}

// The log follows the answer while the reader is at its end. Scrolled up to
// read something earlier, they stay there: every delta of a turn that runs
// for minutes pulled them back down, several times a second. A scroll the
// page makes itself lands at the end and keeps `following` true.
let following = true;
function scrollDown(force = false) {
  if (force) following = true;
  if (following) el.log.scrollTop = el.log.scrollHeight;
}

function setBusy(value) {
  busy = value;
  el.send.textContent = busy ? "Stop" : "Send";
  el.send.classList.toggle("primary", !busy);
  el.chat.classList.toggle("is-busy", busy);
  document.body.classList.toggle("is-ai-working", busy && open);
  // The answer is redrawn on every delta, inside a live region: busy, a
  // screen reader waits for the turn rather than reading it from the top on
  // each redraw.
  el.log.setAttribute("aria-busy", String(busy));
}

async function submit() {
  const typed = el.input.value.trim();
  // A file dropped a moment ago may still be being checked in.
  await attaching.settled();
  if (busy || (typed === "" && attaching.count === 0)) return;
  // Files alone are a message too: the model is told they are what it is about.
  const text = typed || "Here are the files.";
  const key = storedKey();
  if (key === null) {
    showKeyForm(true);
    el.keyInput.focus();
    return;
  }
  el.log.querySelector(".chat-welcome")?.remove();
  el.input.value = "";
  const files = attaching.take();
  lastUser?.div.querySelector(".chat-edit")?.remove();
  const userLine = addLine("user", typed);
  listSentFiles(userLine, files, "chat-user-files");
  lastUser = { div: userLine, text: typed, files };
  transcript.push({ role: "user", text: `${typed}${files.length ? `\n\n${files.map((f) => `📎 ${f.name}`).join("\n")}` : ""}` });
  // The files as they are now - offered back under the answer when the
  // step changed them.
  const before = host.files().map((f) => ({ ...f }));
  scrollDown(true);
  setBusy(true);
  stopAsked = false;
  current = undefined;
  note = undefined;
  raw = "";

  // This turn's conversation; anything it says after the conversation was
  // started over is dropped.
  const gen = generation;
  const live = () => gen === generation;
  let mod;
  let turn;
  try {
    mod = await import("./ai-agent.mjs");
    if (stopAsked || !live()) {
      if (live()) addLine("notice", "Stopped.");
      setStatus("stopped");
      return;
    }
    if (!agent) {
      // Every callback asks whether its conversation is still the one on
      // screen - `ui` belongs to this agent for as long as it lives.
      const ui = {
        assistantStart() {
          current = undefined;
          note = undefined;
        },
        thinkingStart() {
          note = undefined;
        },
        thinking(delta) {
          current = undefined;
          if (!note) note = addLine("progress", "");
          note.textContent += delta;
          scrollDown();
        },
        toolPending({ id, text }) {
          current = undefined;
          note = undefined;
          let row = rows.get(id);
          if (!row) {
            row = addLine("tool is-pending", "");
            rows.set(id, row);
          }
          row.textContent = text;
          scrollDown();
        },
        text(delta) {
          if (!current) {
            current = addLine("assistant", "");
            raw = "";
          }
          // Rendered again on every delta: an answer is a few paragraphs,
          // and a half-written **bold** has to become bold once it closes.
          raw += delta;
          renderMarkdown(current, raw);
          scrollDown();
          // The answer so far, in the transcript - replaced on every delta.
          const last = transcript[transcript.length - 1];
          if (last?.role === "assistant" && last.el === current) last.text = raw;
          else transcript.push({ role: "assistant", text: raw, el: current });
        },
        tool({ id, summary, error, started }) {
          current = undefined;
          note = undefined;
          const row = rows.get(id) ?? addLine("tool", "");
          rows.delete(id);
          row.className = `chat-msg chat-tool${error ? " is-error" : ""}`;
          row.textContent = summary;
          scrollDown();
          transcript.push({ role: error ? "failed" : "did", text: summary });
          if (started) appUpdated();
        },
        usage(total) {
          const { text, title } = mod.usageText(total);
          el.usage.textContent = text;
          el.usage.title = title;
        },
        notice(t) {
          current = undefined;
          addLine("notice", t);
          transcript.push({ role: "note", text: t });
        },
        // The model is about to do something in the app: said in the bar,
        // and on a phone the app comes forward so the reader sees it happen.
        acting(t) {
          setStatus(t);
          if (narrow()) setStage("preview");
        },
      };
      const agentGen = generation;
      const guarded = Object.fromEntries(
        Object.entries(ui).map(([k, f]) => [k, (...args) => (agentGen === generation ? f(...args) : undefined)]),
      );
      if (!mirror) {
        mirror = mod.createMirror();
        driver.observe((body, response) => mirror.observe(body, response));
      }
      agent = mod.createAgent({
        apiKey: key,
        workspace: readStored(WORKSPACE_STORAGE) ?? undefined,
        host: {
          ...host,
          // The running app, for look and act: its frame as the transport,
          // its screen as the mirror, the class Run starts.
          app: {
            drive: (body) => driver.drive(frameApi, body),
            frame: frameApi,
            mirror: () => mirror,
            get cls() {
              return host.files()[0]?.name.replace(/\.clas\.abap$/, "") ?? "";
            },
          },
        },
        speed: () => el.speed.value,
        ui: guarded,
      });
    }
    turn = agent;
    active = turn;
    setStatus("the AI is working…");
    const { stopped } = await turn.send(text, files);
    if (!live()) return;
    if (stopped) addLine("notice", "Stopped.");
    setStatus(stopped ? "stopped" : "the AI is done");
    if (JSON.stringify(host.files()) !== JSON.stringify(before)) addCheckpoint(before);
  } catch (e) {
    if (!live()) return;
    const said = mod ? mod.explainError(e) : { text: `The AI part of the page could not be loaded: ${String(e?.message ?? e)}` };
    addLine(said.stopped ? "notice" : "notice is-error", said.text);
    setStatus(said.stopped ? "stopped" : "the AI request failed", !said.stopped);
    if (said.key) {
      // The message never reached a model, and a new key is a new
      // conversation: what was typed and attached is put back to send again.
      if (el.input.value === "") el.input.value = typed;
      if (files.length > 0) attaching.add(files);
      showKeyForm(true);
      // A key without a workspace is a valid key - what is missing is the
      // workspace, so that is where the caret goes.
      (said.workspace ? el.workspaceInput : el.keyInput).focus();
    }
  } finally {
    if (active === turn) active = undefined;
    // A turn of a conversation started over leaves the new one alone - it
    // was set idle by startOver( ) and may be busy with a turn of its own.
    if (live()) {
      finishRows();
      setBusy(false);
      offerEdit();
    }
  }
}

// The model answers in markdown. Rendered here into nodes - paragraphs,
// lists, headings, fenced code, `code` and **bold** - and never through
// innerHTML: every character of the answer reaches the page as text, so
// nothing the model writes can be markup.
export function renderMarkdown(target, text) {
  const blocks = [];
  let paragraph = [];
  let list;
  const endParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(element("p", inline(paragraph.join(" "))));
    paragraph = [];
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = undefined;
  };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      endParagraph();
      endList();
      const code = [];
      for (i += 1; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      const pre = document.createElement("pre");
      const c = document.createElement("code");
      c.textContent = code.join("\n");
      pre.append(c);
      blocks.push(pre);
      continue;
    }
    // A table: a header row, a separator row of dashes, then rows - each
    // cell rendered inline, so a field list the model proposes keeps its
    // columns. Pipes at the edges are optional, as in GitHub's markdown.
    if (/^\s*\|?.*\|.*$/.test(line) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "")) {
      endParagraph();
      endList();
      const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      thead.append(element("tr", cells(line).map((c) => element("th", inline(c)))));
      table.append(thead);
      const tbody = document.createElement("tbody");
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim() !== ""; i++) {
        tbody.append(element("tr", cells(lines[i]).map((c) => element("td", inline(c)))));
      }
      i -= 1;
      table.append(tbody);
      blocks.push(table);
      continue;
    }
    const item = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    if (item) {
      endParagraph();
      const kind = item[1] ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== kind) {
        endList();
        list = document.createElement(kind);
        // A numbered list broken by a nested bullet or a code block goes
        // on with its own number, not with 1 again.
        if (kind === "ol") list.start = Number(item[2]);
      }
      list.append(element("li", inline(item[3])));
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      endParagraph();
      endList();
      blocks.push(element("p", [element("strong", inline(heading[1]))]));
      continue;
    }
    if (line.trim() === "") {
      endParagraph();
      endList();
      continue;
    }
    endList();
    paragraph.push(line.trim());
  }
  endParagraph();
  endList();
  target.replaceChildren(...blocks);
}

function element(tag, children) {
  const el = document.createElement(tag);
  el.append(...children);
  return el;
}

function inline(text) {
  const nodes = [];
  for (const part of text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https:\/\/[^\s)]+\))/)) {
    if (part === "") continue;
    const link = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(part);
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      nodes.push(element("code", [part.slice(1, -1)]));
    } else if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      nodes.push(element("strong", [part.slice(2, -2)]));
    } else if (link) {
      // Only https, opened beside, and never a handle on this page: the
      // address is text the model wrote.
      const a = element("a", [link[1]]);
      a.href = link[2];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      nodes.push(a);
    } else {
      nodes.push(document.createTextNode(part));
    }
  }
  return nodes;
}
