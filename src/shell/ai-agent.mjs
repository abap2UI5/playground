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
// The framework's own guide to building an app, from the abap2UI5 commit
// tools/fetch-deps.mjs pins - the same commit the runtime in this page is
// transpiled from, so the API the guide describes is the API that runs here.
import GUIDE from "../../deps/abap2ui5/docs/agents/building-apps.md";
import { parseName } from "../editor/files.mjs";

export const MODEL = "claude-opus-5-5";

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
  are what they take home. Use edit_file for small changes and write_file
  for new files or rewrites.
- After every change, call run_app and read what it reports: abaplint
  errors block the run and must be fixed; abap2UI5 lint findings mean the
  view uses something UI5 1.71 does not have - fix those too; a dump names
  the line. Iterate until it runs clean, then stop calling tools.
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
- When unsure how abap2UI5 does something, search_samples finds a sample
  that does it and read_sample gives you its source. Prefer a pattern from
  a sample over inventing one.
- The editor may already hold code (a sample, or the person's own work).
  If the person asks for something new, write a new app class, make it the
  app and delete the files it does not need. If they ask for a change,
  change what is there.

Talking to the person:
- Answer in the language the person writes in.
- Keep messages short: what you built or changed, in a sentence or two, and
  anything the app does not do yet. They can read the code in the editor.
- When the app is done, tell them they can download it for abapGit with
  the button above the chat.

The abap2UI5 guide to building apps follows. Its sections on validation
tooling (npm scripts, the MCP server, screenshots) do not apply here: in
this page, run_app is your validation.`;

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
      "Press Run: check the ABAP, compile it, run the unit tests and start the app. Answers with the status, " +
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
 *   ui.assistantStart()  ui.text(delta)  ui.tool({ name, summary, error })
 *   ui.usage({ input, output, cached })  ui.notice(text)
 */
export function createAgent({ apiKey, workspace, host, ui }) {
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
  const total = { input: 0, output: 0, cached: 0 };

  const snapshot = () => JSON.stringify(host.files());

  async function send(text) {
    stopped = false;
    const now = snapshot();
    const content = [];
    if (now !== seen) {
      content.push({
        type: "text",
        text: `<editor_files>\nThe editor holds these files right now:\n\n${filesAsText(host.files())}\n</editor_files>`,
      });
      seen = now;
    }
    content.push({ type: "text", text });
    messages.push({ role: "user", content });
    await loop();
    // Answered so the chat can say "stopped" rather than "done".
    return { stopped };
  }

  async function loop() {
    let jsonRetries = 0;
    while (!stopped) {
      ui.assistantStart();
      stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        system: SYSTEM,
        tools: TOOLS,
        messages,
        output_config: { effort: "high" },
        // A request a safety classifier declines is answered by the model
        // the API picks for that category instead of stopping the turn.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // The conversation so far, cached up to its last block: every turn of
        // a tool loop resends all of it.
        cache_control: { type: "ephemeral" },
      });
      stream.on("text", (delta) => ui.text(delta));

      let message;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (stopped) return;
        // A tool input that could not be parsed at all - the one failure that
        // is worth re-asking for. Everything the API itself refused (a key,
        // a rate limit, an overload) goes to the chat as it is.
        if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIUserAbortError || jsonRetries++ >= 2) {
          throw err;
        }
        continue;
      }

      const usage = message.usage ?? {};
      total.input += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      total.cached += usage.cache_read_input_tokens ?? 0;
      total.output += usage.output_tokens ?? 0;
      ui.usage({ ...total });

      if (message.stop_reason === "refusal") {
        messages.push({ role: "assistant", content: message.content });
        ui.notice("The model declined this request.");
        return;
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      const uses = message.content.filter((b) => b.type === "tool_use");
      if (uses.length === 0) {
        messages.push({ role: "assistant", content: message.content });
        if (message.stop_reason === "max_tokens") ui.notice("The answer was cut off - it ran out of room.");
        return;
      }
      if (message.stop_reason === "max_tokens") {
        // A file cut off half way would parse as a shorter, valid file. Never
        // write it; the turn ends and says why.
        messages.push({ role: "assistant", content: message.content });
        messages.push({
          role: "user",
          content: uses.map((u) => ({
            type: "tool_result",
            tool_use_id: u.id,
            is_error: true,
            content: "Not run: the answer hit max_tokens and this input may be cut off. Write smaller pieces (edit_file).",
          })),
        });
        ui.notice("The answer ran out of room before a tool call was complete - asking for smaller steps.");
        continue;
      }

      messages.push({ role: "assistant", content: message.content });
      const results = [];
      for (const use of uses) {
        if (stopped) {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Stopped by the user." });
          continue;
        }
        let result;
        try {
          result = await execute(use.name, use.input ?? {});
        } catch (e) {
          result = { error: String(e?.message ?? e) };
        }
        ui.tool({ name: use.name, summary: result.summary ?? result.error ?? "", error: Boolean(result.error) });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          ...(result.error ? { is_error: true } : {}),
          content: clip(result.error ?? result.text),
        });
      }
      // Whatever the tools changed, the model has just been told.
      seen = snapshot();
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
    const oldText = str(input.old_text);
    const newText = str(input.new_text);
    if (!name || oldText === undefined || newText === undefined) {
      return { error: "edit_file needs name, old_text and new_text (all strings)." };
    }
    const files = host.files();
    const file = files.find((f) => f.name === name);
    if (!file) return { error: `There is no file ${name} in the editor. Open files: ${files.map((f) => f.name).join(", ")}.` };
    if (oldText === "") return { error: "old_text is empty - use write_file to replace a whole file." };
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
      stream?.abort();
    },
    get usage() {
      return { ...total };
    },
  };
}

// A failed request, as the chat says it. `key` marks the one failure the
// reader answers by entering another key; everything else is said and the
// conversation stays where it was.
export function explainError(err) {
  if (err instanceof Anthropic.APIUserAbortError) return { text: "Stopped.", stopped: true };
  if (err instanceof Anthropic.AuthenticationError) {
    return { text: "The API key was not accepted. Enter a valid Anthropic API key.", key: true };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { text: `This key may not use ${MODEL}: ${err.message}`, key: true };
  }
  if (err instanceof Anthropic.RateLimitError) return { text: "Rate limited - wait a moment and send again." };
  if (err instanceof Anthropic.BadRequestError && /anthropic-workspace-id/.test(err.message)) {
    return {
      text:
        "This key is not tied to a workspace, so the API needs to be told which one to use. Enter the workspace ID " +
        "(wrkspc_…, in the Console under Settings → Workspaces) in the key form - or create a key inside a workspace.",
      key: true,
      workspace: true,
    };
  }
  if (err instanceof Anthropic.BadRequestError) return { text: `The request was refused: ${err.message}` };
  if (err instanceof Anthropic.APIConnectionError) {
    return { text: "api.anthropic.com could not be reached - check the connection, or whether a proxy or extension blocks it." };
  }
  if (err instanceof Anthropic.APIError) return { text: `The API answered ${err.status ?? "with an error"}: ${err.message}` };
  return { text: String(err?.message ?? err) };
}

// One Run, as the model reads it. Everything a person would look at after
// pressing Run, in the order they would look: did it start, what is wrong,
// what did the app put on the screen.
export function describeRun(report) {
  const lines = [];
  lines.push(`status: ${report.status}${report.started ? "" : " (the app did not start)"}`);

  const problems = report.problems ?? [];
  const kind = (p) => (p.severity === 1 ? "error" : p.severity === 2 ? "warning" : "info");
  if (problems.length === 0) {
    lines.push("problems: none");
  } else {
    lines.push(`problems (${problems.length}) - abaplint errors stop the run, abap2UI5 lint findings do not but must be fixed:`);
    for (const p of problems.slice(0, 60)) {
      const at = p.range?.start ? `${p.range.start.line + 1}:${p.range.start.character + 1}` : "?";
      lines.push(`- ${p.file}:${at} [${p.source} ${kind(p)}${p.rule ? ` ${p.rule}` : ""}] ${p.message}`);
    }
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
      lines.push(`view rendered into slot ${view.slot}:\n${clip(view.xml, 8000)}`);
    }
  } else if (report.started) {
    lines.push("first roundtrip: none arrived within ten seconds");
  }

  if (report.log?.body) lines.push(`log (${report.log.title}):\n${clip(report.log.body, 4000)}`);
  const summary = report.started
    ? `ran: ${report.status}${problems.length ? `, ${problems.length} problem${problems.length === 1 ? "" : "s"}` : ""}`
    : `run stopped: ${report.status}`;
  return { text: lines.join("\n"), summary };
}

// ------------------------------------------------------------------ samples
//
// The catalogue this site already publishes for its samples page and the
// samples browser - same origin, so the service worker has it after a first
// visit. The source of a sample comes from raw.githubusercontent.com, the
// host ?src= links already read from.

let index;
async function loadIndex() {
  if (!index) {
    index = fetch("samples/apps.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`samples/apps.json answered ${r.status}`))))
      .catch((e) => {
        index = undefined;
        throw e;
      });
  }
  return index;
}

function entriesOf(data) {
  const names = data.controls || [];
  return (data.entries || [])
    .filter((e) => typeof e.raw === "string" && typeof e.class === "string")
    .map((e) => {
      const controls = (e.controls || []).map((i) => names[i]).filter(Boolean);
      return {
        class: e.class.toLowerCase(),
        title: str(e.title) ?? e.class,
        summary: str(e.summary) ?? str(e.note) ?? "",
        raw: e.raw,
        runs: e.runs === true,
        controls,
        haystack: `${e.title} ${e.note ?? ""} ${e.summary ?? ""} ${e.class} ${e.group ?? ""} ${(e.keywords || []).join(" ")} ${controls.join(" ")}`.toLowerCase(),
      };
    });
}

async function searchSamples(input) {
  const query = str(input.query)?.trim().toLowerCase();
  if (!query) return { error: "search_samples needs a query." };
  const entries = entriesOf(await loadIndex());
  const words = query.split(/\s+/).filter(Boolean);
  const scored = entries
    .map((e) => ({ e, score: words.reduce((n, w) => n + (e.haystack.includes(w) ? 1 : 0), 0) + (e.runs ? 0.5 : 0) }))
    .filter((s) => s.score >= Math.max(1, words.length))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  if (scored.length === 0) return { text: `No sample matches "${query}". Try one word.`, summary: `searched "${query}": nothing` };
  return {
    text: scored
      .map(({ e }) => `${e.class} - ${e.title}${e.summary ? `: ${e.summary}` : ""}${e.runs ? "" : " (does not run in the playground)"}${e.controls.length ? ` [${e.controls.slice(0, 8).join(", ")}]` : ""}`)
      .join("\n"),
    summary: `searched samples for "${query}"`,
  };
}

async function readSample(input) {
  const name = str(input.class)?.trim().toLowerCase();
  if (!name) return { error: "read_sample needs a class name." };
  const entry = entriesOf(await loadIndex()).find((e) => e.class === name);
  if (!entry) return { error: `${name} is not in the sample catalogue - use search_samples first.` };
  const url = new URL(entry.raw);
  if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com") {
    return { error: `The source of ${name} is not on a host the playground reads from.` };
  }
  const response = await fetch(url);
  if (!response.ok) return { error: `The source of ${name} could not be fetched (${response.status}).` };
  return { text: clip(await response.text(), 30000), summary: `read sample ${name}` };
}
