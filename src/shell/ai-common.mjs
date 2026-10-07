// What the site's two AI chats share - the AI Studio (src/shell/ai-agent.mjs)
// and the AI Pilot (src/shell/pilot-agent.mjs): which model answers at which
// speed, and how a failed request is said. Both chunks import the Anthropic
// SDK, which esbuild therefore splits into a chunk of its own, and this goes
// with it; tools/build-site.mjs keeps all of it out of the service worker's
// precache, read off the module graph.
import Anthropic from "@anthropic-ai/sdk";
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
export const DEFAULT_SPEED = "balanced";

// A failed request, as the chat says it. `key` marks the one failure the
// reader answers by entering another key; everything else is said and the
// conversation stays where it was.
export function explainError(err) {
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
  if (err instanceof Anthropic.BadRequestError) return { text: `The request was refused: ${err.message}` };
  if (err instanceof Anthropic.APIConnectionError) {
    return { text: "api.anthropic.com could not be reached - check the connection, or whether a proxy or extension blocks it." };
  }
  if (err instanceof Anthropic.APIError) return { text: `The API answered ${err.status ?? "with an error"}: ${err.message}` };
  return { text: String(err?.message ?? err) };
}

// The catalogue this site already publishes for its samples page and the
// samples browser - same origin, so the service worker has it after a first
// visit. The source of a sample comes from raw.githubusercontent.com, the
// host ?src= links already read from.

const str = (v) => (typeof v === "string" ? v : undefined);

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

/** Adds one answer's usage to `total` ({ input, output, cached }). */
export function addUsage(total, usage = {}) {
  total.input += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  total.cached += usage.cache_read_input_tokens ?? 0;
  total.output += usage.output_tokens ?? 0;
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
