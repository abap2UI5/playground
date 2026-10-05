// The AI Pilot: Claude operates the running app, and the reader steers it in
// the chat - "add Carol, then submit", and the app on screen fills the field
// and presses the button while they watch.
//
// A page of its own, pilot/index.html (written by tools/build-site.mjs from
// the playground's index.html, `data-page="pilot"`), and a room of its own in
// shell.css ("AI Pilot"): the app takes the stage, the chat is the co-pilot
// beside it, and the editor is out of sight - the Pilot operates an app, it
// does not write one (that is the AI Studio, one directory over).
//
// How the model reaches the app is the abap2UI5 agent protocol: the agent
// snapshot (the screen as fields, actions, tables and messages) and the act
// (fill fields, fire an event), implemented by abap2UI5/mcp-server's own
// client, vendored unchanged into src/vendor/agent/ and run in the chunk
// src/shell/pilot-agent.mjs. That client sends its requests through a
// `transport`, and the transport here is the APP FRAME: the frame is made to
// send a roundtrip (frontend-bridge.js, __z2ui5PlaygroundPilot.roundtrip),
// the page puts the Pilot's request in place of the frame's (main.mjs, the
// bridge's roundtrip( ) asks takePilotRequest( )), and the answer goes both
// to the client and to the frame, which renders it with its own code. So
// what the model did is what the reader sees - a popup opens, a toast shows,
// a table grows - and nothing is simulated.
//
// The other way round: every answer the frame gets, the reader's own clicks
// included, passes sawRoundtrip( ) and is folded into the MIRROR, the screen
// as the agent protocol describes it (pilot-agent.mjs). The model's session
// is started from the mirror whenever the reader moved the app on, so the
// reader can take the controls at any moment and Claude continues from where
// they left it.
//
// The key is the reader's, held in memory for the visit - the same rule, and
// the same reason, as the AI Studio's (src/shell/chat.mjs).
import { renderMarkdown } from "./chat.mjs";
import { highlightJson } from "./highlight.mjs";
import { readStored, removeStored, writeStored } from "./storage.mjs";
import { setStatus } from "./ui.mjs";

// Shared with the AI Studio: one workspace and one speed for the site's two
// chats. The key itself is never stored, by either.
const WORKSPACE_STORAGE = "abap2ui5-playground:anthropic-workspace";
const SPEED_STORAGE = "abap2ui5-playground:ai-speed";
const DEFAULT_SPEED = "balanced";
// Whether "What Claude sees" was left open - a preference like a split.
const SEES_STORAGE = "abap2ui5-playground:pilot-sees";
const narrow = () => window.matchMedia("(max-width: 820px)").matches;

const SUGGESTIONS = [
  "What can I do in this app?",
  "Fill in the form with sample data and send it",
  "Open the value help sample and pick a color",
];

let host;
let el;
let sessionKey = null;
// The chunk: the vendored client, the mirrors, the conversation and the SDK.
// Asked for when the page starts, not on the first message - the mirrors
// have to see each app's first roundtrip, and this page is the chat.
let chunk;
let mod;

// The apps on the stage, one tab each. Tab "1" is Run's own frame (#app) and
// the app the first file declares; the others are frames of their own, added
// by openApp( ) with `beside`, which load their class from the same build of
// classes in the same runtime - one database, so what one app writes the
// others can read. Each tab keeps the screen of its app (`mirror`), the act
// parked for its frame (`request`) and whatever the frame was answered before
// the chunk arrived (`early`).
const MAX_APPS = 4;
const tabs = [];
let visible = "1";
let nextTab = 2;
// Whether the next pick in the samples browser opens beside the others (the
// tab strip's +) or in place of the app on screen (Change app).
let pickBeside = false;

let agent;
let active;
let stopAsked = false;
let generation = 0;
let busy = false;
let current;
let raw = "";
let note;
const rows = new Map();
let hudTimer;

const tabById = (id) => tabs.find((t) => t.id === id);
const visibleTab = () => tabById(visible) ?? tabs[0];
const frameApi = (tab) => tab.frame.contentWindow?.__z2ui5PlaygroundPilot;
const classOf = (files) => files[0].name.replace(/\.clas\.abap$/, "");

// Which tab a roundtrip came from: the frame's own address names it
// (?pilot=<tab>), and Run's frame names none.
function tabFrom(from) {
  let id = null;
  try {
    id = from ? new URL(from, document.baseURI).searchParams.get("pilot") : null;
  } catch {
    id = null;
  }
  return tabById(id ?? "1");
}

// ------------------------------------------------------------- the bridge

/** main.mjs, in the bridge's roundtrip( ): the Pilot's request parked for
 *  the frame that is asking, if there is one - taken, so it goes out once. */
export function takePilotRequest(from) {
  const tab = host && tabFrom(from);
  const taken = tab?.request;
  if (!taken) return null;
  tab.request = null;
  taken.settled();
  return taken;
}

/** main.mjs, after every answer the framework gave a frame. */
export function sawRoundtrip(body, response, from) {
  const tab = host && tabFrom(from);
  if (!tab) return;
  if (tab.mirror) tab.mirror.observe(body, response);
  else tab.early.push([body, response]);
}

/** main.mjs, after a Run: one fresh database for all of them, so every other
 *  app starts again too - or closes, when its class left the files. */
export function pilotRan() {
  if (!host) return;
  const names = new Set(host.files().map((f) => f.name));
  for (const tab of tabs.slice(1)) {
    if (names.has(`${tab.cls}.clas.abap`)) loadFrame(tab);
    else closeTab(tab.id);
  }
}

/** main.mjs: a pick in the samples browser - files, or a promise of them. */
export async function pilotPicked(files) {
  const beside = pickBeside;
  pickBeside = false;
  try {
    const picked = await files;
    if (!picked) return;
    const report = await openApp(picked, beside ? { beside: true } : { tab: visible });
    if (!report.started) setStatus(`the app could not be opened - ${report.status}`, true);
  } catch (e) {
    setStatus(`the app could not be opened - ${String(e?.message ?? e)}`, true);
  }
}

/*
 * One request of the Pilot, sent by a tab's frame so that the frame renders
 * the answer. Answers what the framework answered ({ status, body }), or
 * rejects when the frame cannot send - no app in it, or a frontend that no
 * longer has what frontend-bridge.js reaches for.
 */
function drive(tab, body) {
  return new Promise((resolve, reject) => {
    const gaveUp = setTimeout(() => {
      if (tab.request?.body !== body) return;
      tab.request = null;
      reject(new Error("the app did not send the roundtrip - restart_app starts it again"));
    }, 15000);
    tab.request = { body, resolve, reject, settled: () => clearTimeout(gaveUp) };
    let sent = false;
    try {
      sent = frameApi(tab)?.roundtrip() === true;
    } catch {
      sent = false;
    }
    if (!sent) {
      clearTimeout(gaveUp);
      tab.request = null;
      reject(new Error("the app could not be updated - it is not running (restart_app starts it)"));
    }
  });
}

// --------------------------------------------------------------- the tabs

function addTab(id, frame, cls) {
  const tab = { id, frame, cls, mirror: null, early: [], request: null, known: "" };
  tabs.push(tab);
  if (mod) attachMirror(tab);
  return tab;
}

function attachMirror(tab) {
  tab.mirror = mod.createMirror({ onChange: () => screenChanged(tab) });
  for (const [body, response] of tab.early.splice(0)) tab.mirror.observe(body, response);
}

// (Re)loads a tab's frame on its class, at the current Run - Run's own frame
// as well as the others, with the address run( ) builds.
function loadFrame(tab) {
  const src = host.frameSrc(tab.cls, tab.id === "1" ? {} : { pilot: tab.id });
  tab.frame.dataset.src = src;
  const win = tab.frame.contentWindow;
  try {
    if (win && win.location.href !== "about:blank") {
      win.location.replace(src);
      return;
    }
  } catch {
    // another origin - set src instead
  }
  tab.frame.src = src;
}

// Until the tab's app has started: its first answer folded, and rendered -
// the frame says busy until its main view is there (frontend-bridge.js).
async function started(tab, versionBefore) {
  const until = performance.now() + 30000;
  while (performance.now() < until) {
    let rendering = true;
    try {
      rendering = frameApi(tab)?.busy() !== false;
    } catch {
      rendering = true;
    }
    if (tab.mirror.version !== versionBefore && tab.mirror.state.id && !rendering) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/*
 * An app onto the stage: in tab `tab` in place of the app there, or - with
 * `beside` - in a tab of its own beside the others. Its files go into the
 * editor and are compiled with the rest (host.addFiles: no fresh database,
 * so the other apps keep their state); a Run app replaced becomes the first
 * file, so Restart starts it from then on.
 */
async function openApp(files, { beside = false, tab: target } = {}) {
  await chunk;
  let tab = beside ? null : tabById(target ?? visible);
  if (!beside && !tab) return { started: false, status: `there is no app ${target}` };
  if (beside && tabs.length >= MAX_APPS) {
    return { started: false, status: `${MAX_APPS} apps are open - close one first` };
  }
  const cls = classOf(files);
  const report = await host.addFiles(files, tab?.id === "1" ? { first: files[0].name } : {});
  if (!report.started) return report;
  if (!tab) {
    const frame = document.createElement("iframe");
    const id = String(nextTab++);
    frame.title = `app ${id}`;
    frame.className = "pilot-frame";
    el.stage.querySelector(".app-frame").append(frame);
    tab = addTab(id, frame, cls);
  }
  tab.cls = cls;
  const before = tab.mirror.version;
  loadFrame(tab);
  showTab(tab.id);
  if (!(await started(tab, before))) return { started: false, status: `${cls.toUpperCase()} did not start within 30 seconds` };
  return { started: true, status: "running", tab: tab.id };
}

function closeTab(id) {
  if (id === "1") return false;
  const tab = tabById(id);
  if (!tab) return false;
  tabs.splice(tabs.indexOf(tab), 1);
  tab.request?.reject(new Error("the app was closed"));
  tab.frame.remove();
  if (visible === id) visible = "1";
  showTab(visible);
  return true;
}

function showTab(id) {
  if (!tabById(id)) return;
  visible = id;
  for (const tab of tabs) tab.frame.classList.toggle("is-behind", tab.id !== id);
  renderTabs();
  screenChanged(visibleTab());
}

// The strip over the stage: a tab per app, and + to open another beside.
function renderTabs() {
  const buttons = [];
  for (const tab of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.className = "pilot-tab";
    button.dataset.tab = tab.id;
    button.setAttribute("aria-selected", String(tab.id === visible));
    const app = tab.mirror?.state.app || tab.cls?.toUpperCase() || "starting…";
    button.textContent = `${tab.id} · ${app}`;
    button.addEventListener("click", () => showTab(tab.id));
    buttons.push(button);
    if (tab.id !== "1") {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "pilot-tab-close";
      close.title = `Close app ${tab.id}`;
      close.setAttribute("aria-label", `Close app ${tab.id}`);
      close.textContent = "×";
      close.addEventListener("click", () => closeTab(tab.id));
      buttons.push(close);
    }
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "pilot-tab-add";
  add.title = "Open another app beside this one";
  add.textContent = "+ App";
  add.disabled = tabs.length >= MAX_APPS;
  add.addEventListener("click", () => {
    pickBeside = true;
    host.openSamples();
  });
  buttons.push(add);
  el.tabs.replaceChildren(...buttons);
}

// ---------------------------------------------------------------- the page

/**
 * `pilotHost` is the page (main.mjs):
 *   files()                   the open files, the app first
 *   run()                     Run, and its report (runForAgent)
 *   addFiles(files, {first})  files beside the open ones, compiled, no Run
 *   frameSrc(cls, params)     the address a frame loads an app from
 *   mainFrame                 Run's own frame
 *   carried(cls)              a sample the page carries, by class
 *   fetchLinked(url)          a catalogued class and the classes it needs
 *   openSamples()             the samples browser
 *   appClass()                the class Run starts
 */
export function setUpPilot(pilotHost) {
  host = pilotHost;
  el = {
    bar: document.getElementById("pilot-bar"),
    chat: document.getElementById("pilot"),
    log: document.getElementById("pilot-log"),
    compose: document.getElementById("pilot-compose"),
    input: document.getElementById("pilot-input"),
    send: document.getElementById("pilot-send"),
    keyForm: document.getElementById("pilot-key"),
    keyInput: document.getElementById("pilot-key-input"),
    workspaceInput: document.getElementById("pilot-workspace-input"),
    keyButton: document.getElementById("pilot-key-button"),
    keyRemove: document.getElementById("pilot-key-remove"),
    usage: document.getElementById("pilot-usage"),
    reset: document.getElementById("pilot-new"),
    speed: document.getElementById("pilot-speed"),
    appName: document.getElementById("pilot-app-name"),
    change: document.getElementById("pilot-change"),
    restart: document.getElementById("pilot-restart"),
    sees: document.getElementById("pilot-sees"),
    seesPanel: document.getElementById("pilot-sees-panel"),
    seesBody: document.getElementById("pilot-sees-body"),
    views: [...document.querySelectorAll(".pilot-view")],
    fullscreen: document.getElementById("pilot-fullscreen"),
    hud: document.getElementById("pilot-hud"),
    stage: document.getElementById("pane-right"),
    tabs: document.getElementById("pilot-tabs"),
    files: document.getElementById("pilot-files"),
    attach: document.getElementById("pilot-attach"),
    fileInput: document.getElementById("pilot-file-input"),
  };

  document.body.classList.add("is-pilot");
  el.bar.hidden = false;
  el.chat.hidden = false;
  // The narrow layout hides a pane by attribute; here the view decides.
  document.getElementById("pane-right").hidden = false;
  setView("app");

  addTab("1", host.mainFrame, host.appClass());
  el.tabs.hidden = false;
  renderTabs();

  chunk = import("./pilot-agent.mjs").then((loaded) => {
    mod = loaded;
    for (const tab of tabs) attachMirror(tab);
    return loaded;
  });
  // A chunk that did not arrive is said when a message needs it; until then
  // nothing is waiting on it.
  chunk.catch(() => {});

  el.change.addEventListener("click", () => {
    pickBeside = false;
    host.openSamples();
  });
  el.restart.addEventListener("click", async () => {
    el.restart.disabled = true;
    try {
      await host.run();
    } finally {
      el.restart.disabled = false;
    }
  });
  el.sees.addEventListener("click", () => setSees(el.seesPanel.hidden, true));
  for (const button of el.views) button.addEventListener("click", () => setView(button.dataset.view));
  el.fullscreen.hidden = !document.fullscreenEnabled;
  el.fullscreen.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });

  el.keyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = el.keyInput.value.trim();
    if (key === "" && sessionKey === null) return;
    if (key !== "") sessionKey = key;
    const workspace = el.workspaceInput.value.trim();
    if (workspace === "") removeStored(WORKSPACE_STORAGE);
    else writeStored(WORKSPACE_STORAGE, workspace);
    el.keyInput.value = "";
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
  // Files for the next message: the paperclip, a drop anywhere on the chat,
  // or a paste into the message.
  el.attach.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", () => {
    addFiles([...el.fileInput.files]);
    el.fileInput.value = "";
  });
  el.chat.addEventListener("dragover", (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
    e.preventDefault();
    el.chat.classList.add("is-dropping");
  });
  el.chat.addEventListener("dragleave", (e) => {
    if (!el.chat.contains(e.relatedTarget)) el.chat.classList.remove("is-dropping");
  });
  el.chat.addEventListener("drop", (e) => {
    el.chat.classList.remove("is-dropping");
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
  });
  el.input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  });

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

  const stored = readStored(SPEED_STORAGE);
  if (stored && [...el.speed.options].some((o) => o.value === stored)) el.speed.value = stored;
  el.speed.addEventListener("change", () => {
    if (el.speed.value === DEFAULT_SPEED) removeStored(SPEED_STORAGE);
    else writeStored(SPEED_STORAGE, el.speed.value);
  });

  window.matchMedia("(max-width: 820px)").addEventListener("change", () => setView(document.body.dataset.view));
  setSees(readStored(SEES_STORAGE) === "open" && !narrow());
  showWelcome();
  showKeyForm(true);
}

// On a phone the app and the chat take turns; at desk width both are on
// screen and the view is only remembered for the next crossing.
function setView(view) {
  const next = view === "chat" ? "chat" : "app";
  document.body.dataset.view = next;
  for (const button of el.views) button.setAttribute("aria-selected", String(button.dataset.view === next));
}

function setSees(open, chosen = false) {
  el.seesPanel.hidden = !open;
  el.sees.setAttribute("aria-pressed", String(open));
  document.body.classList.toggle("is-pilot-sees", open);
  if (chosen) {
    if (open) writeStored(SEES_STORAGE, "open");
    else removeStored(SEES_STORAGE);
  }
  if (open) renderSees();
}

// A tab's screen changed - an answer its frame got, from the Pilot's act or
// the reader's click. The strip names its app; the bar and "What Claude
// sees" follow the tab on screen; a NEW app in a tab is said in the chat.
function screenChanged(tab) {
  if (!tab) return;
  const app = tab.mirror?.state.app ?? "";
  if (app && tab.known && app !== tab.known) addCard(`Tab ${tab.id} is now on ${app}`, tab.id);
  else if (app && !tab.known && tab.id !== "1") addCard(`Opened ${app} beside - tab ${tab.id}`, tab.id);
  if (app) tab.known = app;
  renderTabs();
  if (tab.id !== visible) return;
  el.appName.textContent = app ? `${app} · running in your browser` : "no app running";
  if (!el.seesPanel.hidden) renderSees();
}

function renderSees() {
  const tab = visibleTab();
  if (!mod || !tab?.mirror) {
    el.seesBody.textContent = "loading…";
    return;
  }
  el.seesBody.replaceChildren(highlightJson(JSON.stringify(mod.describeMirror(tab.mirror), null, 2)));
}

// What the Pilot is doing, written over the app for a moment: the reader
// follows the model by what happens on the stage, and a value that arrives
// in a field reads better with "typing" beside it.
function showHud(text) {
  clearTimeout(hudTimer);
  el.hud.textContent = text;
  el.hud.hidden = false;
  el.hud.classList.remove("is-on");
  void el.hud.offsetWidth;
  el.hud.classList.add("is-on");
  hudTimer = setTimeout(() => {
    el.hud.classList.remove("is-on");
    el.hud.hidden = true;
  }, 2600);
}

function flashStage() {
  el.stage.classList.remove("is-flash");
  void el.stage.offsetWidth;
  el.stage.classList.add("is-flash");
}

function showKeyForm(show) {
  el.keyForm.hidden = !show;
  el.keyRemove.hidden = sessionKey === null;
  if (show) el.workspaceInput.value = readStored(WORKSPACE_STORAGE) ?? "";
}

function stopTurn() {
  stopAsked = true;
  active?.stop();
}

function startOver() {
  if (busy) stopTurn();
  agent = undefined;
  generation += 1;
  finishRows();
}

function finishRows() {
  for (const row of rows.values()) {
    row.className = "pilot-msg pilot-tool is-error";
    row.textContent = `${row.textContent.replace(/…$/, "")} - not finished`;
  }
  rows.clear();
}

function showWelcome() {
  el.log.replaceChildren();
  const intro = document.createElement("div");
  intro.className = "pilot-welcome";
  const title = document.createElement("h2");
  title.textContent = "You steer, Claude flies the app.";
  const lead = document.createElement("p");
  lead.textContent =
    "Say what you want done in the app on screen. Claude reads the screen, fills the fields and presses the " +
    "buttons - in this app, in your browser, while you watch. Take the controls yourself any time; Claude " +
    "carries on from wherever you left it. Add a PDF, an Excel sheet or a Word file with 📎 and Claude " +
    "works from it - the orders to enter, the values to check.";
  const list = document.createElement("div");
  list.className = "pilot-suggestions";
  for (const text of SUGGESTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pilot-suggestion";
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

// ---------------------------------------------------------------- files

// The files waiting for the next message. Checked as they are added - a
// format the chat cannot read is said at once, not after Send - and read only
// when the message goes (attachments.mjs, in the chunk).
let attached = [];

async function addFiles(files) {
  const loaded = await chunk;
  for (const file of files) {
    const kind = loaded.kindOf(file);
    if (kind.error) {
      addLine("notice is-error", kind.error);
      continue;
    }
    if (attached.length >= loaded.MAX_FILES) {
      addLine("notice is-error", `${file.name} was left out - ${loaded.MAX_FILES} files go with one message`);
      continue;
    }
    if (!attached.some((f) => f.name === file.name && f.size === file.size)) attached.push(file);
  }
  renderFiles();
  el.input.focus();
}

function renderFiles() {
  el.files.hidden = attached.length === 0;
  el.files.replaceChildren(
    ...attached.map((file) => {
      const chip = document.createElement("span");
      chip.className = "pilot-file";
      chip.append(`${file.name} · ${sizeOf(file.size)}`);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "pilot-file-remove";
      remove.textContent = "×";
      remove.title = `Remove ${file.name}`;
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.addEventListener("click", () => {
        attached = attached.filter((f) => f !== file);
        renderFiles();
      });
      chip.append(remove);
      return chip;
    }),
  );
}

const sizeOf = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function addLine(kind, text) {
  const div = document.createElement("div");
  div.className = `pilot-msg pilot-${kind}`;
  div.textContent = text;
  el.log.append(div);
  scrollDown();
  return div;
}

function addCard(text, tabId) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "pilot-card";
  card.append(`✈ ${text}`);
  const hint = document.createElement("span");
  hint.textContent = "show it";
  card.append(hint);
  card.addEventListener("click", () => {
    setView("app");
    if (tabId) showTab(tabId);
    flashStage();
  });
  el.log.append(card);
  scrollDown();
}

function scrollDown() {
  el.log.scrollTop = el.log.scrollHeight;
}

function setBusy(value) {
  busy = value;
  el.send.textContent = busy ? "Stop" : "Send";
  el.send.classList.toggle("primary", !busy);
  el.chat.classList.toggle("is-busy", busy);
  document.body.classList.toggle("is-pilot-flying", busy);
  el.log.setAttribute("aria-busy", String(busy));
}

async function submit() {
  const typed = el.input.value.trim();
  if (typed === "" && attached.length === 0) return;
  // Files alone are a message too: the model is told they are what it is about.
  const text = typed || "Here are the files.";
  if (sessionKey === null) {
    showKeyForm(true);
    el.keyInput.focus();
    return;
  }
  el.log.querySelector(".pilot-welcome")?.remove();
  el.input.value = "";
  const files = attached;
  attached = [];
  renderFiles();
  const said = addLine("user", typed);
  if (files.length > 0) {
    const list = document.createElement("span");
    list.className = "pilot-user-files";
    list.textContent = files.map((f) => `📎 ${f.name}`).join("\n");
    said.append(list);
  }
  setBusy(true);
  stopAsked = false;
  current = undefined;
  note = undefined;
  raw = "";

  const gen = generation;
  const live = () => gen === generation;
  let turn;
  try {
    await chunk;
    if (stopAsked || !live()) {
      if (live()) addLine("notice", "Stopped.");
      setStatus("stopped");
      return;
    }
    if (!agent) {
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
        toolPending({ id, text: line }) {
          current = undefined;
          note = undefined;
          let row = rows.get(id);
          if (!row) {
            row = addLine("tool is-pending", "");
            rows.set(id, row);
          }
          row.textContent = line;
          scrollDown();
        },
        text(delta) {
          if (!current) {
            current = addLine("assistant", "");
            raw = "";
          }
          raw += delta;
          renderMarkdown(current, raw);
          scrollDown();
        },
        tool({ id, summary, error }) {
          current = undefined;
          note = undefined;
          const row = rows.get(id) ?? addLine("tool", "");
          rows.delete(id);
          row.className = `pilot-msg pilot-tool${error ? " is-error" : ""}`;
          row.textContent = summary;
          scrollDown();
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
        // The model is about to do something to the app: said over it, and
        // on a phone the app comes forward so the reader sees it happen.
        acting(t) {
          showHud(t);
          if (narrow()) setView("app");
        },
      };
      const agentGen = generation;
      const guarded = Object.fromEntries(
        Object.entries(ui).map(([k, f]) => [k, (...args) => (agentGen === generation ? f(...args) : undefined)]),
      );
      agent = mod.createPilot({
        apiKey: sessionKey,
        workspace: readStored(WORKSPACE_STORAGE) ?? undefined,
        host: {
          files: host.files,
          run: host.run,
          carried: host.carried,
          fetchLinked: host.fetchLinked,
          // The apps on the stage, as the conversation takes them.
          apps: () =>
            tabs.map((tab) => ({
              id: tab.id,
              visible: tab.id === visible,
              mirror: tab.mirror,
              cls: tab.cls,
              frame: () => frameApi(tab),
              drive: (body) => drive(tab, body),
            })),
          show: (id) => showTab(id),
          openApp: (files, options) => openApp(files, options),
          closeApp: (id) => closeTab(id),
        },
        speed: () => el.speed.value,
        ui: guarded,
      });
    }
    turn = agent;
    active = turn;
    setStatus("the Pilot is flying…");
    const { stopped } = await turn.send(text, files);
    if (!live()) return;
    if (stopped) addLine("notice", "Stopped.");
    setStatus(stopped ? "stopped" : "the Pilot is done");
  } catch (e) {
    if (!live()) return;
    const said = mod ? mod.explainError(e) : { text: `The AI part of the page could not be loaded: ${String(e?.message ?? e)}` };
    addLine(said.stopped ? "notice" : "notice is-error", said.text);
    setStatus(said.stopped ? "stopped" : "the AI request failed", !said.stopped);
    if (said.key) {
      showKeyForm(true);
      (said.workspace ? el.workspaceInput : el.keyInput).focus();
    }
  } finally {
    if (active === turn) active = undefined;
    if (live()) finishRows();
    setBusy(false);
  }
}
