// The AI half of the AI Pilot (src/shell/pilot.mjs is the half on screen): a
// conversation with Claude, who operates the app running in the frame.
//
// A chunk of its own, imported when the Pilot's page starts: the Anthropic
// SDK, and abap2UI5/mcp-server's agent client (src/vendor/agent/, vendored
// unchanged - tools/vendor-agent.mjs), which describes a screen as an agent
// snapshot and turns "fill these fields, fire that event" into the request
// the browser frontend would have sent.
//
// The model works on the app through tools, and only through tools:
//
//   look          the screen, as the agent snapshot describes it
//   act           fill fields and fire an event - sent BY THE APP FRAME, so
//                 the reader sees it happen (pilot.mjs, drive( ))
//   restart_app   Run: a fresh database, the app from its start
//   find_apps     the sample catalogue this site carries
//   open_app      another app in place of this one
//   read_source   the ABAP of the app on screen
//
// Two copies of the screen, kept apart on purpose. The MIRROR is the screen
// as it is: every answer the frame got, folded the way the frontend folds it
// (applyResponse) - the Pilot's acts and the reader's own clicks alike. The
// CLIENT's session is what the model acts through; it is started from the
// mirror (a replayed answer, answered by the transport without going
// anywhere) whenever the mirror moved on, so the model always acts on the
// screen the reader is looking at, never on a copy that went stale while
// they took the controls.
import Anthropic from "@anthropic-ai/sdk";
import { AgentError, createAppClient } from "../vendor/agent/appclient.mjs";
import { analyzeScreen, applyResponse, emptyState, FRONTEND_EVENTS, getAt, modelKeyOf } from "../vendor/agent/snapshot.mjs";
import { catalogueEntries, DEFAULT_SPEED, SPEEDS } from "./ai-common.mjs";

export { explainError } from "./ai-common.mjs";

const SLOTS = ["MAIN", "NEST", "NEST2", "POPUP", "POPOVER"];
const MAX_ROWS = 20;
const MAX_TOOL_TEXT = 30000;
const clip = (text, max = MAX_TOOL_TEXT) =>
  text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters cut)`;
const str = (v) => (typeof v === "string" ? v : undefined);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------- the mirror

/*
 * The screen as it is, from the answers the frame got. An app start (a
 * request without a draft id) starts it over: a Run, a sample opened, or
 * the Pilot's own restart. An answer that is not one - a dump, a refusal -
 * leaves the screen as it was and is kept as `error`, which the model is
 * told. `onChange` is the page's: the bar names the app, the panel redraws.
 */
export function createMirror({ onChange = () => {} } = {}) {
  const mirror = {
    state: emptyState(),
    version: 0,
    error: null,
    observe(body, response) {
      let request;
      try {
        request = JSON.parse(body);
      } catch {
        request = undefined;
      }
      const front = request?.value?.S_FRONT;
      if (front && !front.ID) mirror.state = emptyState();
      if (!(response.status >= 200 && response.status < 300)) {
        mirror.error = `HTTP ${response.status}: ${String(response.body ?? "").split("\n").slice(0, 6).join("\n")}`;
        mirror.version += 1;
        onChange();
        return;
      }
      let json;
      try {
        json = JSON.parse(response.body);
      } catch {
        return;
      }
      if (!json?.S_FRONT) return;
      mirror.state = applyResponse(mirror.state, json);
      mirror.error = null;
      mirror.version += 1;
      onChange();
    },
    // A slot the frontend closed without a roundtrip - a popup's own close.
    closeSlot(slot) {
      mirror.state = applyResponse(mirror.state, { S_FRONT: { S_ACTION: { T_SYSTEM: [["VIEW_SLOTS", "destroy", slot]] } } });
      mirror.version += 1;
      onChange();
    },
  };
  return mirror;
}

/** The agent snapshot of the mirror: what the "What Claude sees" panel shows. */
export function describeMirror(mirror, maxRows = MAX_ROWS) {
  if (!mirror.state.id) return { note: "no app is running" };
  return analyzeScreen({ state: mirror.state, session: mirror.state.id, maxRows }).snapshot;
}

/*
 * The mirror as ONE answer, for the client to start a session from. Every
 * open slot displayed again, main first (a main display drops the rest);
 * the model the topmost modal layer reads - a popup's own, which may be
 * another app's (a z2ui5_cl_pop_*), else the page's; and the last answer's
 * client work (T_CUSTOM: the toast, the message box), which the snapshot
 * reads its messages from.
 */
function replayOf(state) {
  const T_SYSTEM = [];
  for (const slot of SLOTS) {
    const s = state.slots[slot];
    if (s) T_SYSTEM.push(["VIEW_SLOTS", "display", slot, s.xml, s.options ?? {}]);
  }
  const model = (state.slots.POPUP && state.models.POPUP) || state.models.MAIN || state.models.POPOVER;
  return {
    S_FRONT: { ID: state.id, APP: state.app, S_ACTION: { T_SYSTEM, T_CUSTOM: state.custom ?? [] } },
    MODEL: model?.data ?? {},
  };
}

// ---------------------------------------------------------- instructions

const RULES = `You are the AI Pilot of the abap2UI5 playground. A person is looking at an
abap2UI5 app running in their browser, and you operate that app for them
while they watch: they say in the chat what they want done, and you do it in
the app with your tools - the way a person would with mouse and keyboard.
Every act you take happens in the app on their screen: fields fill, buttons
are pressed, popups open, tables grow.

How you see the app: every tool answers with an AGENT SNAPSHOT of the screen,
JSON:
- app, title, layer ("main", "popup" or "popover" - the topmost layer; while
  a popup is open only the popup can be operated, as in the browser).
- fields: the inputs - id (f1…), path (/NAME), name, label, kind (text,
  number, boolean, date, choice, multichoice…), value, editable, values (the
  allowed keys of a choice), required.
- actions: what can be fired - id (a1…), event (the name the app handles),
  label, control, enabled, scope ("screen" or "row" with its table), args.
- tables: id (t1…), path, columns, rowCount, rows (the first ones),
  editableCells, selectionField.
- messages: what the app said - toasts, message boxes, message strips; this
  is the app's answer to your last act.
- texts: static text on the screen; unsupported: what the snapshot cannot
  describe.
- pending: values you typed that no event has sent yet.
Ids are valid for ONE snapshot only - always take them from the latest one.

How you act (the act tool):
- values: { "<field id, path or name>": value } - table cells as
  "<table path or id>/<row>/<COLUMN>", e.g. "/T_TAB/2/SELKZ" to tick row 2.
- event: the action to fire, by event name or id ("a3").
- Put the values and the event that should send them into ONE act: the
  person sees you type the values, then press the button.
- row: for a row action (a button in a table row) the row index, 0-based; on
  a selection dialog's confirm action, the row to pick.
- args: only when an action's args say the client cannot fill them.
- Events named "@CLOSE_POPUP" / "@CLOSE_POPOVER" close a dialog in the
  browser without a roundtrip.
- An act that is not possible (an event not on the screen, a field that is
  not editable, a value outside a choice) is refused with what IS possible -
  nothing was done then; correct it and act again.

Working with the person:
- You already get the current screen with every message when it changed;
  call look only when you need it again (e.g. more table rows: max_rows).
- Do what was asked, step by step, and read each snapshot before the next
  step - a message box or an error message is the app talking to you.
- The person can use the app themselves at any time. When they did, the
  next message says so and carries the new screen; continue from there.
- This is a sandbox: the app runs in the browser on an in-memory database
  that every restart_app empties; nothing reaches an SAP system. Still, do
  what was asked and nothing more - ask before deleting what the person did
  not name.
- If the app cannot do what was asked, say so plainly; read_source shows its
  ABAP when you need to understand what an event does.
- Other apps: find_apps searches the sample catalogue, open_app opens one in
  place of the app on screen. Only open another app when the person asks for
  it or clearly wants something this app does not do.
- Answer in the language the person writes in. Keep it short: what you did,
  and what the app answered.`;

const SYSTEM = [{ type: "text", text: RULES, cache_control: { type: "ephemeral" } }];

const TOOLS = [
  {
    name: "look",
    description: "The screen of the app as it is now - the agent snapshot. Pass max_rows for more table rows (default 20, max 200).",
    input_schema: { type: "object", properties: { max_rows: { type: "number" } } },
  },
  {
    name: "act",
    description:
      "Operate the app on the person's screen: type `values` into fields and fire `event`, then get the new snapshot. " +
      "values: { \"<field id | path | name>\": value } (table cells \"<table path or id>/<row>/<COLUMN>\"); event: an " +
      "action's event name or id; row: the 0-based row of a row action, or the row a selection dialog's confirm picks; " +
      "args: positional event arguments (null = the client fills it). Without event the values are typed but not sent. " +
      "Strict: what is not on the screen is refused with the list of what is, and nothing is done.",
    input_schema: {
      type: "object",
      properties: {
        values: { type: "object", description: "{ \"<field id, path or name>\": value, \"<table path>/<row>/<COLUMN>\": value }" },
        event: { type: "string", description: "the action to fire: its event name (e.g. \"SAVE\") or its id (\"a3\")" },
        row: { type: "number", description: "for a row action: the row index (0-based) in its table" },
        args: { type: "array", description: "event arguments, positional to the action's args; null where the client fills the value" },
        max_rows: { type: "number", description: "table rows per table in the answer (default 20)" },
      },
    },
  },
  {
    name: "restart_app",
    description:
      "Start the app on screen again: a fresh database and its first screen - what Run does. Answers the new " +
      "snapshot, or why the app did not start.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "find_apps",
    description:
      "Search the abap2UI5 sample catalogue (about 770 apps) by keywords - what an app is about or a control " +
      "(table, popup, value help, form, chart). Answers matching classes that run here.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "One to three keywords" } },
      required: ["query"],
    },
  },
  {
    name: "open_app",
    description: "Open a sample class from find_apps in place of the app on screen, start it and answer its first snapshot.",
    input_schema: {
      type: "object",
      properties: { class: { type: "string", description: "The class name, e.g. z2ui5_cl_smp_app_009" } },
      required: ["class"],
    },
  },
  {
    name: "read_source",
    description: "The ABAP of the app on screen (and the classes open beside it) - to understand what an event does.",
    input_schema: { type: "object", properties: {} },
  },
];

// ---------------------------------------------------------- the operator

/*
 * The model's hands on the app: the vendored client, with the frame as its
 * transport. `host` is the page (pilot.mjs adds drive( ) to main.mjs's):
 *   host.drive(body)        one request, sent by the app frame -> { status, body }
 *   host.frame()            the frame's __z2ui5PlaygroundPilot
 *   host.run()              Run, and its report
 *   host.openFiles(files)   another app, then Run
 *   host.carried(cls)       a sample the page carries, by class
 *   host.fetchLinked(url)   a catalogued class and what it needs
 *   host.files()            the open files
 *   host.appClass()         the class Run starts
 */
export function createOperator({ host, mirror, ui = {} }) {
  // The answer the next start is given instead of being sent - see replayOf( ).
  let replay = null;
  const client = createAppClient({
    transport: async ({ method, body }) => {
      // No token layer in front of this backend: the HEAD is answered as a
      // server without one would answer it.
      if (method === "HEAD") return { status: 405, headers: {}, body: "" };
      if (replay) {
        const answer = replay;
        replay = null;
        return { status: 200, headers: {}, body: JSON.stringify(answer) };
      }
      const response = await host.drive(body);
      return { status: response.status, headers: {}, body: String(response.body ?? "") };
    },
    location: (app) => ({ origin: window.location.origin, pathname: "/", search: `?app_start=${encodeURIComponent(app)}` }),
    backendHint: "",
    maxSessions: 4,
  });
  let session = null;
  let synced = -1;

  // Until the frame has rendered what it was answered: the answer is in the
  // mirror the moment the framework gave it, the popup it opens a moment
  // later - and the reader is shown the screen the model is told about.
  async function settled() {
    const until = performance.now() + 5000;
    while (performance.now() < until) {
      let busy = false;
      try {
        busy = host.frame()?.busy() === true;
      } catch {
        busy = false;
      }
      if (!busy) return true;
      await pause(50);
    }
    return false;
  }

  // A popup or popover the reader closed in the browser, which costs no
  // roundtrip and so never reached the mirror: asked of the frame - once it
  // has settled, or a popup still being built reads as one that was closed.
  async function catchUpWithFrame() {
    if (!(await settled())) return;
    let open;
    try {
      open = host.frame()?.slots();
    } catch {
      open = null;
    }
    if (!Array.isArray(open)) return;
    for (const slot of ["POPUP", "POPOVER"]) {
      if (mirror.state.slots[slot] && !open.includes(slot)) mirror.closeSlot(slot);
    }
  }

  // The session the model acts through, on the screen as it is now.
  async function current() {
    await catchUpWithFrame();
    if (session && synced === mirror.version) return session;
    if (!mirror.state.id) {
      throw new AgentError(`no app is running on screen${mirror.error ? ` - the last answer was ${mirror.error}` : ""} - restart_app starts it again`);
    }
    replay = replayOf(mirror.state);
    try {
      session = (await client.start(mirror.state.app || host.appClass(), { maxRows: MAX_ROWS })).session;
    } finally {
      replay = null;
    }
    synced = mirror.version;
    return session;
  }

  const look = async (maxRows) => client.describe(await current(), { maxRows: maxRows ?? MAX_ROWS });

  // What the bar over the app says while the model acts: the field's label
  // and the action's, read off the snapshot it acted on.
  function fieldLabel(snapshot, key) {
    const f = snapshot.fields.find((x) => x.id === key || x.path === key || x.name?.toUpperCase() === String(key).toUpperCase());
    return f?.label ?? key;
  }
  function actionOf(snapshot, event) {
    return snapshot.actions.find((a) => a.id === event || a.event === event);
  }

  // The typed values into the frame's model as well, so the reader sees them
  // arrive in the fields - and a click of their own carries them on, as
  // typing would have.
  function typeIntoFrame(snapshot, values) {
    const api = host.frame();
    if (!api || !values) return;
    const screen = client.screen(snapshot.session);
    for (const path of snapshot.pending ?? []) {
      const field = snapshot.fields.find((f) => f.path === path);
      const table = field ? null : snapshot.tables.find((t) => path.startsWith(`${t.path}/`));
      const layer = (field ?? table)?.layer ?? "main";
      const slot = layer === "popup" ? "POPUP" : layer === "popover" ? "POPOVER" : "MAIN";
      const model = screen.models[modelKeyOf(slot)];
      if (!model) continue;
      try {
        api.fill(slot, path, getAt(model.data, path));
      } catch {
        // a field the frame cannot be told about still holds the value in
        // the session, and goes out with the event
      }
    }
  }

  async function act({ values, event, row, args, maxRows }) {
    const id = await current();
    const before = client.describe(id, { maxRows });
    const hasValues = values && typeof values === "object" && Object.keys(values).length > 0;
    const hasEvent = event !== undefined && event !== null && event !== "";
    // Typed first, pressed after: the values go into the session as pending
    // edits and into the frame's fields, and the event carries them - the
    // same request one act with both would send, in two steps the reader can
    // follow.
    if (hasValues) {
      ui.acting?.(`typing ${Object.keys(values).map((k) => fieldLabel(before, k)).slice(0, 3).join(", ")}`);
      const typed = await client.act(id, { values, maxRows });
      typeIntoFrame(typed, values);
      if (!hasEvent) return typed;
      await pause(450);
    }
    const action = actionOf(before, String(event));
    ui.acting?.(`pressing ${action ? `"${action.label}"` : event}`);
    const frontendSlot = action && Object.entries(FRONTEND_EVENTS).find(([, name]) => name === action.event)?.[0];
    const versionBefore = mirror.version;
    const answered = await client.act(id, { event, row, args, maxRows });
    if (frontendSlot) {
      // Closed in the session without a roundtrip; the frame closes it the
      // way its own button would, and the mirror follows.
      host.frame()?.frontend(["CONTROL_GLOBAL", "VIEW_SLOTS", "destroy", frontendSlot]);
      mirror.closeSlot(frontendSlot);
      synced = mirror.version;
      return answered;
    }
    if (mirror.version === versionBefore) return answered;
    // The answer went through the frame and into the mirror: described from
    // there, which is the screen the reader is looking at.
    return look(maxRows);
  }

  async function restart() {
    const report = await host.run();
    if (!report.started) return { started: false, report };
    return { started: true, report, snapshot: mirror.state.id ? await look() : null };
  }

  return { look, act, restart };
}

// ------------------------------------------------------- the conversation

/**
 * One conversation. `ui` is what the chat draws (pilot.mjs): the same calls
 * the AI Studio's chat answers, plus acting(text) for the bar over the app.
 */
export function createPilot({ apiKey, workspace, host, mirror, ui, speed = () => DEFAULT_SPEED }) {
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  const operator = createOperator({ host, mirror, ui });
  // Append-only, as in the studio: thinking blocks are bound to the history
  // they were written in.
  const messages = [];
  // The mirror's version the model was last told about - by a tool's answer
  // or by the screen sent with a message.
  let told = -1;
  let stream;
  let stopped = false;
  const total = { input: 0, output: 0, cached: 0 };

  const snapshotText = (snapshot) => clip(JSON.stringify(snapshot));

  async function send(text) {
    stopped = false;
    const content = [];
    if (mirror.version !== told) {
      const first = told === -1;
      let screen;
      try {
        screen = snapshotText(await operator.look());
      } catch (e) {
        screen = String(e?.message ?? e);
      }
      content.push({
        type: "text",
        text: first
          ? `<screen>\nThe app on the person's screen right now:\n${screen}\n</screen>`
          : `<screen>\nThe screen changed since your last step - the person used the app themselves, or it was restarted. Now:\n${screen}\n</screen>`,
      });
      told = mirror.version;
    }
    content.push({ type: "text", text });
    messages.push({ role: "user", content });
    await loop();
    return { stopped };
  }

  async function loop() {
    let jsonRetries = 0;
    let cuts = 0;
    while (!stopped) {
      ui.assistantStart();
      const settings = SPEEDS[speed()] ?? SPEEDS[DEFAULT_SPEED];
      stream = client.beta.messages.stream({
        model: settings.model,
        max_tokens: 16000,
        system: SYSTEM,
        tools: TOOLS,
        messages,
        output_config: { effort: settings.effort },
        thinking: { type: "adaptive", display: "updates" },
        betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
      });
      stream.on("text", (delta) => ui.text(delta));
      let streaming;
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          streaming = block.type === "tool_use" ? { id: block.id, name: block.name } : undefined;
          if (block.type === "thinking") ui.thinkingStart();
          if (streaming) ui.toolPending({ id: block.id, text: pendingText(block.name, {}) });
        } else if (event.type === "content_block_delta" && event.delta.type === "thinking_delta" && event.delta.thinking) {
          ui.thinking(event.delta.thinking);
        }
      });
      stream.on("inputJson", (_partial, input) => {
        if (streaming) ui.toolPending({ id: streaming.id, text: pendingText(streaming.name, input ?? {}) });
      });

      let message;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        stream.abort();
        if (stopped) return;
        if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIUserAbortError || jsonRetries++ >= 2) throw err;
        continue;
      }

      const usage = message.usage ?? {};
      total.input += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      total.cached += usage.cache_read_input_tokens ?? 0;
      total.output += usage.output_tokens ?? 0;
      ui.usage({ ...total });

      if (message.stop_reason === "refusal") {
        for (const u of message.content.filter((b) => b.type === "tool_use")) {
          ui.tool({ id: u.id, summary: `not run: ${u.name}`, error: true });
        }
        messages.push({ role: "assistant", content: [{ type: "text", text: "(The request was declined.)" }] });
        ui.notice("The model declined this request.");
        return;
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      const uses = message.content.filter((b) => b.type === "tool_use");
      const full = message.stop_reason === "model_context_window_exceeded";
      const cut = message.stop_reason === "max_tokens" || full;
      messages.push({ role: "assistant", content: message.content });
      if (uses.length === 0) {
        if (full) ui.notice("The conversation has filled the model's context - New chat starts a fresh one.");
        else if (cut) ui.notice("The answer was cut off - it ran out of room.");
        return;
      }
      if (cut) {
        // An act cut off half way could be a shorter, valid act - one value
        // fewer. Never run it.
        messages.push({
          role: "user",
          content: uses.map((u) => {
            ui.tool({ id: u.id, summary: `not run: ${u.name} (cut off)`, error: true });
            return { type: "tool_result", tool_use_id: u.id, is_error: true, content: "Not run: the answer was cut off and this input may be incomplete." };
          }),
        });
        if (full || ++cuts >= 2) {
          ui.notice(full ? "The conversation has filled the model's context - New chat starts a fresh one." : "The answer ran out of room twice in a row - ask for a smaller step, or New chat.");
          return;
        }
        continue;
      }
      cuts = 0;

      const results = [];
      for (const use of uses) {
        if (stopped) {
          ui.tool({ id: use.id, summary: `not run: ${use.name} (stopped)`, error: true });
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Stopped by the person." });
          continue;
        }
        ui.toolPending({ id: use.id, text: pendingText(use.name, use.input ?? {}) });
        let result;
        try {
          result = await execute(use.name, use.input ?? {});
        } catch (e) {
          result = { error: String(e?.message ?? e) };
        }
        ui.tool({ id: use.id, summary: result.summary ?? result.error ?? "", error: Boolean(result.error) });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          ...(result.error ? { is_error: true } : {}),
          content: clip(result.error ?? result.text),
        });
      }
      // Whatever the tools did to the screen, the model has just read.
      told = mirror.version;
      messages.push({ role: "user", content: results });
    }
  }

  async function execute(name, input) {
    switch (name) {
      case "look": {
        const snapshot = await operator.look(num(input.max_rows));
        return { text: snapshotText(snapshot), summary: `looked at ${snapshot.title || snapshot.app}` };
      }
      case "act": return act(input);
      case "restart_app": {
        ui.acting?.("restarting the app");
        const { started, report, snapshot } = await operator.restart();
        if (!started) {
          const errors = (report.problems ?? []).filter((p) => p.severity === 1).slice(0, 10);
          return {
            error: `The app did not start: ${report.status}${errors.length ? `\n${errors.map((p) => `- ${p.file}:${(p.range?.start?.line ?? 0) + 1} ${p.message}`).join("\n")}` : ""}`,
          };
        }
        return { text: snapshot ? snapshotText(snapshot) : `started: ${report.status}`, summary: "restarted the app" };
      }
      case "find_apps": return findApps(input);
      case "open_app": return openApp(input);
      case "read_source": {
        const files = host.files();
        return {
          text: files.map((f, i) => `=== ${f.name}${i === 0 ? " (the app)" : ""} ===\n${f.source}`).join("\n\n"),
          summary: `read ${files[0]?.name ?? "the source"}`,
        };
      }
      default: return { error: `There is no tool called ${name}.` };
    }
  }

  async function act(input) {
    const values = input.values && typeof input.values === "object" && !Array.isArray(input.values) ? input.values : undefined;
    const event = str(input.event);
    if (!values && !event) return { error: "act needs values, an event, or both." };
    try {
      const snapshot = await operator.act({
        values,
        event,
        row: num(input.row),
        args: Array.isArray(input.args) ? input.args : undefined,
        maxRows: num(input.max_rows),
      });
      const what = [
        values ? `typed ${Object.keys(values).length} value${Object.keys(values).length === 1 ? "" : "s"}` : "",
        event ? `pressed ${event}` : "",
      ].filter(Boolean).join(", ");
      // What the app SAID in answer - a toast, a message box, a field's
      // error - not the strips that stand on the screen anyway.
      const said = (snapshot.messages ?? []).filter((m) => m.source !== "strip" && m.text).map((m) => m.text)[0];
      return { text: snapshotText(snapshot), summary: `${what}${said ? ` → "${String(said).slice(0, 60)}"` : ""}` };
    } catch (e) {
      // A refusal of the client names what is possible; the screen goes
      // with it, so the next act needs no look first.
      let screen = "";
      try {
        screen = `\n\nThe screen now:\n${snapshotText(await operator.look())}`;
      } catch {
        screen = "";
      }
      return { error: `${String(e?.message ?? e)}${screen}` };
    }
  }

  async function findApps(input) {
    const query = str(input.query)?.trim().toLowerCase();
    if (!query) return { error: "find_apps needs a query." };
    const words = query.split(/\s+/).filter(Boolean);
    const scored = (await catalogueEntries())
      .filter((e) => e.runs)
      .map((e) => ({ e, score: words.reduce((n, w) => n + (e.haystack.includes(w) ? 1 : 0), 0) }))
      .filter((s) => s.score >= Math.max(1, words.length))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    if (scored.length === 0) return { text: `No app that runs here matches "${query}". Try one word.`, summary: `found nothing for "${query}"` };
    return {
      text: scored.map(({ e }) => `${e.class} - ${e.title}${e.summary ? `: ${e.summary}` : ""}`).join("\n"),
      summary: `found apps for "${query}"`,
    };
  }

  async function openApp(input) {
    const cls = str(input.class)?.trim().toLowerCase();
    if (!cls) return { error: "open_app needs a class." };
    let files = host.carried(cls);
    if (!files) {
      const entry = (await catalogueEntries()).find((e) => e.class === cls);
      if (!entry) return { error: `${cls} is not in the sample catalogue - find_apps first.` };
      if (!entry.runs) return { error: `${cls} does not run in the playground (it needs a system or a library this page has not got).` };
      files = await host.fetchLinked(entry.raw);
    }
    ui.acting?.(`opening ${cls.toUpperCase()}`);
    const report = await host.openFiles(files);
    if (!report.started) return { error: `${cls} did not start: ${report.status}` };
    const snapshot = await operator.look();
    return { text: snapshotText(snapshot), summary: `opened ${cls.toUpperCase()}` };
  }

  return {
    send,
    stop() {
      stopped = true;
      stream?.abort();
    },
  };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// What a tool call is doing while it is under way.
export function pendingText(name, input) {
  switch (name) {
    case "look": return "looking at the screen…";
    case "act": {
      const event = str(input.event);
      const keys = input.values && typeof input.values === "object" ? Object.keys(input.values) : [];
      if (event && keys.length) return `typing ${keys.length} value${keys.length === 1 ? "" : "s"}, then ${event}…`;
      if (event) return `pressing ${event}…`;
      return keys.length ? `typing ${keys.join(", ")}…` : "acting…";
    }
    case "restart_app": return "restarting the app…";
    case "find_apps": return `looking for apps${str(input.query) ? ` about "${input.query}"` : ""}…`;
    case "open_app": return `opening ${str(input.class) ?? "an app"}…`;
    case "read_source": return "reading the ABAP…";
    default: return `${name}…`;
  }
}
