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
import { addUsage, catalogueEntries, DEFAULT_SPEED, followStream, rankEntries, SPEEDS } from "./ai-common.mjs";
// The framework's own guide to building an app, from the abap2UI5 commit
// tools/fetch-deps.mjs pins - the same commit the runtime in this page is
// transpiled from, so the API the guide describes is the API that runs here.
import GUIDE from "../../deps/abap2ui5/docs/agents/building-apps.md";
import { parseName } from "../editor/files.mjs";
import { isUntouchedStarter } from "./ai-starter.mjs";
import { attachmentBlocks } from "./attachments.mjs";

// The speeds and the errors are the AI Pilot's as well (src/shell/ai-common.mjs).
export { SPEEDS, DEFAULT_SPEED, explainError } from "./ai-common.mjs";
// What the chat checks a file against as it is added (attach-ui.mjs).
export { kindOf, MAX_FILES, MAX_MESSAGE_BYTES } from "./attachments.mjs";

// The tools that change the editor, after which the page runs the app by
// itself (see loop( )).
const FILE_TOOLS = new Set(["write_file", "edit_file", "delete_file"]);

// What applies here and not in a real system - the guide is written for a
// project with abapGit, the linter on the command line and an SAP system
// behind it, and three of its four assumptions are not true in this page.
const PLAYGROUND_RULES = `You are the AI assistant of the abap2UI5 playground, a web page where a
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
  use edit_file for later changes of a few lines.
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
- Only these UI5 libraries are loaded: sap.m, sap.f, sap.ui.core,
  sap.ui.layout, sap.ui.table, sap.ui.unified, sap.tnt, sap.uxap,
  sap.ui.integration, sap.ui.codeeditor. OpenUI5 only - no sap.ui.comp,
  sap.suite, sap.viz. Hold the view to UI5 1.71.
- Build views with z2ui5_cl_ui5_view_builder as the guide below shows,
  never with the frozen z2ui5_cl_xml_view.
- The guide below covers the common patterns - write from it directly.
  Only when it does not cover what you need, search_samples finds a sample
  that does it and read_sample gives you its source.
- The editor may already hold code (a sample, or the person's own work).
  If the person asks for something new, write a new app class, make it the
  app and delete the files it does not need. If they ask for a change,
  change what is there.

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

const SYSTEM = [
  {
    type: "text",
    text: `${PLAYGROUND_RULES}\n\n<guide>\n${GUIDE}\n</guide>`,
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
      "Replace one passage of a file in the editor. old_text must occur exactly once in the file, " +
      "with its whitespace and line breaks as they are.",
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
    description: "The files in the editor as they are now, the app first. The person may have edited them by hand.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: {} },
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
const clip = (text, max = MAX_TOOL_TEXT) =>
  text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters cut)`;

// What the files are, as the model reads them.
const filesAsText = (files) =>
  files.map((f, i) => `=== ${f.name}${i === 0 ? " (the app)" : ""} ===\n${f.source}`).join("\n\n");

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
  // messages is told to it rather than discovered by a failed edit_file.
  let seen;
  let stream;
  let stopped = false;
  // Resolved by stop( ): a tool still running (a run waiting on its app, a
  // sample being fetched) is no longer waited for - Stop changed nothing
  // until it had ended on its own.
  let stopping;
  let stopNow = () => {};
  const untilStopped = (work, what) =>
    Promise.race([work, stopping.then(() => ({ error: `Stopped by the person while ${what}.` }))]);
  const total = { input: 0, output: 0, cached: 0 };

  const snapshot = () => JSON.stringify(host.files());

  // `files` are the File objects the reader added to this message; they go in
  // front of its text, as the content blocks attachments.mjs makes of them.
  async function send(text, files = []) {
    stopped = false;
    stopping = new Promise((resolve) => {
      stopNow = resolve;
    });
    const now = snapshot();
    const content = [];
    if (now !== seen) {
      content.push({
        type: "text",
        text: `<editor_files>\nThe editor holds these files right now:\n\n${filesAsText(host.files())}\n</editor_files>`,
      });
      seen = now;
    }
    if (files.length > 0) {
      const { blocks, errors } = await attachmentBlocks(files);
      for (const error of errors) ui.notice(error);
      content.push(...blocks);
    }
    content.push({ type: "text", text });
    messages.push({ role: "user", content });
    await loop();
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
        system: SYSTEM,
        tools: TOOLS,
        messages,
        output_config: { effort: settings.effort },
        // The reasoning stays hidden; the short notes the model writes between
        // tool calls ("the table is there, now the search") come back as text,
        // so a long turn is not minutes of silence.
        thinking: { type: "adaptive", display: "updates" },
        betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
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
        addUsage(total, stream.currentMessage?.usage);
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

      addUsage(total, message.usage);
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
        ui.tool({ id: use.id, summary: result.summary ?? result.error ?? "", error: Boolean(result.error || result.failed) });
        const entry = {
          type: "tool_result",
          tool_use_id: use.id,
          ...(result.error ? { is_error: true } : {}),
          content: clip(result.error ?? result.text),
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
        } catch (e) {
          report = { text: `The automatic run failed: ${String(e?.message ?? e)}`, summary: "run failed" };
        }
        ui.tool({ id, summary: report.summary, error: Boolean(report.failed) });
        lastChange.content = clip(`${lastChange.content}\n\nThe page ran the app after these changes:\n${report.text}`);
      }
      // Whatever the tools changed, the model has just been told - unless a
      // hand edit came in first, which the next user message has to carry.
      if (!untold) seen = afterTools;
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
        const files = host.files();
        return { text: filesAsText(files), summary: `read ${files.length} file${files.length === 1 ? "" : "s"}` };
      }
      case "run_app": return describeRun(await host.run());
      case "search_samples": return searchSamples(input);
      case "read_sample": return readSample(input);
      default: return { error: `There is no tool called ${name}.` };
    }
  }

  function writeFile(input) {
    const name = str(input.name)?.trim();
    const source = str(input.source);
    if (!name || source === undefined) return { error: "write_file needs a name and a source (both strings)." };
    if (!parseName(name)) {
      return { error: `${name} is not a file name the playground takes: <name>.clas.abap, <name>.intf.abap or <class>.clas.testclasses.abap, lower case.` };
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
    const parsed = parseName(name);
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
    const first = file.source.indexOf(oldText);
    if (first === -1) return { error: `old_text does not occur in ${name}. Call read_files to see the file as it is.` };
    if (file.source.indexOf(oldText, first + 1) !== -1) {
      return { error: `old_text occurs more than once in ${name} - include more of the surrounding lines.` };
    }
    const source = file.source.slice(0, first) + newText + file.source.slice(first + oldText.length);
    host.setFiles(files.map((f) => (f.name === name ? { name, source } : f)));
    host.show?.(name);
    return { text: `Edited ${name}.`, summary: `edited ${name}` };
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
    get usage() {
      return { ...total };
    },
  };
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
  } else if (report.started) {
    lines.push("first roundtrip: none arrived within ten seconds");
  }

  if (report.log?.body) lines.push(`log (${report.log.title}):\n${clip(report.log.body, 4000)}`);
  const summary = report.started
    ? `ran: ${report.status}${problems.length ? `, ${problems.length} problem${problems.length === 1 ? "" : "s"}` : ""}`
    : `run stopped: ${report.status}`;
  // `failed` draws the row as one that went wrong - a run that did not start
  // had the same ✓ as one that did.
  return { text: lines.join("\n"), summary, failed: !report.started || (first?.status ?? 0) >= 400 };
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
