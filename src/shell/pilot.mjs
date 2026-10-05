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
// The chunk: the vendored client, the mirror, the conversation and the SDK.
// Asked for when the page starts, not on the first message - the mirror has
// to see the app's first roundtrip, and this page is the chat.
let chunk;
let mirror;
// Roundtrips that arrived before the chunk did (the app's start, usually).
const early = [];
// The act waiting for the frame to send its roundtrip - see drive( ).
let request = null;

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
let knownApp = "";

// ------------------------------------------------------------- the bridge

/** main.mjs, in the bridge's roundtrip( ): the Pilot's request, if one is
 *  waiting for the frame - taken, so it goes out once. */
export function takePilotRequest() {
  const taken = request;
  request = null;
  taken?.settled();
  return taken;
}

/** main.mjs, after every answer the framework gave the frame. */
export function sawRoundtrip(body, response) {
  if (!host) return;
  if (mirror) mirror.observe(body, response);
  else early.push([body, response]);
}

/*
 * One request of the Pilot, sent by the app frame so that the frame renders
 * the answer. Answers what the framework answered ({ status, body }), or
 * rejects when the frame cannot send - no app on screen, or a frontend that
 * no longer has what frontend-bridge.js reaches for.
 */
function drive(body) {
  return new Promise((resolve, reject) => {
    const api = host.frame();
    const gaveUp = setTimeout(() => {
      if (request?.body !== body) return;
      request = null;
      reject(new Error("the app on screen did not send the roundtrip - restart_app starts it again"));
    }, 15000);
    request = { body, resolve, reject, settled: () => clearTimeout(gaveUp) };
    let sent = false;
    try {
      sent = api?.roundtrip() === true;
    } catch {
      sent = false;
    }
    if (!sent) {
      clearTimeout(gaveUp);
      request = null;
      reject(new Error("the app on screen could not be updated - it is not running (restart_app starts it)"));
    }
  });
}

// ---------------------------------------------------------------- the page

/**
 * `pilotHost` is the page (main.mjs):
 *   files()             the open files, the app first
 *   run()               Run, and its report (runForAgent)
 *   openFiles(files)    those files in place of what is open, then Run
 *   fetchLinked(url)    a catalogued class and the classes it needs
 *   openSamples()       the samples browser
 *   frame()             the frame's __z2ui5PlaygroundPilot, or undefined
 *   appClass()          the class Run starts
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
  };

  document.body.classList.add("is-pilot");
  el.bar.hidden = false;
  el.chat.hidden = false;
  // The narrow layout hides a pane by attribute; here the view decides.
  document.getElementById("pane-right").hidden = false;
  setView("app");

  chunk = import("./pilot-agent.mjs").then((mod) => {
    mirror = mod.createMirror({ onChange: screenChanged });
    for (const [body, response] of early.splice(0)) mirror.observe(body, response);
    return mod;
  });
  // A chunk that did not arrive is said when a message needs it; until then
  // nothing is waiting on it.
  chunk.catch(() => {});

  el.change.addEventListener("click", () => host.openSamples());
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

// The screen changed - an answer the frame got, from the Pilot's act or the
// reader's click. The bar names the app; a NEW app is said in the chat.
function screenChanged() {
  const app = mirror.state.app;
  el.appName.textContent = app ? `${app} · running in your browser` : "no app running";
  if (app && app !== knownApp) {
    if (knownApp !== "") addCard(`Now on ${app}`);
    knownApp = app;
  }
  if (!el.seesPanel.hidden) renderSees();
}

function renderSees() {
  if (!mirror) {
    el.seesBody.textContent = "loading…";
    return;
  }
  chunk.then((mod) => {
    el.seesBody.replaceChildren(highlightJson(JSON.stringify(mod.describeMirror(mirror), null, 2)));
  });
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
    "carries on from wherever you left it.";
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

function addLine(kind, text) {
  const div = document.createElement("div");
  div.className = `pilot-msg pilot-${kind}`;
  div.textContent = text;
  el.log.append(div);
  scrollDown();
  return div;
}

function addCard(text) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "pilot-card";
  card.append(`✈ ${text}`);
  const hint = document.createElement("span");
  hint.textContent = "show it";
  card.append(hint);
  card.addEventListener("click", () => {
    setView("app");
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
  const text = el.input.value.trim();
  if (text === "") return;
  if (sessionKey === null) {
    showKeyForm(true);
    el.keyInput.focus();
    return;
  }
  el.log.querySelector(".pilot-welcome")?.remove();
  el.input.value = "";
  addLine("user", text);
  setBusy(true);
  stopAsked = false;
  current = undefined;
  note = undefined;
  raw = "";

  const gen = generation;
  const live = () => gen === generation;
  let mod;
  let turn;
  try {
    mod = await chunk;
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
        host: { ...host, drive },
        mirror,
        speed: () => el.speed.value,
        ui: guarded,
      });
    }
    turn = agent;
    active = turn;
    setStatus("the Pilot is flying…");
    const { stopped } = await turn.send(text);
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
