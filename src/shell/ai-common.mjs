// What the site's two AI chats share - the AI Studio (src/shell/ai-agent.mjs)
// and the AI Pilot (src/shell/pilot-agent.mjs): which model answers at which
// speed, how a failed request is said, the turn loop around their tools
// (runTurnLoop) and the helpers both read a tool's input with. Both chunks import the Anthropic
// SDK, which esbuild therefore splits into a chunk of its own, and this goes
// with it; tools/build-site.mjs keeps all of it out of the service worker's
// precache, read off the module graph.
import Anthropic from "@anthropic-ai/sdk";
import { AgentError } from "../vendor/agent/appclient.mjs";
import { rawUrlOf } from "./catalogue-urls.mjs";
import { createProvider, explainOpenAIError, LLMAbortError, OpenAIError } from "./llm-provider.mjs";
// The SDK's own parser for a tool input that is still arriving - the one it
// runs itself on every delta while an `inputJson` listener is registered.
import { partialParse } from "@anthropic-ai/sdk/_vendor/partial-json-parser/parser.mjs";

// How much the reader trades speed for care - the chat header's select. The
// model is the reader's choice, not this page's: Balanced is the default and
// stays on Opus 5.5 at the effort that model defaults to; Thorough lets it
// think longer; Fast is Sonnet 5.5, which answers sooner.
export const SPEEDS = {
  thorough: { model: "claude-opus-5-5", effort: "high", label: "Thorough · Opus 5.5" },
  balanced: { model: "claude-opus-5-5", effort: "medium", label: "Balanced · Opus 5.5" },
  fast: { model: "claude-sonnet-5-5", effort: "medium", label: "Fast · Sonnet 5.5" },
};

// What a token costs, in dollars per million, from Anthropic's price list
// as of October 2026 - an estimate for the header, not a bill: a plan's
// rates, a cache write (a quarter more than fresh input) and a cache read
// (a tenth) are the parts that move. Kept here, in one place, so a price
// change is one edit.
export const PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};
export const DEFAULT_SPEED = "balanced";

/*
 * Old tool results are cleared by the API once a conversation is long - a
 * Pilot working through a list row by row read a screen per act, every one
 * resent with every request, until "the conversation has filled the model's
 * context" ended it. Server-side, so the history stays append-only and the
 * thinking blocks stay valid; late and in large steps, because each clear
 * costs the cache from that point (clear_at_least skips a clear that would
 * gain too little). The cleared results become a placeholder the model reads
 * as "removed" - a screen it needs again, it looks at again.
 */
export const CONTEXT_BETA = "context-management-2025-06-27";
// The inputs go too: in the studio a tool's INPUT is the whole class the
// model wrote, resent with every request for the rest of the conversation -
// ten rewrites of a 400-line class were 60,000 tokens of ballast that the
// results-only clear never touched. From 100,000 rather than 200,000, since
// the clear is what keeps a long build affordable, not only possible.
export const CONTEXT_MANAGEMENT = {
  edits: [{
    type: "clear_tool_uses_20250919",
    trigger: { type: "input_tokens", value: 100000 },
    keep: { type: "tool_uses", value: 10 },
    clear_at_least: { type: "input_tokens", value: 40000 },
    clear_tool_inputs: true,
  }],
};

// What every request of both chats to the Messages API carries beyond the
// conversation: the betas (the fallback, the thinking display, the context
// management above) and the clears. Handed to the Anthropic provider
// (llm-provider.mjs) with the SDK.
export const ANTHROPIC_REQUEST = {
  betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18", CONTEXT_BETA],
  context_management: CONTEXT_MANAGEMENT,
};

/**
 * The provider a conversation talks to (llm-provider.mjs): the Anthropic
 * Messages API through the SDK, or any OpenAI-compatible server - which one,
 * the base URL and the model name are what the key form saved, the key is
 * the one held in memory. The SDK is handed over here so that llm-provider.mjs,
 * which the key forms import into the shell, carries none of it.
 */
export const providerFor = (settings) => createProvider(settings, { Anthropic, request: ANTHROPIC_REQUEST });

/** The reader pressed Stop - whichever provider the request was on. */
export const isAbort = (err) => err instanceof Anthropic.APIUserAbortError || err instanceof LLMAbortError;

// A failed request, as the chat says it. `key` marks the one failure the
// reader answers by entering another key; everything else is said and the
// conversation stays where it was.
export function explainError(err) {
  if (err instanceof LLMAbortError) return { text: "Stopped.", stopped: true };
  if (err instanceof OpenAIError) return explainOpenAIError(err);
  if (err instanceof Anthropic.APIUserAbortError) return { text: "Stopped.", stopped: true };
  // A stream that broke off: the SDK says so in a plain AnthropicError (no
  // status), which fell through to its raw text.
  if (!(err instanceof Anthropic.APIError) && (err instanceof Anthropic.AnthropicError || err instanceof TypeError)
      && /network|Failed to fetch|ended without|Unexpected event order|terminated|aborted/i.test(String(err.message))) {
    return { text: "The connection to api.anthropic.com dropped mid-answer - check the connection and send again." };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { text: "The API key was not accepted. Enter a valid Anthropic API key.", key: true };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { text: `This key may not use the model - try another speed in the header, or another key: ${err.message}`, key: true };
  }
  if (err instanceof Anthropic.RateLimitError) return { text: "Rate limited - wait a moment and send again." };
  // Overloaded (529) or a server error: the SDK has already retried twice,
  // and "The API answered 529: Overloaded" said nothing about what to do.
  if (err instanceof Anthropic.APIError && (err.status === 529 || /overloaded/i.test(String(err.message)))) {
    return { text: "The model is overloaded right now - wait a minute and send again, or pick another speed in the header." };
  }
  if (err instanceof Anthropic.InternalServerError) {
    return { text: `api.anthropic.com had an error (${err.status ?? "5xx"}) - send again in a moment.` };
  }
  if (err instanceof Anthropic.BadRequestError && /anthropic-workspace-id/.test(err.message)) {
    return {
      text:
        "This key is not tied to a workspace, so the API needs to be told which one to use. Enter the workspace ID " +
        "(wrkspc_…, in the Console under Settings → Workspaces) in the key form - or create a key inside a workspace.",
      key: true,
      workspace: true,
    };
  }
  if (err instanceof Anthropic.APIError && err.status === 413) {
    return { text: "The request is too large for the API - the files of this message, with the conversation, are more than one request carries. Send fewer or smaller files, or start a New chat." };
  }
  if (err instanceof Anthropic.BadRequestError) return { text: `The request was refused: ${err.message}` };
  if (err instanceof Anthropic.APIConnectionError) {
    return { text: "api.anthropic.com could not be reached - check the connection, or whether a proxy or extension blocks it." };
  }
  if (err instanceof Anthropic.APIError) return { text: `The API answered ${err.status ?? "with an error"}: ${err.message}` };
  return { text: String(err?.message ?? err) };
}

// ------------------------------------------------------------ the helpers
//
// What both conversations do to a tool's input and to what it answers -
// written out once in each of them before, and once more in this file.

/** A string argument, or undefined for anything else the model sent. */
export const str = (v) => (typeof v === "string" ? v : undefined);

/** `text` cut at `max` characters, saying how much went. */
export const clip = (text, max) =>
  text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters cut)`;

/** An argument as an error or a chat row repeats it: at most 80 characters. */
export const echo = (v) => {
  const t = String(v);
  return t.length > 80 ? `${t.slice(0, 80)}...` : t;
};

/* row and max_rows: a whole number, or a string of digits - dropped without
 * a word, "2" left the client asking for the row that was sent. */
export function count(v, name) {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0) throw new AgentError(`${name} is a whole number, not ${echo(JSON.stringify(v))}`);
  return n;
}

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
    // The raw URL is built from the entry's path and its repository
    // (catalogue-urls.mjs); an entry that does not say where it is, is not
    // one the tools can read.
    .map((e) => ({ e, raw: typeof e.class === "string" ? rawUrlOf(e, data.sources) : undefined }))
    .filter(({ raw }) => typeof raw === "string")
    .map(({ e, raw }) => {
      const controls = (e.controls || []).map((i) => names[i]).filter(Boolean);
      return {
        class: e.class.toLowerCase(),
        title: str(e.title) ?? e.class,
        summary: str(e.summary) ?? str(e.note) ?? "",
        raw,
        runs: e.runs === true,
        controls,
        heading: `${e.title} ${e.class}`.toLowerCase(),
        haystack: `${e.title} ${e.note ?? ""} ${e.summary ?? ""} ${e.class} ${e.group ?? ""} ${(e.keywords || []).join(" ")} ${controls.join(" ")}`.toLowerCase(),
      };
    });
}

/** The catalogue's entries, shaped for the tools that search it - the
 *  studio's search_samples and read_sample, the Pilot's find_apps and
 *  open_app. */
// Shaped once: some 770 entries, each with its haystack built, were shaped
// again for every search_samples, read_sample, find_apps and open_app.
let shaped;
export async function catalogueEntries() {
  const data = await loadIndex();
  if (shaped?.data !== data) shaped = { data, entries: entriesOf(data) };
  return shaped.entries;
}

// ------------------------------------------------------------ the stream

/*
 * What a turn shows while it streams, for both chats: the answer's text, the
 * model's progress notes, and a row per tool call that reads what of its
 * input has arrived (`pendingText(name, input)`). Answers the tool calls
 * started, so a turn that is asked again can finish their rows.
 *
 * The tool input is parsed here, at most every DRAW_MS, rather than through
 * the SDK's `inputJson` event: with a listener registered the SDK parses the
 * whole input so far on EVERY delta - quadratic in a 500-line class, on the
 * page's main thread beside Monaco and the app - and a delta that left it
 * momentarily unparsable ended the whole stream ("Unable to parse tool
 * parameter JSON"), a billed request thrown away and asked again. Without a
 * listener it parses the input once, when the block is complete. A partial
 * input that does not parse here is simply not drawn yet.
 */
const DRAW_MS = 150;
export function followStream(stream, ui, pendingText) {
  const started = [];
  let streaming;
  let json = "";
  let drawn = 0;
  stream.on("text", (delta) => ui.text(delta));
  const draw = () => {
    let input;
    try {
      input = partialParse(json);
    } catch {
      return;
    }
    ui.toolPending({ id: streaming.id, text: pendingText(streaming.name, input ?? {}) });
  };
  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_stop") {
      // The block complete: what it ends on is drawn whatever the clock says.
      if (streaming && json) draw();
      streaming = undefined;
    } else if (event.type === "content_block_start") {
      const block = event.content_block;
      streaming = block.type === "tool_use" ? { id: block.id, name: block.name } : undefined;
      json = "";
      drawn = 0;
      if (block.type === "thinking") ui.thinkingStart();
      if (streaming) {
        started.push(streaming);
        ui.toolPending({ id: block.id, text: pendingText(block.name, {}) });
      }
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "thinking_delta" && event.delta.thinking) {
        ui.thinking(event.delta.thinking);
      } else if (event.delta.type === "input_json_delta" && streaming) {
        json += event.delta.partial_json ?? "";
        const now = performance.now();
        if (now - drawn < DRAW_MS) return;
        drawn = now;
        draw();
      }
    }
  });
  return started;
}

// ------------------------------------------------------------- the turn

const CONTEXT_FULL = "The conversation has filled the model's context - New chat starts a fresh one.";

/*
 * One turn of a conversation, for both chats: a request, its answer drawn as
 * it streams, the tool calls of the answer run - and again, until the model
 * answers without a tool call, declines, runs out of room, or Stop is
 * pressed. What the two do with the tool calls is theirs (`runTools`); what
 * happens around them is the same, and was written twice:
 *
 *   provider, messages, total, ui, speed    the conversation's own (`messages`
 *                                           is only ever appended to)
 *   request()       { system, tools, maxTokens } for the next request
 *   pendingText     a tool call's row while its input streams (followStream)
 *   halted()        whether Stop was pressed
 *   onStream(s)     the request under way, for stop( ) to abort
 *   runTools(uses)  the answer's tool calls run, answering their tool_results
 *   cutText         what a call cut off at max_tokens is answered
 *   fullText        when given, a full context window is said apart: every
 *                   call "not run" with this, rather than as a cut one
 *   askSmaller      when given, said after the first cut before asking again
 *   maxRounds       when given, the rounds of tool calls one message may
 *                   take before the turn ends and the reader is asked
 *   afterTools()    when given, asked after every round: a sentence ends
 *                   the turn and is said in the chat (a model going round
 *                   in circles - ai-agent.mjs, stuckOn( ))
 *
 * A turn ended by either is ended the way Stop ends one between two rounds:
 * the results are in the conversation, and the reader's next message goes on
 * from there.
 */
export async function runTurnLoop({ provider, messages, total, ui, speed, request, pendingText, halted, onStream, runTools, cutText, fullText, askSmaller, maxRounds, afterTools }) {
  let jsonRetries = 0;
  // Answers in a row cut off at max_tokens with a tool call in them. Each
  // one is a full, billed request, and thinking counts towards the limit:
  // a long think before a large write could be cut on every attempt, and
  // the loop asked again without end until Stop was pressed.
  let cuts = 0;
  // Rounds of tool calls in this turn. Nothing else ends a turn whose model
  // keeps calling tools - and every round is a billed request, the whole
  // conversation read again.
  let rounds = 0;
  while (!halted()) {
    ui.assistantStart();
    const settings = SPEEDS[speed()] ?? SPEEDS[DEFAULT_SPEED];
    const model = provider.modelFor(settings);
    const { system, tools, maxTokens } = request();
    // The request's shape - the thinking display, the fallback, the cache
    // breakpoint, the betas - is the provider's (llm-provider.mjs).
    const stream = provider.stream({ system, tools, messages, maxTokens, speed: settings });
    onStream(stream);
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
      addUsage(total, stream.currentMessage?.usage, model);
      ui.usage({ ...total });
      if (halted()) return;
      // A tool input that could not be parsed at all - the one failure that
      // is worth re-asking for. Everything the API itself refused (a key,
      // a rate limit, an overload) goes to the chat as it is.
      //
      // Only that: a stream whose connection dropped half way is a plain
      // AnthropicError as well, and every such drop was sent again twice -
      // three billed requests, attachments and all, three half answers in
      // the chat, then a bare "network error". Recognised by the SDK's own
      // message for it.
      const unparsable = /Unable to parse tool parameter JSON/.test(String(err?.message ?? ""));
      if (!unparsable || provider.isApiError(err) || jsonRetries++ >= 2) throw err;
      // The calls of the attempt thrown away are not going to run: asked
      // again, they come back under new ids, and the old rows went on
      // shimmering until the turn ended and then said "not finished".
      for (const s of started) ui.tool({ id: s.id, summary: `${s.name}: the input was unreadable - asked again`, error: true });
      continue;
    }

    addUsage(total, message.usage, message.model ?? model);
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
    // valid one - a file one method short, an act one value fewer.
    const full = message.stop_reason === "model_context_window_exceeded";
    const cut = message.stop_reason === "max_tokens" || full;
    messages.push({ role: "assistant", content: message.content });
    if (uses.length === 0) {
      if (full) ui.notice(CONTEXT_FULL);
      else if (cut) ui.notice("The answer was cut off - it ran out of room.");
      return;
    }
    if (full && fullText) {
      // Asking again would only overflow again; nothing is run.
      messages.push({
        role: "user",
        content: uses.map((u) => {
          ui.tool({ id: u.id, summary: `not run: ${u.name}`, error: true });
          return { type: "tool_result", tool_use_id: u.id, is_error: true, content: fullText };
        }),
      });
      ui.notice(CONTEXT_FULL);
      return;
    }
    if (cut) {
      // Never run: the turn says why, and the model is asked for less.
      messages.push({
        role: "user",
        content: uses.map((u) => {
          // The row drawn while the input streamed is finished here, or it
          // would go on shimmering as if the call were still running.
          ui.tool({ id: u.id, summary: `not run: ${u.name} (cut off)`, error: true });
          return { type: "tool_result", tool_use_id: u.id, is_error: true, content: cutText };
        }),
      });
      if (full || ++cuts >= 2) {
        ui.notice(full ? CONTEXT_FULL : "The answer ran out of room twice in a row - ask for a smaller step, or New chat.");
        return;
      }
      if (askSmaller) ui.notice(askSmaller);
      continue;
    }
    cuts = 0;

    // All results in one message - split across several, the model learns
    // to stop making parallel calls.
    messages.push({ role: "user", content: await runTools(uses) });
    rounds += 1;
    if (halted()) return;
    const why = afterTools?.();
    if (why) {
      ui.notice(why);
      return;
    }
    if (maxRounds && rounds >= maxRounds) {
      ui.notice(`Stopped after ${rounds} steps in one message - a turn that long is usually going round in circles. Say "go on" to continue, or what to do differently.`);
      return;
    }
  }
}

/** Adds one answer's usage to `total` ({ input, output, cached, written,
 *  dollars }): `input` is what was read fresh plus what was written to the
 *  cache, `written` that second part on its own, `cached` what was read from
 *  the cache, `dollars` the estimate for all of it at `model`'s prices. */
export function addUsage(total, usage = {}, model) {
  const fresh = usage.input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  const cached = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  total.input += fresh + written;
  total.written = (total.written ?? 0) + written;
  total.cached += cached;
  total.output += output;
  // `model` is the answer's own (a fallback model is billed as itself).
  const price = PRICES[model];
  if (price) {
    total.dollars = (total.dollars ?? 0) +
      (fresh * price.input + written * price.cacheWrite + cached * price.cacheRead + output * price.output) / 1e6;
  }
}

/** The usage line and its tooltip, for both chats' headers. */
export function usageText({ input, output, cached, written = 0, dollars }) {
  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const cost = dollars === undefined ? "" : ` · ≈ $${dollars < 0.01 && dollars > 0 ? "0.01" : dollars.toFixed(2)}`;
  return {
    text: `${k(input + cached)} in · ${k(output)} out${cost}`,
    title:
      `${input - written} input tokens read fresh, ${written} written to the cache, ${cached} read from the cache, ` +
      `${output} output tokens${dollars === undefined ? "" : ` - about $${dollars.toFixed(3)} at the list prices of October 2026`}; ` +
      "billed to your key at your plan's rates",
  };
}

/*
 * The catalogue entries best matching a query of a few words, for
 * search_samples and find_apps. Every word that occurs counts, the title and
 * class twice; a word ending in "s" counts in the singular too ("popups"
 * finds "popup"). Answers { hits, all } - `all` whether the best ones carry
 * every word. Requiring every word, a query of three keywords with one of
 * them off ("table filter excel") found nothing at all, and the model spent
 * a whole turn on "Try one word".
 */
export function rankEntries(entries, query, max = 8) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const forms = words.map((w) => (w.length > 3 && w.endsWith("s") ? [w, w.slice(0, -1)] : [w]));
  const scored = [];
  for (const e of entries) {
    let found = 0;
    let score = 0;
    for (const variants of forms) {
      if (variants.some((v) => e.heading.includes(v))) {
        found += 1;
        score += 2;
      } else if (variants.some((v) => e.haystack.includes(v))) {
        found += 1;
        score += 1;
      }
    }
    if (found > 0) scored.push({ e, found, score: score + (e.runs ? 0.5 : 0) });
  }
  scored.sort((a, b) => b.found - a.found || b.score - a.score);
  const hits = scored.slice(0, max);
  return { hits: hits.map((s) => s.e), all: hits.length > 0 && hits[0].found === words.length };
}
