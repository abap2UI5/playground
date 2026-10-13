// The AI half of the chat: a conversation with Claude that builds an app in
// the editor (src/shell/chat.mjs is the half on screen).
//
// A chunk of its own, split off wherever chat.mjs says import( ): the SDK and
// the app-building guide are only downloaded by somebody who opens the chat,
// never by the reader who came to write ABAP by hand.
//
// The model works on the playground through tools, and only through tools -
// the same editor, the same two checkers and the same Run a person uses:
//
//   write_file / edit_file / delete_file   the files in the editor
//   read_files                             what is in them now
//   run_app                                Run, and what it said: the problems,
//                                          the tests, the first roundtrip, a dump
//   search_samples / read_sample           the sample catalogue this site
//                                          already carries (samples/apps.json)
//   look / act                             the running app's screen as the
//                                          agent snapshot, and a step in it -
//                                          the AI Pilot's eyes and hands
//                                          (src/shell/ai-operator.mjs), so the
//                                          model can try what it built
//
// So nothing here compiles, checks or renders anything itself: what the model
// is told is what the reader sees, and a file it writes is a file in the editor
// that Ctrl+Z takes back and the abapGit zip exports.
//
// The key is the reader's own and stays in this browser: the request goes from
// this page to api.anthropic.com and nowhere else, which is the only reason a
// static page can have a chat at all. `dangerouslyAllowBrowser` is the SDK's
// name for exactly that choice.
import Anthropic from "@anthropic-ai/sdk";
import { addUsage, catalogueEntries, CONTEXT_BETA, CONTEXT_MANAGEMENT, DEFAULT_SPEED, followStream, rankEntries, SPEEDS } from "./ai-common.mjs";
// The framework's own guide to building an app, from the abap2UI5 commit
// tools/fetch-deps.mjs pins - the same commit the runtime in this page is
// transpiled from, so the API the guide describes is the API that runs here.
import GUIDE from "../../deps/abap2ui5/docs/agents/building-apps.md";
import { linterSettings } from "../editor/abap2ui5-lint.mjs";
import { parseName } from "../editor/files.mjs";
import { UI5_LIBRARIES } from "./ui5-libraries.mjs";
import { AgentError } from "../vendor/agent/appclient.mjs";
import { createOperator, describeMirror, fitSnapshot, MAX_ERROR_TEXT } from "./ai-operator.mjs";
import { isUntouchedStarter } from "./ai-starter.mjs";
import { attachmentBlocks } from "./attachments.mjs";

// The mirror of the running app's screen, made by chat.mjs with this chunk
// (ai-operator.mjs, shared with the AI Pilot).
export { createMirror } from "./ai-operator.mjs";

// The speeds and the errors are the AI Pilot's as well (src/shell/ai-common.mjs).
export { SPEEDS, DEFAULT_SPEED, explainError, usageText } from "./ai-common.mjs";
// What the chat checks a file against as it is added (attach-ui.mjs).
export { kindOf, MAX_FILES, MAX_MESSAGE_BYTES } from "./attachments.mjs";

// The tools that change the editor, after which the page runs the app by
// itself (see loop( )).
const FILE_TOOLS = new Set(["write_file", "edit_file", "delete_file"]);

// What applies here and not in a real system - the guide is written for a
// project with abapGit, the linter on the command line and an SAP system
// behind it, and three of its four assumptions are not true in this page.
const playgroundRules = ({ ui5, distribution }) => `You are the AI assistant of the abap2UI5 playground, a web page where a
person describes an app in plain language and you build it as an abap2UI5
app: one ABAP class implementing z2ui5_if_app. The page compiles the ABAP in
the browser (abaplint transpiler + open-abap) and runs it against the real
abap2UI5 framework, so the person sees the app running on the right while you
talk. At the end they download the class for abapGit and import it into
their SAP system - so write code that is correct on a real system, not only
here.

How the playground works, and what that means for you:
- The editor holds a small set of ABAP files named the way abapGit names
  them: <name>.clas.abap, <name>.intf.abap, <class>.clas.testclasses.abap.
  The object declared in a file must have the name of the file
  (zcl_order_app.clas.abap declares CLASS zcl_order_app). Names are lower
  case in the file name, start with z or y, at most 30 characters.
- The FIRST file is the app: Run starts the class it declares. Use
  write_file with as_app: true for the app class.
- Use the tools to change the editor. Never paste code into the chat
  instead - the person sees the editor and the running app, and the files
  are what they take home. Write a new app as one complete write_file;
  use edit_file for later changes of a few lines. For example, after
  write_file of zcl_order_app.clas.abap a fix of one method is ONE
  edit_file whose old_text is the few lines around the change - never a
  second write_file of the whole class: every write_file is the whole class
  again in this conversation, and the person pays for it on every turn.
- The person is watching and every turn costs them time, so make all the
  changes a step needs in ONE message - several tool calls side by side -
  rather than one change per turn.
- After the file changes of a message, the page runs the app by itself and
  attaches the report to the result of your last change: abaplint errors
  block the run and must be fixed; abap2UI5 lint errors and warnings (a
  control or property UI5 1.71 does not have, a binding or event that will
  not work) must be fixed too; hints are advice - take them when they are
  cheap, never spend a turn on them alone; a dump names the line. Iterate
  until it runs without errors and warnings, then stop calling tools. run_app is only for
  running again without changing anything.
- There is no database of the person's own here: no custom tables, no
  SELECT from business tables, no RFC, no files, no HTTP. When the app
  needs data, fill internal tables in the code (VALUE #( ... )) and say in
  one sentence where the real SELECT would go.
- Only these UI5 libraries are loaded: ${UI5_LIBRARIES.filter((l) => l.startsWith("sap.")).join(", ")}.
  OpenUI5 only - no sap.ui.comp, sap.suite, sap.viz. The abap2UI5 linter
  checks the view against ${distribution === "sapui5" ? "SAPUI5" : "OpenUI5"} ${ui5} (the person's setting) -
  hold the view to what that release has.
- Build views with z2ui5_cl_ui5_view_builder as the guide below shows,
  never with the frozen z2ui5_cl_xml_view.
- The guide below covers the common patterns - write from it directly.
  Only when it does not cover what you need, search_samples finds a sample
  that does it and read_sample gives you its source.
- The editor may already hold code (a sample, or the person's own work).
  If the person asks for something new, write a new app class, make it the
  app and delete the files it does not need. If they ask for a change,
  change what is there.

Trying the app:
- A run that started the app ends with the screen as an AGENT SNAPSHOT
  (fields, actions, tables, messages - what look answers). Once a run is
  clean, try the app's main path ONCE with act - type the values a person
  would, press the button, read what the app answered (a toast, a message
  box, a new row) - and fix what does not work. A few acts, not a tour:
  act is for the step that proves the app works, not for every change.
  Ids (f1, a1) are valid for one snapshot only; an act on a screen that
  changed since is refused with the screen as it is. Never act before the
  run is clean, and never on a screen you have not seen.

Files the person attaches:
- A message may carry files: a specification (PDF, Word), a screenshot or
  mockup of a screen to rebuild, a spreadsheet (each sheet comes as CSV), a
  text file. Build from them - the fields, the columns, the labels, the
  steps - and use a spreadsheet's rows as the data of the internal tables
  (VALUE #( ... )), not invented ones. Say what you took from which file and
  what a file asked for that the app does not do yet.

Talking to the person:
- Answer in the language the person writes in.
- Keep messages short: what you built or changed, in a sentence or two, and
  anything the app does not do yet. They can read the code in the editor.
- When the app is done, tell them they can download it for abapGit with
  the button above the chat.

The abap2UI5 guide to building apps follows. Its sections on validation
tooling (npm scripts, the MCP server, screenshots) do not apply here: in
this page, the run after your changes is your validation.`;

// The rules name the UI5 release the linter checks against, which the reader
// can change in the Config tab - so the prompt is built per request, from the
// settings as they are then. Same settings, same text, same cache.
const systemFor = (settings) => [
  {
    type: "text",
    text: `${playgroundRules(settings)}\n\n<guide>\n${GUIDE}\n</guide>`,
    // The rules and the guide are the same on every request - about twelve
    // thousand tokens that are read from the cache after the first one.
    cache_control: { type: "ephemeral" },
  },
];

// Every tool streams its input as it is generated (a class is a long string),
// which means the API no longer validates it - so each one is checked below
// before it touches the editor, and a malformed one goes back to the model as
// an error rather than into a file.
const TOOLS = [
  {
    name: "write_file",
    description:
      "Create a file in the editor or replace its whole content. Use it for a new class or a rewrite; " +
      "edit_file is cheaper for a change of a few lines. Set as_app to make this file the app, the class Run starts.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "File name as abapGit names it, e.g. zcl_order_app.clas.abap" },
        source: { type: "string", description: "The complete ABAP source of the file" },
        as_app: { type: "boolean", description: "Make this the first file - the app Run starts" },
      },
      required: ["name", "source"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace one passage of a file in the editor. old_text must occur exactly once in the file; " +
      "line breaks as they are, and a difference in indentation or trailing spaces is forgiven " +
      "(the file's own indentation is kept).",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        old_text: { type: "string", description: "The exact text to replace" },
        new_text: { type: "string", description: "What replaces it" },
      },
      required: ["name", "old_text", "new_text"],
    },
  },
  {
    name: "delete_file",
    description: "Close a file in the editor. The app (the first file) cannot be deleted - make another file the app first.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "read_files",
    description:
      "The files in the editor as they are now, the app first - or only the ones in `names`. The person may " +
      "have edited them by hand. A long file is cut at its end and says so; ask for one file at a time then.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" }, description: "The file names to read; all files when left out" },
      },
    },
  },
  {
    name: "run_app",
    description:
      "Press Run again without changing a file - after write_file, edit_file or delete_file the page runs the " +
      "app by itself and attaches this same report to your last change. Checks the ABAP, compiles it, runs the " +
      "unit tests and starts the app. Answers with the status, " +
      "every problem from abaplint and the abap2UI5 linter, the test results, the first roundtrip " +
      "(the view the app rendered) and a dump with its line if the app dumped.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_samples",
    description:
      "Search the abap2UI5 sample catalogue (about 770 apps) by keywords - a control name, a feature " +
      "(popup, value help, table, navigation, message box). Answers with the best matches.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "One to three keywords" } },
      required: ["query"],
    },
  },
  {
    name: "look",
    description:
      "The screen of the running app as it is now - the agent snapshot: fields (id, path, label, value, " +
      "editable), actions (id, event, label, enabled), tables (rows), messages (what the app said). " +
      "Pass max_rows for more table rows (default 20).",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: { max_rows: { type: "number" } } },
  },
  {
    name: "act",
    description:
      "Try the running app on the person's screen: type `values` into fields and fire `event`, then get the " +
      "new snapshot. values: { \"<field id | path | name>\": value } (table cells \"<table path>/<row>/<COLUMN>\"); " +
      "event: an action's event name or id; row: the 0-based row of a row action. Without event the values are " +
      "typed but not sent. Strict: what is not on the screen is refused with the list of what is, and nothing is done.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        values: { type: "object", description: "{ \"<field id, path or name>\": value }" },
        event: { type: "string", description: "the action to fire: its event name (e.g. \"SAVE\") or its id (\"a3\")" },
        row: { type: "number", description: "for a row action: the row index (0-based) in its table" },
        args: { type: "array", description: "event arguments, positional to the action's args; null where the client fills the value" },
        max_rows: { type: "number" },
      },
    },
  },
  {
    name: "read_sample",
    description: "The ABAP source of a sample class that search_samples found.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { class: { type: "string", description: "The class name, e.g. z2ui5_cl_smp_app_019" } },
      required: ["class"],
    },
  },
];

const str = (v) => (typeof v === "string" ? v : undefined);
const MAX_TOOL_TEXT = 24000;
// A file the model reads is cut on its own, not as part of one text: two
// classes of 500 lines are 40,000 characters, and cut together at 24,000
// the second was never seen - and then edited blind.
const MAX_FILE_TEXT = 40000;
const MAX_FILES_TEXT = 120000;
const clip = (text, max = MAX_TOOL_TEXT) =>
  text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters cut)`;

const lineCount = (source) => source.split("\n").length;
// What the files are, as the model reads them: a list first, then each file
// cut on its own - under a ceiling for all of them together.
export function filesAsText(files, { all = files } = {}) {
  const list = all.map((f, i) => `${f.name} (${lineCount(f.source)} lines)${i === 0 ? " - the app" : ""}`).join(", ");
  let room = MAX_FILES_TEXT;
  const parts = [];
  for (const f of files) {
    const index = all.indexOf(f);
    const head = `=== ${f.name}${index === 0 ? " (the app)" : ""} ===`;
    if (room <= 0) {
      parts.push(`${head}\n… (not shown - the files together are too long; read_files with names reads this one)`);
      continue;
    }
    const text = clip(f.source, Math.min(MAX_FILE_TEXT, room));
    room -= text.length;
    parts.push(`${head}\n${text}`);
  }
  return `files in the editor: ${list}\n\n${parts.join("\n\n")}`;
}

/**
 * One conversation. `host` is the page (src/shell/main.mjs hands it over
 * through chat.mjs); `ui` is what the chat draws.
 *
 *   host.files()           -> [{ name, source }], the app first
 *   host.setFiles(files)   -> puts a whole file set into the editor (throws on a bad name)
 *   host.run()             -> the report of one Run, see describeRun( )
 *   host.show(name)        -> puts that file on screen in the editor
 *
 *   ui.assistantStart()  ui.text(delta)  ui.notice(text)
 *   ui.thinkingStart()  ui.thinking(delta)     the model's progress notes between tool calls
 *   ui.toolPending({ id, text })               a tool call while its input streams in, then while it runs
 *   ui.tool({ id, summary, error })            the same row, done
 *   ui.usage({ input, output, cached })
 *
 * `speed` answers which of SPEEDS to use, asked before every request, so a
 * change in the header applies from the next turn on.
 */
export function createAgent({ apiKey, workspace, host, ui, speed = () => DEFAULT_SPEED }) {
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    // A key that is not tied to a workspace is refused without this header
    // ("This API key is not scoped to a workspace..."); the ordinary key
    // belongs to one already and sends nothing extra.
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  // The conversation exactly as it was sent and answered - only ever
  // appended to: the model's thinking blocks are bound to the history they
  // were written in, and an edited history invalidates them.
  const messages = [];
  // What the model last saw of the editor, so a hand edit between two
  // messages is told to it rather than discovered by a failed edit_file -
  // as a snapshot to compare, and as the files, so only what changed goes.
  let seen;
  let seenFiles = [];
  let stream;
  let stopped = false;
  // Resolved by stop( ): a tool still running (a run waiting on its app, a
  // sample being fetched) is no longer waited for - Stop changed nothing
  // until it had ended on its own.
  let stopping;
  let stopNow = () => {};
  const untilStopped = (work, what) =>
    Promise.race([work, stopping.then(() => ({ error: `Stopped by the person while ${what}.` }))]);
  const total = { input: 0, output: 0, cached: 0, written: 0, dollars: 0 };
  // Where each message of the reader's began in the history, and what the
  // model had seen of the editor before it - so rewind( ) can take the last
  // exchange out whole for a message edited and sent again.
  const turns = [];

  const snapshot = () => JSON.stringify(host.files());

  // The model's eyes and hands on the app (ai-operator.mjs), made the first
  // time it reaches for them; `told` is the mirror's version the model was
  // last shown a screen of - an act with an event on an older one is refused.
  let operator;
  let told = -1;
  const mirror = () => host.app?.mirror?.();
  const operatorOf = () => {
    if (!operator) {
      operator = createOperator({
        app: host.app,
        mirror: mirror(),
        ui: { acting: (text) => ui.acting?.(text) },
        halted: () => stopped,
      });
    }
    return operator;
  };
  const MAX_SCREEN_TEXT = 16000;
  // A snapshot as the model reads it, fitted whole (never cut mid-JSON), and
  // the dump of the last answer after it, if there was one.
  const screenText = (snap, budget = MAX_SCREEN_TEXT) => {
    told = mirror()?.version ?? -1;
    const error = mirror()?.error;
    const fitted = fitSnapshot(snap, budget - (error ? error.length : 0) - 100);
    return clip(JSON.stringify({ ...fitted, ...(error ? { lastAnswer: error } : {}) }), budget);
  };
  // The screen after a run, for the run's report: read off the mirror once
  // the frame has settled, so a popup the first answer opens is on it.
  async function screenAfterRun() {
    const m = mirror();
    if (!m || !m.state.id || !host.app) return "";
    try {
      await operatorOf().settled?.();
      const snap = describeMirror(m);
      return `\n\nscreen (agent snapshot, what look answers):\n${screenText(snap, 12000)}`;
    } catch (e) {
      return `\n\nscreen: could not be read - ${String(e?.message ?? e)}`;
    }
  }

  // `files` are the File objects the reader added to this message; they go in
  // front of its text, as the content blocks attachments.mjs makes of them.
  async function send(text, files = []) {
    const seenBefore = seen;
    const seenFilesBefore = seenFiles;
    stopped = false;
    stopping = new Promise((resolve) => {
      stopNow = resolve;
    });
    const now = snapshot();
    const content = [];
    if (now !== seen) {
      content.push({ type: "text", text: editorChanged(host.files(), seenFiles) });
      seen = now;
      seenFiles = host.files();
    }
    if (files.length > 0) {
      const { blocks, errors } = await attachmentBlocks(files);
      for (const error of errors) ui.notice(error);
      content.push(...blocks);
    }
    content.push({ type: "text", text });
    turns.push({ at: messages.length, seen: seenBefore, seenFiles: seenFilesBefore });
    messages.push({ role: "user", content });
    const at = messages.length;
    try {
      await loop();
    } catch (err) {
      // Nothing answered to it: taken back out, as in the Pilot. Refused as
      // it stands (a 413 of the attachments), it was resent - and refused -
      // with every later message until New chat; failed otherwise, "send
      // again" sent it twice. The editor's files it carried go with the next
      // message instead. A message the reader stopped stays.
      if (messages.length === at && !(err instanceof Anthropic.APIUserAbortError)) {
        messages.pop();
        turns.pop();
        seen = seenBefore;
        seenFiles = seenFilesBefore;
      }
      throw err;
    }
    // Answered so the chat can say "stopped" rather than "done".
    return { stopped };
  }

  async function loop() {
    let jsonRetries = 0;
    // Answers in a row cut off at max_tokens with a tool call in them. Each
    // one is a full, billed request, and thinking counts towards the limit:
    // a long think before a large write could be cut on every attempt, and
    // the loop asked again without end until Stop was pressed.
    let cuts = 0;
    while (!stopped) {
      ui.assistantStart();
      const settings = SPEEDS[speed()] ?? SPEEDS[DEFAULT_SPEED];
      stream = client.beta.messages.stream({
        model: settings.model,
        max_tokens: 32000,
        system: systemFor(linterSettings()),
        tools: TOOLS,
        messages,
        output_config: { effort: settings.effort },
        // The reasoning stays hidden; the short notes the model writes between
        // tool calls ("the table is there, now the search") come back as text,
        // so a long turn is not minutes of silence.
        thinking: { type: "adaptive", display: "updates" },
        betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18", CONTEXT_BETA],
        context_management: CONTEXT_MANAGEMENT,
        // A request a safety classifier declines is answered by the model
        // the API picks for that category instead of stopping the turn.
        fallbacks: "default",
        // The conversation so far, cached up to its last block: every turn of
        // a tool loop resends all of it.
        cache_control: { type: "ephemeral" },
      });
      // What arrives before the turn is complete, shown as it arrives: a
      // progress note, and a tool call whose input is still streaming - a
      // class being written is the longest wait of all, and it counts its
      // lines on screen rather than sitting still.
      const started = followStream(stream, ui, pendingText);

      let message;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // The stream reports a failure without ending its request: left
        // alone, a retry below would leave the first one generating (and
        // billed) in the background, out of reach of Stop.
        stream.abort();
        // Billed all the same - the input from the moment it started.
        addUsage(total, stream.currentMessage?.usage, settings.model);
        ui.usage({ ...total });
        if (stopped) return;
        // A tool input that could not be parsed at all - the one failure that
        // is worth re-asking for. Everything the API itself refused (a key,
        // a rate limit, an overload) goes to the chat as it is.
        //
        // Only that: a stream whose connection dropped half way is a plain
        // AnthropicError as well, and every such drop was sent again twice -
        // three billed requests, three half answers in the chat, then a bare
        // "network error". Recognised by the SDK's own message for it.
        const unparsable = /Unable to parse tool parameter JSON/.test(String(err?.message ?? ""));
        if (!unparsable || err instanceof Anthropic.APIError || jsonRetries++ >= 2) {
          throw err;
        }
        // The calls of the attempt thrown away are not going to run: asked
        // again, they come back under new ids, and the old rows went on
        // shimmering until the turn ended and then said "not finished".
        for (const s of started) ui.tool({ id: s.id, summary: `${s.name}: the input was unreadable - asked again`, error: true });
        continue;
      }

      addUsage(total, message.usage, message.model ?? settings.model);
      ui.usage({ ...total });

      if (message.stop_reason === "refusal") {
        // Not the refused content itself: a classifier that stops a turn mid
        // stream can leave a tool_use that is never answered, or a thinking
        // block without its signature, and either one makes every later
        // request of this conversation a 400. A plain placeholder keeps the
        // history valid and append-only.
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
      // Cut off, either way: the answer's own budget, or the conversation
      // having filled the model's context window. Both leave the last block
      // half written, and a tool input that is cut off parses as a shorter,
      // valid one.
      const full = message.stop_reason === "model_context_window_exceeded";
      const cut = message.stop_reason === "max_tokens" || full;
      if (uses.length === 0) {
        messages.push({ role: "assistant", content: message.content });
        if (full) ui.notice("The conversation has filled the model's context - New chat starts a fresh one.");
        else if (cut) ui.notice("The answer was cut off - it ran out of room.");
        return;
      }
      if (full) {
        // Asking again would only overflow again; nothing is run.
        messages.push({ role: "assistant", content: message.content });
        messages.push({
          role: "user",
          content: uses.map((u) => {
            ui.tool({ id: u.id, summary: `not run: ${u.name}`, error: true });
            return { type: "tool_result", tool_use_id: u.id, is_error: true, content: "Not run: the context window is full." };
          }),
        });
        ui.notice("The conversation has filled the model's context - New chat starts a fresh one.");
        return;
      }
      if (cut) {
        // A file cut off half way would parse as a shorter, valid file. Never
        // write it; the turn ends and says why.
        messages.push({ role: "assistant", content: message.content });
        messages.push({
          role: "user",
          content: uses.map((u) => {
            // The row drawn while the input streamed is finished here, or it
            // would go on shimmering as if the call were still running.
            ui.tool({ id: u.id, summary: `not run: ${u.name} (cut off)`, error: true });
            return {
              type: "tool_result",
              tool_use_id: u.id,
              is_error: true,
              content: "Not run: the answer hit max_tokens and this input may be cut off. Write smaller pieces (edit_file).",
            };
          }),
        });
        if (++cuts >= 2) {
          ui.notice("The answer ran out of room twice in a row - ask for a smaller step, or New chat.");
          return;
        }
        ui.notice("The answer ran out of room before a tool call was complete - asking for smaller steps.");
        continue;
      }
      cuts = 0;

      messages.push({ role: "assistant", content: message.content });
      // Whether the reader changed the editor by hand while the model was
      // thinking - something the model has not been told yet, and must still
      // be told on the next message rather than absorbed into what its own
      // tools did.
      // Checked before every tool as well, not just once here: a change by
      // hand between two tools is as untold as one made before them.
      let untold = snapshot() !== seen;
      let expected = snapshot();
      const results = [];
      // The last successful change, and whether a run_app came after it.
      let lastChange;
      let ranSince = false;
      for (const use of uses) {
        if (stopped) {
          ui.tool({ id: use.id, summary: `not run: ${use.name} (stopped)`, error: true });
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Stopped by the user." });
          continue;
        }
        if (snapshot() !== expected) untold = true;
        if (use.name === "run_app") ui.toolPending({ id: use.id, text: pendingText("run_app", {}) });
        let result;
        try {
          result = await untilStopped(execute(use.name, use.input ?? {}), `${use.name} was running`);
        } catch (e) {
          result = { error: String(e?.message ?? e) };
        }
        ui.tool({ id: use.id, summary: result.summary ?? result.error ?? "", error: Boolean(result.error || result.failed), started: Boolean(result.started) && !result.failed });
        const entry = {
          type: "tool_result",
          tool_use_id: use.id,
          ...(result.error ? { is_error: true } : {}),
          // A read is cut per file by filesAsText( ); everything else here.
          content: use.name === "read_files" && !result.error ? result.text : clip(result.error ?? result.text),
        };
        results.push(entry);
        if (FILE_TOOLS.has(use.name) && !result.error) {
          lastChange = entry;
          ranSince = false;
        } else if (use.name === "run_app") {
          ranSince = true;
        }
        expected = snapshot();
      }
      // What the tools left, taken BEFORE the automatic run: the run takes
      // seconds, and what the reader typed meanwhile was recorded as seen by a
      // snapshot taken after it - the model was never told, and rewrote the
      // file from its own copy, the typing with it. Typed during the run, it
      // now differs from this at the next send( ) and goes with that message.
      const afterTools = snapshot();
      // The run every change is followed by, done here rather than asked
      // for: a model that has to call run_app after writing spends a whole
      // turn - the request, the thinking, the answer - on pressing a button.
      // The report rides on the result of the last change, in the same
      // message, so the next turn already knows how the code ran.
      if (lastChange && !ranSince && !stopped) {
        const id = `auto-run-${results.length}-${messages.length}`;
        ui.toolPending({ id, text: pendingText("run_app", {}) });
        let report;
        try {
          const ran = await untilStopped(host.run(), "the app was running");
          report = ran.error ? { text: ran.error, summary: "run stopped" } : describeRun(ran);
          if (report.started && !report.failed) report.text += await untilStopped(screenAfterRun(), "the screen was read").then((t) => (typeof t === "string" ? t : ""));
        } catch (e) {
          report = { text: `The automatic run failed: ${String(e?.message ?? e)}`, summary: "run failed" };
        }
        ui.tool({ id, summary: report.summary, error: Boolean(report.failed), started: Boolean(report.started) && !report.failed });
        lastChange.content = clip(`${lastChange.content}\n\nThe page ran the app after these changes:\n${report.text}`);
      }
      // Whatever the tools changed, the model has just been told - unless a
      // hand edit came in first, which the next user message has to carry.
      if (!untold) {
        seen = afterTools;
        seenFiles = JSON.parse(afterTools);
      }
      // All results in one message - split across several, the model learns
      // to stop making parallel calls.
      messages.push({ role: "user", content: results });
    }
  }

  async function execute(name, input) {
    switch (name) {
      case "write_file": return writeFile(input);
      case "edit_file": return editFile(input);
      case "delete_file": return deleteFile(input);
      case "read_files": {
        const all = host.files();
        const names = Array.isArray(input.names) ? input.names.map((n) => str(n)?.trim()).filter(Boolean) : [];
        const missing = names.filter((n) => !all.some((f) => f.name === n));
        if (missing.length) return { error: `There is no file ${missing.join(", ")} in the editor. Open files: ${all.map((f) => f.name).join(", ")}.` };
        const files = names.length ? all.filter((f) => names.includes(f.name)) : all;
        return { text: filesAsText(files, { all }), summary: `read ${names.length ? files.map((f) => f.name).join(", ") : `${files.length} file${files.length === 1 ? "" : "s"}`}` };
      }
      case "run_app": {
        const report = describeRun(await host.run());
        if (report.started && !report.failed) report.text += await screenAfterRun();
        return report;
      }
      case "look": {
        const snap = await operatorOf().look(count(input.max_rows, "max_rows"));
        return { text: screenText(snap), summary: `looked at ${snap.title || snap.app || "the app"}` };
      }
      case "act": return act(input);
      case "search_samples": return searchSamples(input);
      case "read_sample": return readSample(input);
      default: return { error: `There is no tool called ${name}.` };
    }
  }

  async function act(input) {
    const values = input.values && typeof input.values === "object" && !Array.isArray(input.values) ? input.values : undefined;
    const event = str(input.event);
    if (!values && !event) return { error: "act needs values, an event, or both." };
    const m = mirror();
    if (!m?.state.id) return { error: "No app is running on the stage - a run that starts the app comes first (write the app, or run_app)." };
    try {
      const row = count(input.row, "row");
      const maxRows = count(input.max_rows, "max_rows");
      if (event && told !== -1 && m.version !== told) {
        throw new AgentError("the screen changed since you saw it (a run, or the person used the app) - nothing was typed or pressed; act on the screen below");
      }
      const snap = await operatorOf().act({ values, event, row, args: Array.isArray(input.args) ? input.args : undefined, maxRows });
      const what = [
        values ? `typed ${Object.keys(values).length} value${Object.keys(values).length === 1 ? "" : "s"}` : "",
        event ? `pressed ${event.slice(0, 40)}` : "",
      ].filter(Boolean).join(", ");
      const said = (snap.messages ?? []).filter((x) => x.source !== "strip" && x.text).map((x) => x.text)[0];
      return { text: screenText(snap), summary: `${what}${said ? ` → "${String(said).slice(0, 60)}"` : ""}` };
    } catch (e) {
      // A refusal names what is possible; the screen goes with it, so the
      // next act needs no look first.
      let screen = "";
      try {
        screen = `\n\nThe screen now:\n${screenText(await operatorOf().look())}`;
      } catch {
        screen = "";
      }
      return { error: `${clip(String(e?.message ?? e), MAX_ERROR_TEXT)}${screen}` };
    }
  }

  function writeFile(input) {
    const name = str(input.name)?.trim();
    const source = str(input.source);
    if (!name || source === undefined) return { error: "write_file needs a name and a source (both strings)." };
    if (!parseName(name)) {
      return { error: `${name} is not a file name the playground takes: <name>.clas.abap, <name>.intf.abap or <class>.clas.testclasses.abap, lower case.` };
    }
    const parsed = parseName(name);
    if (input.as_app === true && (parsed.kind !== "clas" || parsed.include)) {
      return { error: `${name} cannot be the app - the app is a class (<name>.clas.abap) implementing z2ui5_if_app.` };
    }
    const files = host.files();
    const at = files.findIndex((f) => f.name === name);
    let next = at === -1 ? [...files, { name, source }] : files.map((f) => (f.name === name ? { name, source } : f));
    if (input.as_app === true) next = [next.find((f) => f.name === name), ...next.filter((f) => f.name !== name)];
    // A file with nothing in it, or the AI Studio's starting class as it was
    // handed out, goes as soon as another class is written: left first it
    // would stay the app the page tries to start, and it starts to nothing.
    // Only for a class, and the class takes the app's place: an interface
    // written first used to drop the starter and leave itself first - "the
    // first file is the app, so it has to be a class" - and a class written
    // after it was refused the same way.
    if (parsed.kind === "clas" && !parsed.include) {
      const appGoes = next[0].name !== name && isUntouchedStarter(next[0]);
      next = next.filter((f) => f.name === name || !isUntouchedStarter(f));
      if (appGoes) next = [next.find((f) => f.name === name), ...next.filter((f) => f.name !== name)];
    }
    host.setFiles(next);
    // The file it just wrote is the one on screen, so the reader watches
    // the code arrive rather than the app file it may not have touched.
    host.show?.(name);
    const lines = source.split("\n").length;
    return {
      text: `${at === -1 ? "Created" : "Replaced"} ${name} (${lines} lines)${next[0].name === name ? ", it is the app" : ""}.`,
      summary: `${at === -1 ? "created" : "rewrote"} ${name}`,
    };
  }

  function editFile(input) {
    const name = str(input.name)?.trim();
    const rawOld = str(input.old_text);
    const rawNew = str(input.new_text);
    if (!name || rawOld === undefined || rawNew === undefined) {
      return { error: "edit_file needs name, old_text and new_text (all strings)." };
    }
    const files = host.files();
    const file = files.find((f) => f.name === name);
    if (!file) return { error: `There is no file ${name} in the editor. Open files: ${files.map((f) => f.name).join(", ")}.` };
    if (rawOld === "") return { error: "old_text is empty - use write_file to replace a whole file." };
    // A file that came in with CRLF (a gist, a stored draft) keeps it in its
    // model, and the model writes \n: matched as typed, every edit of more
    // than one line was "does not occur". The texts take the file's ending.
    const crlf = file.source.includes("\r\n");
    const eol = (t) => (crlf ? t.replace(/\r?\n/g, "\r\n") : t);
    const oldText = eol(rawOld);
    const newText = eol(rawNew);
    const found = locate(file.source, oldText, newText);
    if (found.error) return { error: `${found.error} in ${name}${found.error.startsWith("old_text does not") ? ". Call read_files to see the file as it is" : " - include more of the surrounding lines"}.` };
    const source = file.source.slice(0, found.start) + found.replacement + file.source.slice(found.end);
    host.setFiles(files.map((f) => (f.name === name ? { name, source } : f)));
    host.show?.(name);
    const how = found.loose ? " (indentation and trailing spaces matched loosely; the file's own indentation is kept)" : "";
    return { text: `Edited ${name}${how}.`, summary: `edited ${name}` };
  }

  function deleteFile(input) {
    const name = str(input.name)?.trim();
    const files = host.files();
    if (!name || !files.some((f) => f.name === name)) return { error: `There is no file ${name} in the editor.` };
    if (files[0].name === name) return { error: `${name} is the app. Make another file the app first (write_file with as_app).` };
    // A class's test include goes with it: alone, it would be a file of a
    // class that is not there.
    const tests = name.replace(/\.clas\.abap$/, ".clas.testclasses.abap");
    host.setFiles(files.filter((f) => f.name !== name && f.name !== tests));
    return { text: `Deleted ${name}.`, summary: `deleted ${name}` };
  }

  return {
    send,
    stop() {
      stopped = true;
      stopNow();
      stream?.abort();
    },
    /*
     * The last exchange taken out of the history - the reader's message and
     * everything answered to it - for a message edited and sent again. The
     * history stays valid: a thinking block is bound to what came BEFORE it,
     * and nothing before the message is touched. The files in the editor
     * are not put back (that is the checkpoint's job, chat.mjs); what the
     * model had seen of them is, so the next message tells the difference.
     */
    rewind() {
      const turn = turns.pop();
      if (!turn) return false;
      messages.length = turn.at;
      seen = turn.seen;
      seenFiles = turn.seenFiles;
      return true;
    },
    get usage() {
      return { ...total };
    },
  };
}

/*
 * Where `oldText` is in `source`, and what goes in its place. Exactly, once;
 * or - a model misreads an indentation or drops a trailing space more often
 * than it misreads a word, and every miss was a whole billed turn - line by
 * line with the whitespace at both ends of each line forgiven, still exactly
 * once. On a loose match the file's indentation wins: each replacement line
 * is shifted by the difference between the file's first matched line and
 * old_text's, so a passage pasted at the wrong depth lands at the right one.
 */
export function locate(source, oldText, newText) {
  const first = source.indexOf(oldText);
  if (first !== -1) {
    if (source.indexOf(oldText, first + 1) !== -1) return { error: "old_text occurs more than once" };
    return { start: first, end: first + oldText.length, replacement: newText, loose: false };
  }
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(eol);
  const wanted = oldText.split(eol).map((l) => l.trim());
  while (wanted.length > 1 && wanted[wanted.length - 1] === "") wanted.pop();
  if (wanted.length === 0 || wanted.every((l) => l === "")) return { error: "old_text does not occur" };
  const matches = [];
  for (let i = 0; i + wanted.length <= lines.length; i++) {
    if (wanted.every((w, k) => lines[i + k].trim() === w)) matches.push(i);
  }
  if (matches.length === 0) return { error: "old_text does not occur" };
  if (matches.length > 1) return { error: "old_text occurs more than once" };
  const at = matches[0];
  const indentOf = (l) => /^[ \t]*/.exec(l)[0];
  const fileIndent = indentOf(lines[at]);
  const givenIndent = indentOf(oldText.split(eol)[0]);
  const shift = (l) => {
    if (l.trim() === "") return "";
    const own = indentOf(l);
    // The given depth and the file's: a line deeper than old_text's first
    // line keeps its extra depth on top of the file's.
    const extra = own.startsWith(givenIndent) ? own.slice(givenIndent.length) : own;
    return fileIndent + extra + l.slice(own.length);
  };
  const replacement = newText.split(eol).map(shift).join(eol);
  let start = 0;
  for (let i = 0; i < at; i++) start += lines[i].length + eol.length;
  let end = start;
  for (let k = 0; k < wanted.length; k++) end += lines[at + k].length + (k < wanted.length - 1 ? eol.length : 0);
  return { start, end, replacement, loose: true };
}

// What the editor holds now, told to the model as what changed since it last
// looked: the list of all files, then only the files that are new or
// different, each cut on its own, and the names of the ones that went.
function editorChanged(files, before) {
  const was = new Map(before.map((f) => [f.name, f.source]));
  const changed = files.filter((f) => was.get(f.name) !== f.source);
  const gone = before.filter((f) => !files.some((g) => g.name === f.name)).map((f) => f.name);
  const what = before.length === 0
    ? "The editor holds these files right now:"
    : `The editor changed since you last saw it (the person edited by hand, or opened something) - ${changed.length ? `changed: ${changed.map((f) => f.name).join(", ")}` : "no file changed"}${gone.length ? `; removed: ${gone.join(", ")}` : ""}:`;
  return `<editor_files>\n${what}\n\n${filesAsText(changed, { all: files })}\n</editor_files>`;
}

// row and max_rows: a whole number, or a string of digits.
function count(v, name) {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0) throw new AgentError(`${name} is a whole number, not ${JSON.stringify(v).slice(0, 40)}`);
  return n;
}

// What a tool call is doing while it is still under way - written while its
// input streams in, so it reads whatever of the input has arrived.
export function pendingText(name, input) {
  const file = str(input.name) ?? "a file";
  switch (name) {
    case "write_file": {
      const lines = str(input.source)?.split("\n").length ?? 0;
      return `writing ${file}${lines ? ` · ${lines} line${lines === 1 ? "" : "s"}` : ""}…`;
    }
    case "edit_file": return `editing ${file}…`;
    case "delete_file": return `deleting ${file}…`;
    case "read_files": return "reading the editor…";
    case "run_app": return "running the app…";
    case "search_samples": return `searching samples${str(input.query) ? ` for "${input.query}"` : ""}…`;
    case "read_sample": return `reading sample ${str(input.class) ?? ""}…`;
    case "look": return "looking at the app…";
    case "act": {
      const event = str(input.event);
      const keys = input.values && typeof input.values === "object" ? Object.keys(input.values) : [];
      if (event && keys.length) return `trying the app: typing ${keys.length} value${keys.length === 1 ? "" : "s"}, then ${event.slice(0, 40)}…`;
      if (event) return `trying the app: pressing ${event.slice(0, 40)}…`;
      return keys.length ? `trying the app: typing ${keys.join(", ").slice(0, 60)}…` : "trying the app…";
    }
    default: return `${name}…`;
  }
}

// One Run, as the model reads it. Everything a person would look at after
// pressing Run, in the order they would look: did it start, what is wrong,
// what did the app put on the screen.
export function describeRun(report) {
  const lines = [];
  lines.push(`status: ${report.status}${report.started ? "" : " (the app did not start)"}`);

  // Errors and warnings must be fixed; hints are advice, and listed under
  // the same "must be fixed" a model spent whole turns on an unused public
  // attribute or a missing tooltip.
  const all = report.problems ?? [];
  const problems = all.filter((p) => p.severity === 1 || p.severity === 2);
  const hints = all.filter((p) => p.severity !== 1 && p.severity !== 2);
  const kind = (p) => (p.severity === 1 ? "error" : p.severity === 2 ? "warning" : "hint");
  const row = (p) => {
    const at = p.range?.start ? `${p.range.start.line + 1}:${p.range.start.character + 1}` : "?";
    return `- ${p.file}:${at} [${p.source} ${kind(p)}${p.rule ? ` ${p.rule}` : ""}] ${p.message}`;
  };
  if (problems.length === 0) {
    lines.push("problems: none");
  } else {
    lines.push(`problems (${problems.length}) - abaplint errors stop the run; abap2UI5 lint errors and warnings do not, but must be fixed:`);
    for (const p of problems.slice(0, 60)) lines.push(row(p));
  }
  if (hints.length > 0) {
    lines.push(`hints (${hints.length}) - advice, optional:`);
    for (const p of hints.slice(0, 15)) lines.push(row(p));
  }

  const tests = report.tests ?? [];
  if (tests.length > 0) {
    const failed = tests.filter((t) => !t.passed);
    lines.push(`unit tests: ${tests.length - failed.length} of ${tests.length} passed`);
    for (const t of failed.slice(0, 20)) {
      lines.push(`- FAILED ${t.testclass}->${t.method}: ${t.message}${t.expected ? ` (expected ${t.expected}, actual ${t.actual})` : ""}`);
    }
  }

  const first = report.roundtrips?.[0];
  if (first) {
    lines.push(`first roundtrip: HTTP ${first.status}${first.did?.length ? `, ${first.did.join(", ")}` : ""}`);
    if (first.status >= 400) {
      lines.push(`answer:\n${clip(String(first.response ?? ""), 4000)}`);
    }
    for (const view of first.views ?? []) {
      lines.push(`view rendered into slot ${view.slot}:\n${clip(view.xml, 4000)}`);
    }
  } else if (report.started && report.starting) {
    lines.push("first roundtrip: none yet - the app frame is still starting (UI5 is booting); this is not an error. Go on, or call run_app in a moment to read the first screen.");
  } else if (report.started) {
    lines.push("first roundtrip: none arrived within thirty seconds");
  }

  if (report.log?.body) lines.push(`log (${report.log.title}):\n${clip(report.log.body, 4000)}`);
  const summary = report.started
    ? `ran: ${report.status}${problems.length ? `, ${problems.length} problem${problems.length === 1 ? "" : "s"}` : ""}`
    : `run stopped: ${report.status}`;
  // `failed` draws the row as one that went wrong - a run that did not start
  // had the same ✓ as one that did.
  // `started` is the page's own word for it, so the chat need not read it
  // off the summary's text.
  return { text: lines.join("\n"), summary, failed: !report.started || (first?.status ?? 0) >= 400, started: Boolean(report.started) };
}

// ------------------------------------------------------------------ samples
//
// Over the catalogue this site publishes for its samples page - loaded and
// shaped by catalogueEntries( ) in ai-common.mjs, which the AI Pilot's
// find_apps reads too.

async function searchSamples(input) {
  const query = str(input.query)?.trim().toLowerCase();
  if (!query) return { error: "search_samples needs a query." };
  const { hits, all } = rankEntries(await catalogueEntries(), query);
  if (hits.length === 0) return { text: `No sample matches any of "${query}". Try a control name or another word.`, summary: `searched "${query}": nothing` };
  return {
    text: (all ? "" : `No sample has all of "${query}" - these have some of it:\n`) + hits
      .map((e) => `${e.class} - ${e.title}${e.summary ? `: ${e.summary}` : ""}${e.runs ? "" : " (does not run in the playground)"}${e.controls.length ? ` [${e.controls.slice(0, 8).join(", ")}]` : ""}`)
      .join("\n"),
    summary: `searched samples for "${query}"`,
  };
}

async function readSample(input) {
  const name = str(input.class)?.trim().toLowerCase();
  if (!name) return { error: "read_sample needs a class name." };
  const entry = (await catalogueEntries()).find((e) => e.class === name);
  if (!entry) return { error: `${name} is not in the sample catalogue - use search_samples first.` };
  const url = new URL(entry.raw);
  if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com") {
    return { error: `The source of ${name} is not on a host the playground reads from.` };
  }
  // Bounded, body and all, like every other fetch of a linked class
  // (deep-link.mjs): a host that never answered held the turn for good, and
  // Stop could not end it - the loop waits on the tool, not on the stream.
  let source;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return { error: `The source of ${name} could not be fetched (${response.status}).` };
    source = await response.text();
  } catch (e) {
    return {
      error: e?.name === "TimeoutError"
        ? `The source of ${name} did not arrive within 20 seconds.`
        : `The source of ${name} could not be fetched: ${String(e?.message ?? e)}`,
    };
  }
  // Long enough for any app the learning path has; the tail of a control
  // port is table data the model does not need to read to learn the pattern.
  return { text: clip(source, 12000), summary: `read sample ${name}` };
}
