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
import { listenForFileDrops } from "./attach-ui.mjs";
import { createChatRoom, narrow } from "./chat-ui.mjs";
import { abapGitZip, download } from "./export.mjs";
import { createDriver } from "./frame-drive.mjs";
import { readStored, removeStored, writeStored } from "./storage.mjs";
import { setStatus } from "./ui.mjs";

const KEY_STORAGE = "abap2ui5-playground:anthropic-key";
// The stage the studio last showed - kept, the way a split is.
const STAGE_STORAGE = "abap2ui5-playground:ai-stage";
const STAGES = ["chat", "preview", "code", "split"];

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
const frameApi = () => document.getElementById("app")?.contentWindow?.__z2ui5PlaygroundPilot;
let open = false;
let el;
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

  // The key form, Send and Stop, New chat, the speed and the files for the
  // next message (chat-ui.mjs). The kinds and the limit of the files are the
  // agent chunk's, imported the first time a file is added.
  room = createChatRoom({
    prefix: "chat",
    el,
    // A turn that keeps running while the studio is closed is still working.
    onBusy: (busy) => document.body.classList.toggle("is-ai-working", busy && open),
    onStartOver: () => {
      transcript = [];
      lastUser = undefined;
    },
    showWelcome,
    rules: () => import("./ai-agent.mjs"),
    turn: {
      load: () => import("./ai-agent.mjs"),
      sent({ line, typed, files }) {
        lastUser?.div.querySelector(".chat-edit")?.remove();
        lastUser = { div: line, text: typed, files };
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
        return mod.createAgent({
          ...conversation,
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
      settled: () => offerEdit(),
    },
  });
  // A drop anywhere on the studio's own page.
  if (startOpen) listenForFileDrops({ highlight: el.chat, onFiles: (files) => chatDropped(files) });

  el.download.addEventListener("click", () => {
    try {
      const zip = abapGitZip(host.files());
      download(zip.name, zip.bytes);
      setStatus(`${zip.name} is on its way`);
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
    const name = `abap2ui5-ai-studio-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.md`;
    download(name, new TextEncoder().encode(transcriptMarkdown()), "text/markdown");
    setStatus(`${name} is on its way`);
  });

  // No beforeunload here, though a reload takes the conversation with it:
  // nothing on this site may keep a page out of the back/forward cache
  // (tests/bfcache.spec.js). The files are kept (the studio's draft in
  // main.mjs) and the conversation can be exported; that is the net.

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
  if (!room?.attaching || !open || files.length === 0) return;
  if (narrow()) setStage("chat", true);
  room.attaching.add(files);
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
    host.run().catch(() => {});
  });
  line.append(button);
  el.log.append(line);
  room.scrollDown();
}

// "Edit" on the reader's latest message: the exchange is taken out of the
// conversation and the text put back to send again, changed.
function offerEdit() {
  if (!lastUser || !room.agent) return;
  const { div, text, files } = lastUser;
  if (div.querySelector(".chat-edit")) return;
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "chat-edit";
  edit.title = "Edit this message and send it again - the answer to it is taken back";
  edit.setAttribute("aria-label", "Edit this message and send it again");
  edit.textContent = "✎";
  edit.addEventListener("click", () => {
    if (room.busy || !room.agent?.rewind()) return;
    for (let node = div.nextSibling; node; ) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
    div.remove();
    room.rows.clear();
    const at = transcript.findLastIndex((t) => t.role === "user");
    if (at !== -1) transcript.length = at;
    lastUser = undefined;
    el.input.value = text;
    if (files.length > 0) room.attaching.add(files);
    el.input.focus();
    setStatus("edit the message and send it again");
  });
  div.append(edit);
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
        room.addLine("notice is-error", `The last build could not be opened: ${String(e?.message ?? e)}`);
        return;
      }
      resume.remove();
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
      resume.remove();
    });
    resume.append(open, forget);
    intro.append(resume);
  }
  el.log.append(intro);
}
