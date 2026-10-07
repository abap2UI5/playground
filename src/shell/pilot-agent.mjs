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
import { addUsage, catalogueEntries, DEFAULT_SPEED, followStream, rankEntries, SPEEDS } from "./ai-common.mjs";
import { attachmentBlocks } from "./attachments.mjs";

export { explainError } from "./ai-common.mjs";
export { kindOf, MAX_FILES, MAX_MESSAGE_BYTES } from "./attachments.mjs";

const SLOTS = ["MAIN", "NEST", "NEST2", "POPUP", "POPOVER"];
const MAX_ROWS = 20;
const MAX_TOOL_TEXT = 30000;
const clip = (text, max = MAX_TOOL_TEXT) =>
  text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters cut)`;
const str = (v) => (typeof v === "string" ? v : undefined);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// An argument as an error or a chat row repeats it: at most 80 characters.
const echo = (v) => {
  const t = String(v);
  return t.length > 80 ? `${t.slice(0, 80)}...` : t;
};
// A dump of the reader's click as the model is told it.
const MAX_ERROR_TEXT = 2000;
// What all the screens one message carries may take together.
const MAX_SCREENS_TEXT = 60000;
const VALUE_CAP = 2000;

/*
 * A snapshot that fits `budget` characters of JSON - clip( ) cut it mid-JSON
 * at 30,000: a 120 KB TextArea pushed out every action after it, a table of
 * wide rows the app's answer (the messages come last), and the model read
 * neither. Long values are cut and made read-only (an edit of the shown part
 * would replace the whole value), then rows go from the end of the largest
 * table; the JSON stays whole and `cut` says what is missing. As
 * mcp-server's fitSnapshot (lib/budget.mjs).
 */
export function fitSnapshot(snap, budget) {
  if (!snap || typeof snap !== "object" || JSON.stringify(snap).length <= budget) return snap;
  const out = JSON.parse(JSON.stringify(snap));
  const notes = [];
  const cut = (v) => (typeof v === "string" && v.length > VALUE_CAP ? `${v.slice(0, VALUE_CAP)}...` : v);
  const fields = [];
  for (const f of out.fields ?? []) {
    const v = cut(f.value);
    if (v !== f.value) {
      f.value = v;
      f.editable = false;
      fields.push(f.id);
    }
  }
  if (fields.length) notes.push(`the values of ${fields.join(", ")} are cut to ${VALUE_CAP} characters and read-only here`);
  for (const t of out.tables ?? []) {
    const cols = new Set();
    for (const r of t.rows ?? []) {
      for (const [k, v] of Object.entries(r)) {
        const c = cut(v);
        if (c !== v) {
          r[k] = c;
          cols.add(k);
        }
      }
    }
    if (cols.size) {
      t.editableCells = (t.editableCells ?? []).filter((c) => !cols.has(c));
      notes.push(`table ${t.id}: cells of ${[...cols].join(", ")} are cut to ${VALUE_CAP} characters and not editable here`);
    }
  }
  const shortened = new Map();
  while (JSON.stringify(out).length > budget) {
    const big = (out.tables ?? []).filter((t) => t.rows && t.rows.length > 1)
      .sort((a, b) => JSON.stringify(b.rows).length - JSON.stringify(a.rows).length)[0];
    if (!big) break;
    big.rows = big.rows.slice(0, Math.max(1, Math.floor(big.rows.length / 2)));
    big.truncated = true;
    shortened.set(big.id, big.rows.length);
  }
  for (const [id, n] of shortened) notes.push(`table ${id} shows its first ${n} row(s) - look with a smaller max_rows`);
  return notes.length ? { ...out, cut: notes } : out;
}

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
      // What the request carried is in the client's model before the answer
      // comes - typed by the reader, or by the Pilot. An answer without a
      // MODEL ("nothing bound changed") keeps it, as the frontend keeps what
      // was typed; folded only from the answer, those values were lost.
      if (request?.value?.MODEL && mirror.state.id) mirror.state = withDelta(mirror.state, request.value.MODEL);
      if (!(response.status >= 200 && response.status < 300)) {
        mirror.error = clip(`HTTP ${response.status}: ${String(response.body ?? "").split("\n").slice(0, 6).join("\n")}`, MAX_ERROR_TEXT);
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

/*
 * A request's model delta (core/Lib.js buildDeltaFromPaths: a top-level
 * attribute whole, a table's cells as { T_TAB: { __delta: { <row>: {…} } } },
 * nested tables the same way) applied to the model it was sent from - the
 * popup's while one is open, else the page's.
 */
function withDelta(state, delta) {
  const key = state.slots.POPUP && state.models.POPUP ? "POPUP" : "MAIN";
  const model = state.models[key];
  if (!model) return state;
  const data = JSON.parse(JSON.stringify(model.data ?? {}));
  const merge = (target, patch) => {
    for (const [name, value] of Object.entries(patch)) {
      if (value && typeof value === "object" && !Array.isArray(value) && value.__delta) {
        if (!Array.isArray(target[name])) continue;
        for (const [row, cells] of Object.entries(value.__delta)) {
          if (target[name][row] && typeof target[name][row] === "object") merge(target[name][row], cells);
        }
      } else {
        target[name] = JSON.parse(JSON.stringify(value));
      }
    }
  };
  merge(data, delta);
  return { ...state, models: { ...state.models, [key]: { ...model, data } } };
}

/** The agent snapshot of the mirror: what the "What Claude sees" panel shows.
 *  `typed` is the reader's unsent typing (the bridge's pending( )), which the
 *  model's own snapshot carries too (current( ) in createOperator). */
export function describeMirror(mirror, maxRows = MAX_ROWS, typed = {}) {
  if (!mirror.state.id) return { note: "no app is running" };
  const snapshot = analyzeScreen({ state: mirror.state, session: mirror.state.id, maxRows }).snapshot;
  const paths = Object.keys(typed);
  if (paths.length === 0) return snapshot;
  return {
    ...snapshot,
    fields: snapshot.fields.map((f) => (f.path in typed ? { ...f, value: typed[f.path] } : f)),
    pending: paths,
  };
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
- Several apps: the stage holds up to four, one tab each, numbered 1 to 4;
  every snapshot says its "tab". look and act take app (a tab number or a
  class) and default to the app on screen; acting on another brings it on
  screen. find_apps searches the sample catalogue; open_app opens an app in
  place of one, or with beside: true next to the others - use that when the
  person wants to work with two apps at once (read in one, enter in the
  other). The apps share one database, and restart_app restarts all of them.
  Only open apps the person asks for or clearly needs.
- The person may attach files to a message - a PDF, a spreadsheet (each
  sheet comes as CSV), a Word document, an image, a text file. Treat them as
  the material to work from: the orders to enter, the values to check, the
  form to fill. Work through a list row by row, say how far you got, and
  never invent a value a file does not have.
- Answer in the language the person writes in. Keep it short: what you did,
  and what the app answered.`;

const SYSTEM = [{ type: "text", text: RULES, cache_control: { type: "ephemeral" } }];

const TOOLS = [
  {
    name: "look",
    description: "The screen of the app as it is now - the agent snapshot. Pass max_rows for more table rows (default 20, max 200).",
    input_schema: {
      type: "object",
      properties: {
        app: { type: "string", description: "which app: its tab number (\"2\") or its class; default the app on screen" },
        max_rows: { type: "number" },
      },
    },
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
        app: { type: "string", description: "which app: its tab number (\"2\") or its class; default the app on screen" },
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
      "Start the apps again: a fresh database - shared by all open apps - and each app's first screen, what Run " +
      "does. Answers the snapshot of the app on screen, or why the apps did not start.",
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
    description:
      "Open a sample class from find_apps and answer its first snapshot - in place of an app (default: the one on " +
      "screen), or with beside: true in a tab of its own next to the open apps (at most 4). The apps share one " +
      "database; opening one keeps the others as they are.",
    input_schema: {
      type: "object",
      properties: {
        class: { type: "string", description: "The class name, e.g. z2ui5_cl_smp_app_009" },
        beside: { type: "boolean", description: "open it in a new tab beside the open apps" },
        app: { type: "string", description: "without beside: the app to replace (tab number or class)" },
      },
      required: ["class"],
    },
  },
  {
    name: "show_app",
    description: "Bring an open app onto the screen (its tab), e.g. before you explain something in it.",
    input_schema: {
      type: "object",
      properties: { app: { type: "string", description: "tab number or class" } },
      required: ["app"],
    },
  },
  {
    name: "close_app",
    description: "Close an app's tab. The first app cannot be closed.",
    input_schema: {
      type: "object",
      properties: { app: { type: "string", description: "tab number or class" } },
      required: ["app"],
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
 * transport. One operator per app on the stage; `app` is that app's tab
 * (pilot.mjs, the apps( ) of its host):
 *   app.drive(body)   one request, sent by the app's frame -> { status, body }
 *   app.frame()       the frame's __z2ui5PlaygroundPilot
 *   app.cls           the class the tab was opened on
 */
export function createOperator({ app, mirror, ui = {}, halted = () => false }) {
  const host = { drive: (body) => app.drive(body), frame: () => app.frame(), appClass: () => app.cls };
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
  // The reader's unsent typing the session was built with (see current( )).
  let typedKey = "{}";

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

  // The session the model acts through, on the screen as it is now - with
  // what the reader typed and has not sent yet. Typing costs no roundtrip,
  // so the mirror never hears of it: the model read the field as empty, and
  // its event went out without the value while the frame went on showing it.
  async function current() {
    await catchUpWithFrame();
    let typed = {};
    try {
      typed = host.frame()?.pending?.() ?? {};
    } catch {
      typed = {};
    }
    const key = JSON.stringify(typed);
    if (session && synced === mirror.version && key === typedKey) return session;
    if (!mirror.state.id) {
      throw new AgentError(`no app is running on screen${mirror.error ? ` - the last answer was ${mirror.error}` : ""} - restart_app starts it again`);
    }
    const app = mirror.state.app || host.appClass();
    const start = async (values) => {
      replay = replayOf(mirror.state);
      try {
        return (await client.start(app, { maxRows: MAX_ROWS, ...(values ? { values } : {}) })).session;
      } finally {
        replay = null;
      }
    };
    // What the session took goes out with the Pilot's next request, so the
    // frame clears exactly those once it is answered (carry on the bridge).
    let taken = Object.keys(typed);
    try {
      session = await start(taken.length > 0 ? typed : undefined);
    } catch (e) {
      // A value the snapshot does not take (a path no control shows as
      // editable, text in a number field): the others one by one, rather
      // than no screen at all.
      if (!(e instanceof AgentError) || taken.length === 0) throw e;
      session = await start();
      taken = [];
      for (const [path, value] of Object.entries(typed)) {
        try {
          await client.act(session, { values: { [path]: value } });
          taken.push(path);
        } catch {
          // left to the frame, which still shows and holds it - pending,
          // for the reader's own next click
        }
      }
    }
    if (taken.length > 0) {
      try {
        host.frame()?.carry?.(taken);
      } catch {
        // an older frame: its own next roundtrip sends them
      }
    }
    synced = mirror.version;
    typedKey = key;
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
    // Refused as a whole when the event is not there to press: typed first,
    // the values were in the fields and pending before the refusal said
    // "nothing was done". One act validates the event before any value.
    const pressable = hasEvent ? actionOf(before, String(event)) : undefined;
    if (hasValues && hasEvent && (!pressable || pressable.enabled === false)) {
      return client.act(id, { values, event, row, args, maxRows });
    }
    if (hasValues) {
      ui.acting?.(`typing ${Object.keys(values).map((k) => fieldLabel(before, k)).slice(0, 3).join(", ")}`);
      const typed = await client.act(id, { values, maxRows });
      typeIntoFrame(typed, values);
      // What is pending now is what the frame holds: the next current( )
      // is not to take the Pilot's own typing for the reader's.
      try {
        typedKey = JSON.stringify(host.frame()?.pending?.() ?? {});
      } catch {
        typedKey = "{}";
      }
      if (!hasEvent) return typed;
      const typedAt = mirror.version;
      await pause(450);
      // Stop pressed while the values went in: the press does not follow.
      if (halted()) throw new AgentError("stopped by the person before the press - the values are typed, nothing was sent");
      // A click of the reader's meanwhile: the press would go out on the
      // screen before it.
      if (mirror.version !== typedAt) throw new AgentError("the screen changed while the values went in (the person used the app) - nothing was pressed");
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

  return { look, act };
}

// ------------------------------------------------------- the conversation

/**
 * One conversation. `ui` is what the chat draws (pilot.mjs): the same calls
 * the AI Studio's chat answers, plus acting(text) for the bar over the app.
 */
/*
 * `host` is the page (pilot.mjs):
 *   host.apps()                       the apps on the stage: { id, visible, mirror, cls, frame( ), drive( ) }
 *   host.show(id)                     brings an app's tab forward
 *   host.openApp(files, { beside, tab })  an app in a tab, or in a new one beside
 *   host.closeApp(id)                 closes a tab (not the first)
 *   host.run()                        Run: every app again, on a fresh database
 *   host.carried(cls), host.fetchLinked(url), host.files()
 */
export function createPilot({ apiKey, workspace, host, ui, speed = () => DEFAULT_SPEED }) {
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  // One operator per app, made the first time the model reaches for it and
  // made again for a tab that was closed and whose number came back.
  const operators = new Map();
  // A closed tab's operator held its mirror and the client's copies of the
  // screen for the rest of the chat: tab numbers never come back.
  function prune() {
    const open = new Set(host.apps().map((a) => a.id));
    for (const id of operators.keys()) if (!open.has(id)) operators.delete(id);
    for (const id of told.keys()) if (!open.has(id)) told.delete(id);
  }
  function operatorOf(app) {
    prune();
    const known = operators.get(app.id);
    if (known && known.mirror === app.mirror) return known.operator;
    const operator = createOperator({ app, mirror: app.mirror, ui, halted: () => stopped });
    operators.set(app.id, { mirror: app.mirror, operator });
    return operator;
  }
  // The app a tool means: a tab number, or the class an open tab runs;
  // without one, the app on screen. Acting on another brings it forward, so
  // the reader sees what is being done.
  function appOf(ref) {
    const apps = host.apps();
    if (ref === undefined || ref === null || ref === "") return apps.find((a) => a.visible) ?? apps[0];
    const key = String(ref).trim();
    const app = apps.find((a) => a.id === key)
      ?? apps.find((a) => (a.mirror?.state.app || a.cls || "").toUpperCase() === key.toUpperCase());
    if (!app) throw new AgentError(`there is no app ${echo(key)} - open apps: ${appList()}`);
    return app;
  }
  const appList = () =>
    host.apps().map((a) => `${a.id} ${a.mirror?.state.app || a.cls?.toUpperCase()}${a.visible ? " (on screen)" : ""}`).join(", ");
  // Append-only, as in the studio: thinking blocks are bound to the history
  // they were written in.
  const messages = [];
  // Each app's mirror version the model was last told about - by a tool's
  // answer or by the screen sent with a message.
  const told = new Map();
  // What the model is told about an app: its mirror, and the reader's typing
  // the mirror never hears of (no roundtrip).
  const stateOf = (a) => {
    let typed = "";
    try {
      typed = JSON.stringify(a.frame?.()?.pending?.() ?? {});
    } catch {
      typed = "";
    }
    return `${a.mirror?.version}|${typed}`;
  };
  const tellAll = () => {
    for (const a of host.apps()) told.set(a.id, stateOf(a));
  };
  let stream;
  let stopped = false;
  let shownAt = new Map();
  // Resolved by stop( ): a tool still running (an app that will not render,
  // a fetch) is no longer waited for - Stop used to change nothing until it
  // ended on its own, up to half a minute later.
  let stopping;
  let stopNow = () => {};
  const total = { input: 0, output: 0, cached: 0 };

  // A snapshot as the model reads it, with the tab it belongs to - and a
  // failed last answer (a dump of the reader's click), which the snapshot
  // of the screen before it does not show. Whatever is read here is what
  // the model has been told of that app.
  const snapshotText = (app, snapshot, budget = MAX_TOOL_TEXT) => {
    told.set(app.id, stateOf(app));
    const error = app.mirror?.error;
    // the dump after the screen, and the screen fitted to what is left
    const fitted = fitSnapshot(snapshot, budget - (error ? error.length : 0) - 200);
    return clip(JSON.stringify({ tab: app.id, ...fitted, ...(error ? { lastAnswer: error } : {}) }), budget);
  };

  // `files` are the File objects the reader added to this message; they go in
  // front of its text, as the content blocks attachments.mjs makes of them.
  async function send(text, files = []) {
    stopped = false;
    stopping = new Promise((resolve) => {
      stopNow = resolve;
    });
    const content = [];
    const toldBefore = new Map(told);
    const first = told.size === 0;
    const changed = host.apps().filter((a) => told.get(a.id) !== stateOf(a));
    if (changed.length > 0) {
      const screens = [];
      // four changed apps were four screens of 30,000 characters each
      const each = Math.min(MAX_TOOL_TEXT, Math.floor(MAX_SCREENS_TEXT / changed.length));
      for (const app of changed) {
        try {
          screens.push(snapshotText(app, await operatorOf(app).look(), each));
        } catch (e) {
          screens.push(`tab ${app.id}: ${String(e?.message ?? e)}`);
        }
      }
      content.push({
        type: "text",
        text:
          `<screen>\nOpen apps: ${appList()}.\n` +
          (first
            ? "The screen right now:\n"
            : "Changed since your last step - the person used the app themselves, or it was restarted or opened:\n") +
          `${screens.join("\n")}\n</screen>`,
      });
      tellAll();
    }
    if (files.length > 0) {
      const { blocks, errors } = await attachmentBlocks(files);
      for (const error of errors) ui.notice(error);
      content.push(...blocks);
    }
    content.push({ type: "text", text });
    messages.push({ role: "user", content });
    const at = messages.length;
    try {
      await loop();
    } catch (err) {
      // A message nothing was answered to is taken back out, and the
      // screens it carried are told again with the next one. Refused as it
      // stands (an attachment past its limits, a request too large), it was
      // refused again on every request that resent it - every later
      // message, "hello" included, the same 400 until New chat; failed
      // otherwise (a refused key, a dropped connection), "send again" sent
      // it twice, attachments and all. A message the reader stopped stays.
      if (messages.length === at && !(err instanceof Anthropic.APIUserAbortError)) {
        messages.pop();
        told.clear();
        for (const [id, version] of toldBefore) told.set(id, version);
      }
      throw err;
    }
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
      const started = followStream(stream, ui, pendingText);

      let message;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        stream.abort();
        // Billed all the same - the input from the moment it started.
        addUsage(total, stream.currentMessage?.usage);
        ui.usage({ ...total });
        if (stopped) return;
        // Only a tool input that could not be parsed is asked for again, as
        // in the studio (ai-agent.mjs): a stream whose connection dropped half
        // way is a plain AnthropicError too, and was sent again twice - three
        // billed requests, attachments and all, and three half answers.
        const unparsable = /Unable to parse tool parameter JSON/.test(String(err?.message ?? ""));
        if (!unparsable || err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        // The rows of the attempt thrown away - asked again, the calls come
        // back under new ids (as in the studio).
        for (const s of started) ui.tool({ id: s.id, summary: `${s.name}: the input was unreadable - asked again`, error: true });
        continue;
      }

      addUsage(total, message.usage);
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
      // The screens the model wrote this batch for: an event is pressed only
      // on the screen it saw. Two "act a1" in one answer pressed NEXT and
      // then whatever a1 was on the next screen (DELETE_ALL); a click of
      // the reader's while the model thought did the same.
      shownAt = new Map([...told].map(([id, state]) => [id, state.split("|")[0]]));
      for (const use of uses) {
        if (stopped) {
          ui.tool({ id: use.id, summary: `not run: ${use.name} (stopped)`, error: true });
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Stopped by the person." });
          continue;
        }
        ui.toolPending({ id: use.id, text: pendingText(use.name, use.input ?? {}) });
        let result;
        const work = execute(use.name, use.input ?? {});
        try {
          result = await Promise.race([
            work,
            stopping.then(() => ({ stoppedWhileRunning: true, error: "Stopped by the person while this was running - it may still finish on screen." })),
          ]);
        } catch (e) {
          result = { error: String(e?.message ?? e) };
        }
        if (result.stoppedWhileRunning) {
          // What it still does lands on screen after the model was told
          // "stopped" - and reading a screen marks it told: every screen
          // goes with the next message instead.
          work.catch(() => {}).finally(() => told.clear());
        }
        ui.tool({ id: use.id, summary: result.summary ?? result.error ?? "", error: Boolean(result.error) });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          ...(result.error ? { is_error: true } : {}),
          content: clip(result.error ?? result.text),
        });
      }
      // Not every screen is marked told here: a tool that read no screen
      // (read_source, find_apps) let the reader's click meanwhile pass as
      // told, and the next message carried no <screen>. snapshotText( )
      // marks each app as its screen is read.
      messages.push({ role: "user", content: results });
    }
  }

  async function execute(name, input) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return { error: `There is no tool called ${echo(name)}.` };
    /* An argument the tool does not take is refused, not dropped: act
     * { value: {...}, event } pressed without the values, and act
     * { values, evnt } typed and pressed nothing - each reported as done. */
    const known = Object.keys(tool.input_schema.properties ?? {});
    const unknown = Object.keys(input ?? {}).filter((k) => !known.includes(k));
    if (unknown.length) {
      return { error: `${name} has no argument ${unknown.map((k) => `'${echo(k)}'`).join(", ")} - ${known.length ? `its arguments: ${known.join(", ")}` : "it takes none"}. Nothing was done.` };
    }
    try {
      for (const k of ["row", "max_rows"]) if (k in input) input[k] = count(input[k], k);
      if ("beside" in input && input.beside !== undefined && typeof input.beside !== "boolean") throw new AgentError(`beside is true or false, not ${echo(JSON.stringify(input.beside))}`);
    } catch (e) {
      return { error: `${String(e?.message ?? e)}. Nothing was done.` };
    }
    switch (name) {
      case "look": {
        const app = appOf(input.app);
        const snapshot = await operatorOf(app).look(input.max_rows);
        return { text: snapshotText(app, snapshot), summary: `looked at ${snapshot.title || snapshot.app}` };
      }
      case "act": return act(input);
      case "restart_app": {
        ui.acting?.("restarting the apps");
        const report = await host.run();
        if (!report.started) {
          const errors = (report.problems ?? []).filter((p) => p.severity === 1).slice(0, 10);
          return {
            error: `The app did not start: ${report.status}${errors.length ? `\n${errors.map((p) => `- ${p.file}:${(p.range?.start?.line ?? 0) + 1} ${p.message}`).join("\n")}` : ""}`,
          };
        }
        const app = appOf(input.app);
        return { text: `Open apps: ${appList()}.\n${snapshotText(app, await operatorOf(app).look())}`, summary: "restarted the apps" };
      }
      case "find_apps": return findApps(input);
      case "open_app": return openApp(input);
      case "show_app": {
        const app = appOf(input.app);
        host.show(app.id);
        return { text: `App ${app.id} is on screen.`, summary: `showed app ${app.id}` };
      }
      case "close_app": {
        const app = appOf(input.app);
        if (app.id === "1") return { error: "The first app cannot be closed - open_app replaces it." };
        host.closeApp(app.id);
        return { text: `Closed app ${app.id}. Open apps: ${appList()}.`, summary: `closed app ${app.id}` };
      }
      case "read_source": {
        const files = host.files();
        return {
          text: files.map((f, i) => `=== ${f.name}${i === 0 ? " (the app)" : ""} ===\n${f.source}`).join("\n\n"),
          summary: `read ${files[0]?.name ?? "the source"}`,
        };
      }
      default: return { error: `There is no tool called ${echo(name)}.` };
    }
  }

  async function act(input) {
    const values = input.values && typeof input.values === "object" && !Array.isArray(input.values) ? input.values : undefined;
    const event = str(input.event);
    if (!values && !event) return { error: "act needs values, an event, or both." };
    let app;
    try {
      app = appOf(input.app);
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
    if (!app.visible) host.show(app.id);
    const operator = operatorOf(app);
    try {
      const saw = shownAt.get(app.id);
      if (event && saw !== undefined && String(app.mirror?.version) !== saw) {
        throw new AgentError(`the screen changed since you saw it (the person used the app, or an earlier step of yours changed it) - ${echo(event)} was not pressed${values ? " and nothing was typed" : ""}; act on the screen below`);
      }
      const snapshot = await operator.act({
        values,
        event,
        row: input.row,
        args: Array.isArray(input.args) ? input.args : undefined,
        maxRows: input.max_rows,
      });
      const what = [
        values ? `typed ${Object.keys(values).length} value${Object.keys(values).length === 1 ? "" : "s"}` : "",
        event ? `pressed ${echo(event)}` : "",
      ].filter(Boolean).join(", ");
      // What the app SAID in answer - a toast, a message box, a field's
      // error - not the strips that stand on the screen anyway.
      const said = (snapshot.messages ?? []).filter((m) => m.source !== "strip" && m.text).map((m) => m.text)[0];
      return { text: snapshotText(app, snapshot), summary: `${what}${said ? ` → "${String(said).slice(0, 60)}"` : ""}` };
    } catch (e) {
      // A refusal of the client names what is possible; the screen goes
      // with it, so the next act needs no look first.
      let screen = "";
      try {
        screen = `\n\nThe screen now:\n${snapshotText(app, await operator.look())}`;
      } catch {
        screen = "";
      }
      return { error: `${clip(String(e?.message ?? e), MAX_ERROR_TEXT)}${screen}` };
    }
  }

  async function findApps(input) {
    const query = str(input.query)?.trim().toLowerCase();
    if (!query) return { error: "find_apps needs a query." };
    const { hits, all } = rankEntries((await catalogueEntries()).filter((e) => e.runs), query);
    if (hits.length === 0) return { text: `No app that runs here matches any of "${echo(query)}". Try a control name or another word.`, summary: `found nothing for "${echo(query)}"` };
    return {
      text: (all ? "" : `No app has all of "${query}" - these have some of it:\n`) + hits.map((e) => `${e.class} - ${e.title}${e.summary ? `: ${e.summary}` : ""}`).join("\n"),
      summary: `found apps for "${query}"`,
    };
  }

  async function openApp(input) {
    const cls = str(input.class)?.trim().toLowerCase();
    if (!cls) return { error: "open_app needs a class." };
    let files = host.carried(cls);
    if (!files) {
      const entry = (await catalogueEntries()).find((e) => e.class === cls);
      if (!entry) return { error: `${echo(cls)} is not in the sample catalogue - find_apps first.` };
      if (!entry.runs) return { error: `${cls} does not run in the playground (it needs a system or a library this page has not got).` };
      files = await host.fetchLinked(entry.raw);
    }
    const beside = input.beside === true;
    let target;
    try {
      target = beside ? undefined : appOf(input.app).id;
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
    ui.acting?.(`opening ${cls.toUpperCase()}${beside ? " beside" : ""}`);
    const report = await host.openApp(files, { beside, tab: target });
    if (!report.started) return { error: `${cls} did not start: ${report.status}` };
    const app = appOf(report.tab);
    const snapshot = await operatorOf(app).look();
    return {
      text: `Open apps: ${appList()}.\n${snapshotText(app, snapshot)}`,
      summary: `opened ${cls.toUpperCase()}${beside ? ` beside - app ${app.id}` : ""}`,
    };
  }

  return {
    send,
    stop() {
      stopped = true;
      stopNow();
      stream?.abort();
    },
  };
}

/* row and max_rows: a whole number, or a string of digits - num( ) dropped
 * "2" without a word, and the client then asked for the row that was sent. */
function count(v, name) {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0) throw new AgentError(`${name} is a whole number, not ${echo(JSON.stringify(v))}`);
  return n;
}

// What a tool call is doing while it is under way.
export function pendingText(name, input) {
  switch (name) {
    case "look": return "looking at the screen…";
    case "act": {
      const event = str(input.event);
      const keys = input.values && typeof input.values === "object" ? Object.keys(input.values) : [];
      if (event && keys.length) return `typing ${keys.length} value${keys.length === 1 ? "" : "s"}, then ${echo(event)}…`;
      if (event) return `pressing ${echo(event)}…`;
      return keys.length ? `typing ${echo(keys.join(", "))}…` : "acting…";
    }
    case "restart_app": return "restarting the app…";
    case "find_apps": return `looking for apps${str(input.query) ? ` about "${echo(input.query)}"` : ""}…`;
    case "open_app": return `opening ${str(input.class) ?? "an app"}${input.beside === true ? " beside" : ""}…`;
    case "show_app": return `showing app ${str(input.app) ?? ""}…`;
    case "close_app": return `closing app ${str(input.app) ?? ""}…`;
    case "read_source": return "reading the ABAP…";
    default: return `${name}…`;
  }
}
