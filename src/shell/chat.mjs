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
// ABAP from any link it is handed, and on the playground's own page the app
// frame is this same origin (page.mjs, frameIsolated) - a view's core:HTML
// there can read this origin's localStorage. A key stored there was one
// shared link away from somebody else's account. On this page the frame is
// on an opaque origin and talks to the page only by message
// (frame-link.mjs): an app here reaches neither the key form nor the key. A key typed again per visit is the
// price; one that was stored by an earlier version is removed on load. An embedded playground never shows the chat at all: a demo in
// somebody's documentation page is not where a reader types a key.
import { isUntouchedStarter } from "./ai-starter.mjs";
import { listenForFileDrops } from "./attach-ui.mjs";
import { createChatRoom, narrow } from "./chat-ui.mjs";
import { abapGitZip, download } from "./export.mjs";
import { createDriver } from "./frame-drive.mjs";
import { frameApi as apiOf } from "./frame-link.mjs";
import { readProviderSettings } from "./llm-provider.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { frame } from "./page.mjs";
import { readSessionJson, readStored, removeSession, removeStored, writeSessionJson, writeStored } from "./storage.mjs";
import { setStatus } from "./ui.mjs";
import { DEFAULT_TARGET, TARGETS, functionCalls, systemTodos, targetLabel } from "./target-system.mjs";

const KEY_STORAGE = "abap2ui5-playground:anthropic-key";
// The stage the studio last showed - kept, the way a split is.
const STAGE_STORAGE = "abap2ui5-playground:ai-stage";
const STAGES = ["chat", "preview", "code", "split"];
// The conversation, kept for this tab over a reload (sessionStorage: the
// tab's own, gone with it, and nothing a page must answer `unload` for - the
// back/forward cache rule, tests/bfcache.spec.js). The files are kept apart,
// under AI_STORAGE_KEY in localStorage (main.mjs); the key is never kept.
const CONVERSATION_STORAGE = "abap2ui5-playground:ai-conversation";

const SUGGESTIONS = [
  "A table of flights with a search field that filters by carrier",
  "A form to enter a travel request - name, destination, dates - with validation and a confirmation popup",
  "A to-do list where I can add, tick off and delete entries",
  "A maintenance app for the rows of the Excel sheet I attach - a table to edit them, and a form to add one",
];

let host;
// The chat itself - the log, the key, Send and Stop, a turn from message to
// answer - is chat-ui.mjs, shared with the Pilot; what is here is the studio.
let room;
// Run's frame as the model's transport, and the mirror of its screen - what
// lets the model try the app it built (look and act in ai-agent.mjs, the
// operator in ai-operator.mjs, as in the Pilot). The driver is here from the
// start, so an answer from before the agent's chunk landed is kept for the
// mirror; the mirror needs the chunk and is made with the agent.
const driver = createDriver();
let mirror;
const frameApi = () => apiOf(frame);
let open = false;
let el;
// The conversation as text, for the export: { role, text } per line.
let transcript = [];
// The reader's messages that are in the conversation, latest last: the
// latest can be edited and sent again once the turn is over (rewind( ) in
// ai-agent.mjs takes the exchange out), and then the one before it.
let userLines = [];
// A conversation from before a reload, handed to the agent when it is made
// (createAgent in ai-agent.mjs takes it as `resume`), and whether an agent
// has been made in this page at all.
let resume;
let agentMade = false;
// The files as they were when the last "App updated" card was put in the
// log - a run that changed nothing (run_app for a second look) is no update.
let cardFiles;

// Who the chat says is at work: Claude for the Anthropic models, and for an
// OpenAI-compatible server whatever model was named there.
const who = () => (readProviderSettings().provider === "anthropic" ? "Claude" : "the model");

/**
 * `chatHost` is the page (setUpStudio( ) in agent-hooks.mjs): files(), setFiles(files), run(),
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
    target: document.getElementById("chat-target"),
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

  // The key form, Send and Stop, New chat, the speed and the files for the
  // next message (chat-ui.mjs). The kinds and the limit of the files are the
  // agent chunk's, imported the first time a file is added.
  room = createChatRoom({
    prefix: "chat",
    el,
    // A turn that keeps running while the studio is closed is still working.
    // The download waits for it: half the files written is no app to take home.
    onBusy: (busy) => {
      document.body.classList.toggle("is-ai-working", busy && open);
      el.download.disabled = busy;
    },
    onStartOver: () => {
      // A key is held now: the welcome's way in without one is done.
      if (room?.hasKey()) el.log.querySelector(".chat-local")?.remove();
      // The key typed for a conversation taken up after a reload starts
      // nothing over: there is no agent yet, and the conversation is what
      // the key is for.
      if (resume && !agentMade) return;
      transcript = [];
      userLines = [];
      resume = undefined;
      agentMade = false;
      forgetConversation();
    },
    showWelcome: () => {
      // New chat: a conversation waiting to be taken up goes too.
      resume = undefined;
      transcript = [];
      userLines = [];
      forgetConversation();
      showWelcome();
    },
    rules: () => import("./ai-agent.mjs"),
    turn: {
      load: () => import("./ai-agent.mjs"),
      sent({ line, typed, files }) {
        userLines.at(-1)?.div.querySelector(".chat-edit")?.remove();
        userLines.push({ div: line, text: typed, files });
        transcript.push({ role: "user", text: `${typed}${files.length ? `\n\n${files.map((f) => `📎 ${f.name}`).join("\n")}` : ""}` });
        // The files as they are now - offered back under the answer when the
        // step changed them.
        return host.files().map((f) => ({ ...f }));
      },
      createAgent({ mod, ...conversation }) {
        if (!mirror) {
          mirror = mod.createMirror();
          driver.observe((body, response) => mirror.observe(body, response));
        }
        const taken = resume;
        resume = undefined;
        agentMade = true;
        return mod.createAgent({
          ...conversation,
          resume: taken,
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
        });
      },
      working: "the AI is working…",
      done: "the AI is done",
      ui: {
        // The answer so far, in the transcript - replaced on every delta.
        text(raw, line) {
          const last = transcript[transcript.length - 1];
          if (last?.role === "assistant" && last.el === line) last.text = raw;
          else transcript.push({ role: "assistant", text: raw, el: line });
        },
        tool({ summary, error, started }) {
          transcript.push({ role: error ? "failed" : "did", text: summary });
          if (started) appUpdated();
        },
        notice(t) {
          transcript.push({ role: "note", text: t });
        },
        // The model is about to do something in the app: said in the bar,
        // and on a phone the app comes forward so the reader sees it happen.
        acting(t) {
          setStatus(t);
          if (narrow()) setStage("preview");
        },
      },
      answered(before) {
        if (JSON.stringify(host.files()) !== JSON.stringify(before)) addCheckpoint(before);
      },
      // A message no answer came to - the first request of its turn failed -
      // is out of the conversation again (send( ) in ai-agent.mjs): ✎ on it
      // would take the exchange BEFORE it out instead, and the log and the
      // history would part ways. A stopped one stays, and keeps its ✎.
      failed({ stopped }) {
        if (stopped) return;
        userLines.pop();
        const at = transcript.findLastIndex((t) => t.role === "user");
        if (at !== -1) transcript.splice(at, 1);
      },
      settled() {
        offerEdit();
        keepConversation();
      },
    },
  });
  // A drop anywhere on the studio's own page.
  if (startOpen) listenForFileDrops({ highlight: el.chat, onFiles: (files) => chatDropped(files) });

  el.download.addEventListener("click", () => {
    // The starting class as it was handed out is nothing to take home.
    if (host.files().every(isUntouchedStarter)) {
      setStatus("nothing to download yet - describe the app first");
      room.addLine("notice", "There is nothing to download yet: the editor holds only the starting class. Describe the app you want first.");
      return;
    }
    try {
      const zip = abapGitZip(host.files());
      download(zip.name, zip.bytes);
      setStatus(`${zip.name} is on its way`);
      placeholderNotice();
    } catch (e) {
      setStatus("the zip could not be written", true);
      room.addLine("notice", String(e?.message ?? e));
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
    // Local time, as the heading inside says it.
    const now = new Date();
    const two = (n) => String(n).padStart(2, "0");
    const name = `abap2ui5-ai-studio-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}.md`;
    download(name, new TextEncoder().encode(transcriptMarkdown()), "text/markdown");
    setStatus(`${name} is on its way`);
  });

  // No beforeunload here: nothing on this site may keep a page out of the
  // back/forward cache (tests/bfcache.spec.js). The conversation is kept for
  // the tab after every turn instead (keepConversation( )), the files are
  // kept by remember( ) in main.mjs, and both are offered back here.

  setUpTarget();
  if (!restoreConversation()) showWelcome();
  if (el.toggle) el.toggle.disabled = false;
  if (startOpen) setOpen(true);
}

// The reader's SAP system in the header: the release the syntax check holds
// the code to (abaplint's version, host.setAbapRelease( ) in
// agent-hooks.mjs), which the model is told before every request. A release
// set in the Config tab that the list does not carry is shown as abaplint
// names it, so the select never claims a check that is not running.
function setUpTarget() {
  if (!el.target) return;
  const now = host.abapRelease?.();
  if (!now || !host.setAbapRelease) {
    el.target.hidden = true;
    return;
  }
  for (const target of TARGETS) {
    const option = new Option(target.label, target.version);
    option.title = target.title;
    el.target.append(option);
  }
  const show = (version) => {
    if (![...el.target.options].some((o) => o.value === version)) el.target.append(new Option(targetLabel(version), version));
    el.target.value = version;
  };
  show(now);
  // The Config tab sets the same release: the header follows it, so it
  // never names a check that is not the one running.
  host.onAbapRelease?.(show);
  el.target.addEventListener("change", async () => {
    const version = el.target.value;
    const label = targetLabel(version);
    // The corpus is parsed again under the new release - seconds, during
    // which a second change would race the first.
    el.target.disabled = true;
    setStatus(`checking the code against ${label}…`);
    try {
      await host.setAbapRelease(version, (done, total) => {
        setStatus(`checking the code against ${label}… ${Math.round((done / total) * 100)}%`);
      });
      setStatus(`the code is checked against ${label} now`);
      room.addLine("notice", `Your system: ${label}. The syntax check holds the code to it, and ${who()} is told from the next message on.`);
    } catch (e) {
      el.target.value = host.abapRelease();
      setStatus("the release could not be changed", true);
      room.addLine("notice is-error", String(e?.message ?? e));
    } finally {
      el.target.disabled = false;
    }
  });
}

// Said under the download: which release the code was checked against, and
// the TODO(system) lines the model left above what stands in for the
// reader's system (target-system.mjs) - the part "it ran here" says nothing
// about.
function placeholderNotice() {
  const label = targetLabel(host.abapRelease?.() ?? DEFAULT_TARGET);
  // The TODO(system) lines, and the CALL FUNCTIONs nobody marked as one.
  const files = host.files();
  const order = (name) => files.findIndex((f) => f.name === name);
  const todos = [
    ...systemTodos(files),
    ...functionCalls(files).filter((c) => !c.marked)
      .map((c) => ({ file: c.file, line: c.line, text: `CALL FUNCTION ${c.name} - not checked here, it may not exist on your system` })),
  ].sort((x, y) => order(x.file) - order(y.file) || x.line - y.line);
  const text = todos.length === 0
    ? `Checked against ${label}. Nothing in the code is marked as left to connect on your system - what stands in for SAP data or objects would carry a "TODO(system):" comment.`
    : `Checked against ${label}. ${todos.length} place${todos.length === 1 ? " is" : "s are"} left to connect on your system (the "TODO(system):" comments and the function module calls in the code):`;
  const line = room.addLine("notice", text);
  if (todos.length > 0) {
    const list = document.createElement("ul");
    for (const todo of todos) {
      const item = document.createElement("li");
      item.textContent = `${todo.file}:${todo.line} - ${todo.text || "(no note)"}`;
      list.append(item);
    }
    line.append(list);
    room.scrollDown();
  }
  transcript.push({
    role: "note",
    text: [text, ...todos.map((t) => `- ${t.file}:${t.line} - ${t.text || "(no note)"}`)].join("\n"),
  });
  keepConversation();
}

// No key? A model on the reader's own machine needs none: the key form,
// turned to an OpenAI-compatible server at Ollama's address unless a base
// URL is already set. The model's name is the reader's to type - nothing
// here knows what they pulled.
function offerLocalModel() {
  room.showKeyForm(true);
  const provider = document.getElementById("chat-provider");
  const baseUrl = document.getElementById("chat-base-url");
  const model = document.getElementById("chat-model");
  provider.value = "openai";
  provider.dispatchEvent(new Event("change"));
  if (baseUrl.value.trim() === "" || baseUrl.value.trim() === "https://api.openai.com/v1") {
    baseUrl.value = "http://localhost:11434/v1";
    baseUrl.dispatchEvent(new Event("input"));
  }
  model.focus();
}

export const chatOpen = () => open;

/** agent-hooks.mjs, in the frames' roundtrip( ): the model's request parked for
 *  Run's frame, taken - the one frame this page has (the Pilot has tabs). */
export function takePilotRequest() {
  return driver.take();
}

/** agent-hooks.mjs, after every answer the framework gave the frame. */
export function sawRoundtrip(body, response) {
  driver.saw(body, response);
}

/** A file drop on the studio's page, or on the app in its frame (dropFiles
 *  in agent-hooks.mjs, a message through frame-link.mjs): to the chat,
 *  which a phone brings forward. */
export function chatDropped(files) {
  if (!room?.attaching || !open || files.length === 0) return;
  if (narrow()) setStage("chat", true);
  room.attaching.add(files);
}

function transcriptMarkdown() {
  const lines = [`# abap2UI5 AI Studio - ${new Date().toLocaleString()}`, ""];
  const them = who() === "Claude" ? "Claude" : "The model";
  for (const { role, text } of transcript) {
    if (role === "user") lines.push(`## You`, "", text, "");
    else if (role === "assistant") lines.push(`## ${them}`, "", text, "");
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
    if (room.busy) return;
    try {
      host.setFiles(before);
    } catch (e) {
      room.addLine("notice is-error", `The files could not be put back: ${String(e?.message ?? e)}`);
      return;
    }
    line.remove();
    showAppName();
    room.addLine("notice", "The files are back as they were before that step - the model is told with your next message.");
    transcript.push({ role: "note", text: "the files were put back as before the last step" });
    keepConversation();
    host.run().catch(() => {});
  });
  line.append(button);
  el.log.append(line);
  room.scrollDown();
}

// "Edit" on the reader's latest message: the exchange is taken out of the
// conversation and the text put back to send again, changed. And then the
// message before it is the latest, and gets its ✎ - the exchanges go one at
// a time, from the end.
function offerEdit() {
  const last = userLines.at(-1);
  if (!last || (!room.agent && !resume)) return;
  const { div, text, files } = last;
  if (div.querySelector(".chat-edit")) return;
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "chat-edit";
  edit.title = "Edit this message and send it again - the answer to it is taken back";
  edit.setAttribute("aria-label", "Edit this message and send it again");
  edit.textContent = "✎";
  edit.addEventListener("click", () => {
    if (room.busy || !rewind()) return;
    for (let node = div.nextSibling; node; ) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
    div.remove();
    room.rows.clear();
    const at = transcript.findLastIndex((t) => t.role === "user");
    if (at !== -1) transcript.length = at;
    userLines.pop();
    // Whatever is typed already stays, after the message put back.
    const typed = el.input.value.trim();
    el.input.value = typed && typed !== text ? `${text}\n${el.input.value}` : text;
    if (files.length > 0) room.attaching.add(files);
    el.input.focus();
    setStatus("edit the message and send it again");
    offerEdit();
    keepConversation();
  });
  div.append(edit);
}

// The last exchange out of the history - the agent's, or, before an agent
// is made for a conversation taken up after a reload, the kept one's.
function rewind() {
  if (room.agent) return room.agent.rewind();
  const turn = resume?.turns?.pop();
  if (!turn) return false;
  resume.messages.length = turn.at;
  resume.seen = turn.seen;
  resume.seenFiles = turn.seenFiles;
  return true;
}

// ------------------------------------------------- the conversation, kept
//
// After every turn, and after everything that changes the history by hand
// (✎, a checkpoint, the download's notice): what the agent is made of and
// what the log shows, for the tab. Never the key, never the files - the key
// is typed again, the files are the welcome's "open the last build again".

function keepConversation() {
  const state = room.agent?.state ?? resume;
  if (!state || state.messages.length === 0) {
    forgetConversation();
    return;
  }
  writeSessionJson(CONVERSATION_STORAGE, {
    state,
    transcript: transcript.map(({ role, text }) => ({ role, text })),
  });
}

function forgetConversation() {
  removeSession(CONVERSATION_STORAGE);
}

// The log drawn again from what was kept, the history handed to the agent
// once it is made. Answers whether there was a conversation to take up.
function restoreConversation() {
  const kept = readSessionJson(CONVERSATION_STORAGE);
  const state = kept?.state;
  if (!Array.isArray(state?.messages) || state.messages.length === 0 || !Array.isArray(state.turns) || !Array.isArray(kept.transcript)) {
    forgetConversation();
    return false;
  }
  resume = state;
  el.log.replaceChildren();
  transcript = [];
  userLines = [];
  for (const entry of kept.transcript) {
    if (typeof entry?.text !== "string") continue;
    const { role, text } = entry;
    if (role === "user") {
      const line = room.addLine("user", text);
      userLines.push({ div: line, text, files: [] });
      transcript.push({ role, text });
    } else if (role === "assistant") {
      const line = room.addLine("assistant", "");
      renderMarkdown(line, text);
      transcript.push({ role, text, el: line });
    } else if (role === "did" || role === "failed") {
      room.addLine(role === "failed" ? "tool is-error" : "tool", text);
      transcript.push({ role, text });
    } else if (role === "note") {
      room.addLine("notice", text);
      transcript.push({ role, text });
    }
  }
  // Only the messages the history holds can be taken out of it: a line of
  // the reader's whose turn failed is in the transcript, not in the turns.
  userLines = userLines.slice(-state.turns.length);
  room.addLine("notice", "Your conversation is back from before the reload. The app is not running yet - it starts again with the next change, or run it from the Code stage.");
  const offer = resumeOffer();
  if (offer) el.log.append(offer);
  room.scrollDown(true);
  offerEdit();
  return true;
}

function setOpen(value) {
  open = value;
  el.toggle?.setAttribute("aria-checked", String(open));
  if (el.toggle) el.toggle.title = open ? "Back to the ABAP editor" : "Build an app by describing it - an AI chat";
  el.chat.hidden = !open;
  el.bar.hidden = !open;
  document.body.classList.toggle("is-studio", open);
  // A turn that kept running while the studio was closed is still working.
  document.body.classList.toggle("is-ai-working", room.busy && open);
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
  room.showKeyForm(!room.hasKey());
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
  // A run that changed no file is a second look at the same app, not an
  // update - run_app put a card in the log every time.
  const now = JSON.stringify(host.files());
  if (now === cardFiles) return;
  cardFiles = now;
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
    room.flashStage();
  });
  el.log.append(card);
  room.scrollDown();
  room.flashStage();
}

function showWelcome() {
  el.log.replaceChildren();
  const intro = document.createElement("div");
  intro.className = "chat-welcome";
  const title = document.createElement("h2");
  title.textContent = "What do you want to build?";
  const lead = document.createElement("p");
  const them = who();
  lead.textContent =
    `Describe the app you want. ${them === "Claude" ? "Claude" : "The model"} writes it as an abap2UI5 class into the editor, runs it here and fixes ` +
    "what the checks find - the app appears on the right. Ask for changes until it fits, then download it for abapGit. " +
    `Add a specification, a screenshot or an Excel sheet with data with 📎 and ${them} builds from it.`;
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
  // Without a key nothing here answers; a local model is the way in that
  // costs nothing. Offered while no key is held.
  if (!room.hasKey()) {
    const local = document.createElement("p");
    local.className = "chat-local";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost chat-local-open";
    button.textContent = "Use a model on your own machine";
    button.addEventListener("click", offerLocalModel);
    local.append("No API key? ", button, " - Ollama or LM Studio, no key and no cost; it needs a model that can call tools.");
    intro.append(local);
  }
  const offer = resumeOffer();
  if (offer) intro.append(offer);
  el.log.append(intro);
}

// The last build this browser kept (main.mjs stores the studio's files
// under a key of its own): offered back, not opened by itself - the
// studio starts on the minimal class every time, and the model is told
// what the editor holds with the first message (<editor_files>). On the
// welcome, and under a conversation taken up after a reload.
function resumeOffer() {
  const last = host.lastBuild?.();
  if (last && host.files().every(isUntouchedStarter)) {
    const block = document.createElement("div");
    block.className = "chat-resume";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "chat-suggestion chat-resume-open";
    open.textContent = `Open the last build again · ${last[0].name.replace(/\.clas\.abap$/, "").toUpperCase()}${last.length > 1 ? ` · ${last.length} files` : ""}`;
    open.addEventListener("click", () => {
      try {
        host.setFiles(last);
      } catch (e) {
        room.addLine("notice is-error", `The last build could not be opened: ${String(e?.message ?? e)}`);
        return;
      }
      block.remove();
      showAppName();
      room.addLine("notice", "The last build is back in the editor - ask for a change, or describe something new.");
      // Run, so the stage shows it; the report goes nowhere.
      host.run().catch(() => {});
    });
    const forget = document.createElement("button");
    forget.type = "button";
    forget.className = "ghost chat-resume-forget";
    forget.textContent = "forget it";
    forget.addEventListener("click", () => {
      host.forgetLastBuild?.();
      block.remove();
    });
    block.append(open, forget);
    return block;
  }
  return null;
}
