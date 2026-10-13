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
// How the model sees and moves the app - the mirror of the screen and the
// operator over the vendored client - is src/shell/ai-operator.mjs, shared
// with the AI Studio; what is here is the conversation and its tools.
import Anthropic from "@anthropic-ai/sdk";
import { AgentError } from "../vendor/agent/appclient.mjs";
import { createOperator, fitSnapshot, MAX_ERROR_TEXT } from "./ai-operator.mjs";
import { addUsage, catalogueEntries, CONTEXT_BETA, CONTEXT_MANAGEMENT, DEFAULT_SPEED, followStream, rankEntries, SPEEDS } from "./ai-common.mjs";
import { attachmentBlocks } from "./attachments.mjs";

export { explainError } from "./ai-common.mjs";
// The mirror and the fitted snapshot, for pilot.mjs and the tests - they live
// in ai-operator.mjs now, which the studio's chunk imports as well.
export { createMirror, describeMirror, fitSnapshot } from "./ai-operator.mjs";
export { kindOf, MAX_FILES, MAX_MESSAGE_BYTES } from "./attachments.mjs";

const MAX_TOOL_TEXT = 30000;
const clip = (text, max = MAX_TOOL_TEXT) =>
  text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters cut)`;
const str = (v) => (typeof v === "string" ? v : undefined);
// An argument as an error or a chat row repeats it: at most 80 characters.
const echo = (v) => {
  const t = String(v);
  return t.length > 80 ? `${t.slice(0, 80)}...` : t;
};
// What all the screens one message carries may take together.
const MAX_SCREENS_TEXT = 60000;

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
      "does. Answers the snapshot of the app on screen (or of `app`, brought on screen), or why the apps did not start.",
    input_schema: {
      type: "object",
      properties: { app: { type: "string", description: "the app to show and answer after the restart: tab number or class; default the app on screen" } },
    },
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
  // One operator per app, made the first time the model reaches for it. A
  // closed tab's number never comes back (pilot.mjs counts up), so an
  // operator is only ever let go, never replaced.
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
        betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18", CONTEXT_BETA],
        context_management: CONTEXT_MANAGEMENT,
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
        if (!app.visible) host.show(app.id);
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
    const operator = operatorOf(app);
    try {
      const saw = shownAt.get(app.id);
      if (event && saw !== undefined && String(app.mirror?.version) !== saw) {
        throw new AgentError(`the screen changed since you saw it (the person used the app, or an earlier step of yours changed it) - ${echo(event)} was not pressed${values ? " and nothing was typed" : ""}; act on the screen below`);
      }
      // Brought on screen only for an act that can happen: an event the
      // screen does not offer used to switch the reader's tab and then be
      // refused. The client checks the rest (a field, a value) itself.
      if (event) {
        const before = await operator.look();
        if (!before.actions.some((a) => a.id === event || a.event === event)) {
          throw new AgentError(`no action '${echo(event)}' on this screen - actions: ${before.actions.map((a) => `${a.id} (${a.event}${a.label ? `, "${a.label}"` : ""})`).join(", ") || "none"}`);
        }
      }
      if (!app.visible) host.show(app.id);
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
    // A carried sample's files are a promise (its chunk may still be on
    // the way); a class the page does not carry is undefined.
    let files = await host.carried(cls);
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
