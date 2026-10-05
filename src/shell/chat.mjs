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
// The key is the reader's own Anthropic API key. It is kept in this browser's
// localStorage under KEY_STORAGE (through storage.mjs, which survives a
// browser that refuses storage) and sent to api.anthropic.com and nowhere
// else. An embedded playground never shows the chat at all: a demo in
// somebody's documentation page is not where a reader types a key.
import { abapGitZip, download } from "./export.mjs";
import { readStored, removeStored, writeStored } from "./storage.mjs";
import { setStatus } from "./ui.mjs";

const KEY_STORAGE = "abap2ui5-playground:anthropic-key";
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
];

let host;
let agent;
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

/**
 * `chatHost` is the page (main.mjs): files(), setFiles(files), run(),
 * currentFiles for the export. `onToggle(open)` lets the page bring the
 * left pane forward on a phone.
 */
export function setUpChat(chatHost, { onToggle } = {}) {
  host = chatHost;
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
    reset: document.getElementById("chat-new"),
    speed: document.getElementById("chat-speed"),
    bar: document.getElementById("studio-bar"),
    stages: [...document.querySelectorAll(".studio-stage")],
    fullscreen: document.getElementById("studio-fullscreen"),
    exit: document.getElementById("studio-exit"),
    url: document.getElementById("studio-url"),
    stage: document.getElementById("pane-right"),
  };

  el.toggle.addEventListener("click", () => {
    setOpen(!open);
    onToggle?.(open);
  });
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
    if (key === "" && readStored(KEY_STORAGE) === null) return;
    if (key !== "") writeStored(KEY_STORAGE, key);
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
    removeStored(KEY_STORAGE);
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
  // Enter sends, Shift+Enter is a new line - what every chat does.
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!busy) submit();
    }
  });

  el.reset.addEventListener("click", () => {
    startOver();
    el.usage.textContent = "";
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

  // Asked before every request, so a change applies from the next turn on.
  const stored = readStored(SPEED_STORAGE);
  if (stored && [...el.speed.options].some((o) => o.value === stored)) el.speed.value = stored;
  el.speed.addEventListener("change", () => {
    if (el.speed.value === DEFAULT_SPEED) removeStored(SPEED_STORAGE);
    else writeStored(SPEED_STORAGE, el.speed.value);
  });

  showWelcome();
  el.toggle.disabled = false;
}

export const chatOpen = () => open;

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
  el.toggle.setAttribute("aria-checked", String(open));
  el.toggle.title = open ? "Back to the ABAP editor" : "Build an app by describing it - an AI chat";
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
  showKeyForm(readStored(KEY_STORAGE) === null);
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
  const app = host.files()[0]?.name.replace(/\.clas\.abap$/, "").toUpperCase();
  if (app) el.url.textContent = `${app} · running in your browser`;
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
  el.keyRemove.hidden = readStored(KEY_STORAGE) === null;
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
    "what the checks find - the app appears on the right. Ask for changes until it fits, then download it for abapGit.";
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

function scrollDown() {
  el.log.scrollTop = el.log.scrollHeight;
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
  const text = el.input.value.trim();
  if (text === "") return;
  const key = readStored(KEY_STORAGE);
  if (key === null) {
    showKeyForm(true);
    el.keyInput.focus();
    return;
  }
  el.log.querySelector(".chat-welcome")?.remove();
  el.input.value = "";
  addLine("user", text);
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
        },
        tool({ id, summary, error }) {
          current = undefined;
          note = undefined;
          const row = rows.get(id) ?? addLine("tool", "");
          rows.delete(id);
          row.className = `chat-msg chat-tool${error ? " is-error" : ""}`;
          row.textContent = summary;
          scrollDown();
          if (!error && /^ran: running/.test(summary)) appUpdated();
        },
        usage({ input, output, cached }) {
          const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
          el.usage.textContent = `${k(input + cached)} in · ${k(output)} out`;
          el.usage.title = `${input} input tokens, ${cached} of them from the cache, ${output} output tokens - billed to your key`;
        },
        notice(t) {
          current = undefined;
          addLine("notice", t);
        },
      };
      const agentGen = generation;
      const guarded = Object.fromEntries(
        Object.entries(ui).map(([k, f]) => [k, (...args) => (agentGen === generation ? f(...args) : undefined)]),
      );
      agent = mod.createAgent({
        apiKey: key,
        workspace: readStored(WORKSPACE_STORAGE) ?? undefined,
        host,
        speed: () => el.speed.value,
        ui: guarded,
      });
    }
    turn = agent;
    active = turn;
    setStatus("the AI is working…");
    const { stopped } = await turn.send(text);
    if (!live()) return;
    if (stopped) addLine("notice", "Stopped.");
    setStatus(stopped ? "stopped" : "the AI is done");
  } catch (e) {
    if (!live()) return;
    const said = mod ? mod.explainError(e) : { text: `The AI part of the page could not be loaded: ${String(e?.message ?? e)}` };
    addLine(said.stopped ? "notice" : "notice is-error", said.text);
    setStatus(said.stopped ? "stopped" : "the AI request failed", !said.stopped);
    if (said.key) {
      showKeyForm(true);
      // A key without a workspace is a valid key - what is missing is the
      // workspace, so that is where the caret goes.
      (said.workspace ? el.workspaceInput : el.keyInput).focus();
    }
  } finally {
    if (active === turn) active = undefined;
    if (live()) finishRows();
    setBusy(false);
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
    const item = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    if (item) {
      endParagraph();
      const kind = item[1] ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== kind) {
        endList();
        list = document.createElement(kind);
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
  for (const part of text.split(/(`[^`]+`|\*\*[^*]+\*\*)/)) {
    if (part === "") continue;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      nodes.push(element("code", [part.slice(1, -1)]));
    } else if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      nodes.push(element("strong", [part.slice(2, -2)]));
    } else {
      nodes.push(document.createTextNode(part));
    }
  }
  return nodes;
}
