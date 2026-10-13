// Claude's eyes and hands on an app running in a frame - what the AI Pilot
// (src/shell/pilot-agent.mjs) and the AI Studio (src/shell/ai-agent.mjs)
// share: the MIRROR of the screen, folded from every answer the frame got,
// and the OPERATOR, abap2UI5/mcp-server's agent client (src/vendor/agent/,
// vendored unchanged) with the frame as its transport (src/shell/frame-drive.mjs).
//
// Two copies of the screen, kept apart on purpose. The MIRROR is the screen
// as it is: every answer the frame got, folded the way the frontend folds it
// (applyResponse) - the model's acts and the reader's own clicks alike. The
// CLIENT's session is what the model acts through; it is started from the
// mirror (a replayed answer, answered by the transport without going
// anywhere) whenever the mirror moved on, so the model always acts on the
// screen the reader is looking at, never on a copy that went stale while
// they took the controls.
import { AgentError, createAppClient } from "../vendor/agent/appclient.mjs";
import { analyzeScreen, applyResponse, emptyState, FRONTEND_EVENTS, getAt, modelKeyOf } from "../vendor/agent/snapshot.mjs";

const SLOTS = ["MAIN", "NEST", "NEST2", "POPUP", "POPOVER"];
export const MAX_ROWS = 20;
// A dump of the reader's click as the model is told it.
export const MAX_ERROR_TEXT = 2000;
export const clip = (text, max) =>
  text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters cut)`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

  return { look, act, settled };
}

