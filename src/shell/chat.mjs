// The chat on screen: describe an app, watch it being built.
//
// The switch in the toolbar (AI, beside Samples) puts the chat in the left
// pane in place of the editor and the panel; the app stays on the right. The
// editor is one click away and holds whatever the model wrote - every change
// it makes goes through the editor, the same undo stack and the same Run, so
// switching back shows the code exactly as it is (src/shell/ai-agent.mjs says
// why nothing there bypasses them).
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

const SUGGESTIONS = [
  "A table of flights with a search field that filters by carrier",
  "A form to enter a travel request - name, destination, dates - with validation and a confirmation popup",
  "A to-do list where I can add, tick off and delete entries",
];

let host;
let agent;
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
    keyButton: document.getElementById("chat-key-button"),
    keyRemove: document.getElementById("chat-key-remove"),
    usage: document.getElementById("chat-usage"),
    download: document.getElementById("chat-download"),
    reset: document.getElementById("chat-new"),
  };

  el.toggle.addEventListener("click", () => {
    setOpen(!open);
    onToggle?.(open);
  });

  el.keyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = el.keyInput.value.trim();
    if (key === "") return;
    writeStored(KEY_STORAGE, key);
    el.keyInput.value = "";
    // A new key is a new client; the conversation so far went with the old one.
    agent = undefined;
    showKeyForm(false);
    el.input.focus();
  });
  el.keyRemove.addEventListener("click", () => {
    removeStored(KEY_STORAGE);
    agent = undefined;
    showKeyForm(true);
  });
  el.keyButton.addEventListener("click", () => showKeyForm(el.keyForm.hidden));

  el.compose.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) agent?.stop();
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
    if (busy) agent?.stop();
    agent = undefined;
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

  showWelcome();
  el.toggle.disabled = false;
}

export const chatOpen = () => open;

function setOpen(value) {
  open = value;
  el.toggle.setAttribute("aria-checked", String(open));
  el.toggle.title = open ? "Back to the ABAP editor" : "Build an app by describing it - an AI chat";
  el.pane.classList.toggle("is-chatting", open);
  el.chat.hidden = !open;
  if (!open) return;
  showKeyForm(readStored(KEY_STORAGE) === null);
  if (el.keyForm.hidden) el.input.focus();
  else el.keyInput.focus();
}

function showKeyForm(show) {
  el.keyForm.hidden = !show;
  el.keyRemove.hidden = readStored(KEY_STORAGE) === null;
}

function showWelcome() {
  el.log.replaceChildren();
  const intro = document.createElement("div");
  intro.className = "chat-welcome";
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
  intro.append(lead, list);
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

  let current;
  let mod;
  try {
    mod = await import("./ai-agent.mjs");
    if (!agent) {
      agent = mod.createAgent({
        apiKey: key,
        host,
        ui: {
          assistantStart() {
            current = undefined;
          },
          text(delta) {
            if (!current) current = addLine("assistant", "");
            current.textContent += delta;
            scrollDown();
          },
          tool({ summary, error }) {
            current = undefined;
            addLine(error ? "tool is-error" : "tool", summary);
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
        },
      });
    }
    setStatus("the AI is working…");
    const { stopped } = await agent.send(text);
    if (stopped) addLine("notice", "Stopped.");
    setStatus(stopped ? "stopped" : "the AI is done");
  } catch (e) {
    const said = mod ? mod.explainError(e) : { text: `The AI part of the page could not be loaded: ${String(e?.message ?? e)}` };
    addLine(said.stopped ? "notice" : "notice is-error", said.text);
    setStatus(said.stopped ? "stopped" : "the AI request failed", !said.stopped);
    if (said.key) showKeyForm(true);
  } finally {
    setBusy(false);
  }
}
