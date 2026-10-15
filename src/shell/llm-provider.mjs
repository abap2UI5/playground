// Which model API answers the two AI chats - the AI Studio (ai-agent.mjs) and
// the AI Pilot (pilot-agent.mjs) - and how.
//
// Both conversations are kept in the shape of the Anthropic Messages API: an
// append-only list of messages whose content is blocks (text, tool_use,
// tool_result, image, document), answered by a message with blocks, a
// stop_reason and a usage. That shape is the agent loop's protocol and it
// does not change here. A provider is what turns one request of it into a
// call to some API and the answer back into that shape:
//
//   - `anthropic` is the Messages API through the Anthropic SDK, exactly as
//     it was before this module existed - the betas, the cache breakpoints,
//     the server-side fallback, the thinking display, all unchanged.
//   - `openai` is any server speaking OpenAI's Chat Completions - OpenAI
//     itself, Azure OpenAI, Ollama, LM Studio, vLLM - reached with fetch( )
//     and a bearer key: the system prompt as the first message, the tools in
//     function-calling format, the model's tool_calls mapped back to tool_use
//     blocks and the loop's tool_result blocks mapped to `tool` messages,
//     images as image_url parts, PDFs as file parts. Streamed over SSE, and
//     the stream translated into the Messages API's own events, so
//     followStream( ) in ai-common.mjs draws both the same.
//
// The key is never in this module's storage. Both chats hold it in memory
// for the visit (chat.mjs and pilot.mjs say why: a shared link's ABAP runs
// in this origin and can read localStorage). What IS remembered between
// visits is the provider, the base URL and the model name - none of which
// opens an account.
//
// This module imports no SDK: chat.mjs and pilot.mjs read the settings from
// it for their key form, and the Anthropic SDK stays in the agents' chunk.
// createProvider( ) takes the SDK as an argument for the same reason.
import { readStoredJson, writeStoredJson, removeStored } from "./storage.mjs";

export const PROVIDERS = {
  anthropic: {
    label: "Anthropic",
    keyPlaceholder: "sk-ant-…",
    keyLabel: "Your Anthropic API key",
    keyOptional: false,
  },
  openai: {
    label: "OpenAI-compatible",
    baseUrl: "https://api.openai.com/v1",
    // The model name is the reader's: a free field, this is only what it
    // starts on. A local server names its own models.
    model: "gpt-5",
    keyPlaceholder: "sk-… (optional for a local server)",
    keyLabel: "API key",
    keyOptional: true,
  },
};
export const DEFAULT_PROVIDER = "anthropic";

// Base URLs the form offers as examples; the reader types any other.
export const BASE_URL_EXAMPLES = [
  { url: "https://api.openai.com/v1", label: "OpenAI" },
  { url: "https://<resource>.openai.azure.com/openai/v1", label: "Azure OpenAI" },
  { url: "http://localhost:11434/v1", label: "Ollama" },
  { url: "http://localhost:1234/v1", label: "LM Studio" },
];

// The provider, base URL and model - never the key. One key for both chats:
// a reader who set up a local server in the studio has it in the Pilot too.
export const SETTINGS_KEY = "abap2ui5-playground:llm";

/** What the form last saved, completed with the defaults; the default
 *  provider when nothing is stored or what is stored makes no sense. */
export function readProviderSettings(stored = readStoredJson(SETTINGS_KEY)) {
  const provider = PROVIDERS[stored?.provider] ? stored.provider : DEFAULT_PROVIDER;
  if (provider === "anthropic") return { provider };
  const defaults = PROVIDERS.openai;
  return {
    provider,
    baseUrl: normaliseBaseUrl(typeof stored?.baseUrl === "string" ? stored.baseUrl : "") || defaults.baseUrl,
    model: (typeof stored?.model === "string" ? stored.model.trim() : "") || defaults.model,
  };
}

/** Keeps the settings; the default provider on its own is forgotten rather
 *  than stored, the rule the page's other preferences follow. */
export function writeProviderSettings(settings) {
  const clean = readProviderSettings(settings);
  if (clean.provider === DEFAULT_PROVIDER) return removeStored(SETTINGS_KEY);
  return writeStoredJson(SETTINGS_KEY, clean);
}

/** The base URL without its trailing slash (and without /chat/completions,
 *  which somebody pasting from a curl example brings along). */
export function normaliseBaseUrl(url) {
  return String(url ?? "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}

export const chatCompletionsUrl = (baseUrl) => `${normaliseBaseUrl(baseUrl)}/chat/completions`;

// ------------------------------------------------ the shapes, both ways

const asText = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b?.type === "text" ? b.text : b?.type === "image" ? "[image]" : ""))
    .filter(Boolean)
    .join("\n");
};

/** The system prompt, as the first message. The Messages API takes it as a
 *  string or as text blocks (with cache breakpoints, which have no
 *  counterpart here). */
export function systemText(system) {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system.map((b) => b.text ?? "").filter(Boolean).join("\n\n");
}

// One content block of a user message, as a Chat Completions content part.
// A text document goes as text under its title; a PDF as a file part (the
// shape OpenAI takes - a server that cannot read one says so); an image as a
// data URL.
function userPart(block) {
  switch (block?.type) {
    case "text":
      return { type: "text", text: block.text };
    case "image": {
      const src = block.source ?? {};
      const url = src.type === "url" ? src.url : `data:${src.media_type};base64,${src.data}`;
      return { type: "image_url", image_url: { url } };
    }
    case "document": {
      const src = block.source ?? {};
      const title = block.title ?? "document";
      if (src.type === "text") return { type: "text", text: `<document title="${title}">\n${src.data}\n</document>` };
      if (src.type === "base64") {
        return { type: "file", file: { filename: title, file_data: `data:${src.media_type};base64,${src.data}` } };
      }
      if (src.type === "url") return { type: "file", file: { filename: title, file_data: src.url } };
      return { type: "text", text: `<document title="${title}">(not readable here)</document>` };
    }
    default:
      return undefined;
  }
}

/**
 * The conversation as Chat Completions takes it: the system prompt first,
 * then each message - a user message's tool_result blocks as `tool`
 * messages (which must follow the assistant's tool_calls directly, so they
 * go first), the rest of its blocks as one user message with content
 * parts; an assistant message's text as content and its tool_use blocks as
 * tool_calls, its thinking blocks left out.
 */
export function toOpenAIMessages(system, messages) {
  const out = [];
  const sys = systemText(system);
  if (sys) out.push({ role: "system", content: sys });
  for (const message of messages) {
    if (message.role === "assistant") {
      const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      const calls = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      const entry = { role: "assistant", content: text || null };
      if (calls.length > 0) entry.tool_calls = calls;
      out.push(entry);
      continue;
    }
    if (message.role !== "user") continue;
    if (typeof message.content === "string") {
      out.push({ role: "user", content: message.content });
      continue;
    }
    const parts = [];
    for (const block of message.content) {
      if (block.type === "tool_result") {
        const text = asText(block.content);
        out.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          // An error is said to the model as such: Chat Completions has no
          // is_error, and a result that reads like a success is acted on
          // like one.
          content: block.is_error ? `Error: ${text || "the tool failed"}` : text,
        });
        continue;
      }
      const part = userPart(block);
      if (part) parts.push(part);
    }
    if (parts.length === 0) continue;
    // Plain text stays a string: every server takes that, and not every
    // local one takes an array of parts for text alone.
    out.push({
      role: "user",
      content: parts.every((p) => p.type === "text") ? parts.map((p) => p.text).join("\n\n") : parts,
    });
  }
  return out;
}

/** The tools in function-calling format. */
export function toOpenAITools(tools = []) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.input_schema ?? { type: "object", properties: {} },
    },
  }));
}

/** A function's arguments as the tool's input. Empty arguments are an empty
 *  input; anything that does not parse throws with the SDK's own words for
 *  it, which is what the agent loop re-asks on. */
export function parseArguments(text) {
  const raw = (text ?? "").trim();
  if (raw === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Unable to parse tool parameter JSON: ${raw.slice(0, 80)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Unable to parse tool parameter JSON: not an object");
  }
  return parsed;
}

const STOP_REASONS = { tool_calls: "tool_use", function_call: "tool_use", length: "max_tokens", content_filter: "refusal" };
export const stopReasonOf = (finishReason, hasTools) =>
  STOP_REASONS[finishReason] ?? (hasTools ? "tool_use" : "end_turn");

/** One Chat Completions assistant message (as a non-streamed choice carries
 *  it) as Messages API blocks. */
export function fromOpenAIAssistant(message) {
  const blocks = [];
  if (typeof message?.content === "string" && message.content !== "") blocks.push({ type: "text", text: message.content });
  else if (Array.isArray(message?.content)) {
    for (const part of message.content) if (part?.type === "text" && part.text) blocks.push({ type: "text", text: part.text });
  }
  for (const [i, call] of (message?.tool_calls ?? []).entries()) {
    blocks.push({
      type: "tool_use",
      id: call.id ?? `call_${i}`,
      name: call.function?.name ?? "",
      input: parseArguments(call.function?.arguments),
    });
  }
  return blocks;
}

/**
 * The other direction, for a conversation that arrives in Chat Completions
 * shape: `tool` messages become tool_result blocks of one user message,
 * `assistant` tool_calls tool_use blocks, the system message the system
 * prompt. toOpenAIMessages( ) of the result is the input again, which is
 * what the tests hold.
 */
export function fromOpenAIMessages(messages) {
  let system;
  const out = [];
  const last = () => out[out.length - 1];
  for (const message of messages) {
    if (message.role === "system") {
      system = (system ? `${system}\n\n` : "") + asText(message.content);
    } else if (message.role === "assistant") {
      out.push({ role: "assistant", content: fromOpenAIAssistant(message) });
    } else if (message.role === "tool") {
      const text = typeof message.content === "string" ? message.content : asText(message.content);
      const block = /^Error: /.test(text)
        ? { type: "tool_result", tool_use_id: message.tool_call_id, is_error: true, content: text.replace(/^Error: /, "") }
        : { type: "tool_result", tool_use_id: message.tool_call_id, content: text };
      // Results of one answer's calls are one user message, as the loop
      // sends them; a result after a user's text starts another.
      const tail = last();
      if (tail?.role === "user" && Array.isArray(tail.content) && tail.content.every((b) => b.type === "tool_result")) {
        tail.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    } else if (message.role === "user") {
      const parts = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
      const blocks = parts.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "image_url") {
          const m = /^data:([^;]+);base64,(.*)$/s.exec(part.image_url?.url ?? "");
          return m
            ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }
            : { type: "image", source: { type: "url", url: part.image_url?.url } };
        }
        if (part.type === "file") {
          const m = /^data:([^;]+);base64,(.*)$/s.exec(part.file?.file_data ?? "");
          return m
            ? { type: "document", title: part.file?.filename, source: { type: "base64", media_type: m[1], data: m[2] } }
            : { type: "document", title: part.file?.filename, source: { type: "url", url: part.file?.file_data } };
        }
        return { type: "text", text: asText([part]) };
      });
      out.push({ role: "user", content: blocks });
    }
  }
  return { system, messages: out };
}

/** The answer's usage in the Messages API's fields. Chat Completions counts
 *  the cached part inside prompt_tokens; the Messages API beside it. */
export function usageOf(usage) {
  if (!usage) return undefined;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input_tokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
    output_tokens: usage.completion_tokens ?? 0,
  };
}

// ------------------------------------------------------------ the errors

/** A request the server refused, or one that never reached it. `status` is
 *  the HTTP status, or undefined for a connection that failed. */
export class OpenAIError extends Error {
  constructor(message, { status, host, code } = {}) {
    super(message);
    this.name = "OpenAIError";
    this.status = status;
    this.host = host;
    this.code = code;
  }
}

/** The reader pressed Stop. */
export class LLMAbortError extends Error {
  constructor() {
    super("Request was aborted.");
    this.name = "LLMAbortError";
  }
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** A failed Chat Completions request, as the chat says it - the shape
 *  explainError( ) in ai-common.mjs answers with. */
export function explainOpenAIError(err) {
  const host = err.host ?? "the server";
  if (err.status === undefined) {
    return {
      text:
        `${host} could not be reached from the browser. Check the base URL and that the server is running - and that it ` +
        "allows this page: Ollama needs OLLAMA_ORIGINS set to this site (or *) before it starts, LM Studio has CORS in its " +
        "server settings, and a proxy or an extension may be blocking it.",
    };
  }
  if (err.status === 401) return { text: `${host} did not accept the API key: ${err.message}`, key: true };
  if (err.status === 403) return { text: `${host} refused this key for the model: ${err.message}`, key: true };
  if (err.status === 404) {
    return {
      text: `${host} answered 404 - the model is not there, or the base URL is not the one the server speaks at: ${err.message}`,
      key: true,
    };
  }
  if (err.status === 429) return { text: "Rate limited - wait a moment and send again." };
  if (err.status === 413) {
    return { text: "The request is too large for the server - the files of this message, with the conversation, are more than one request carries. Send fewer or smaller files, or start a New chat." };
  }
  if (err.status >= 500) return { text: `${host} had an error (${err.status}) - send again in a moment.` };
  if (err.status === 400) return { text: `The request was refused: ${err.message}` };
  return { text: `${host} answered ${err.status}: ${err.message}` };
}

// ----------------------------------------------------------- the stream

// Chat Completions streams one JSON chunk per SSE event, each a delta of
// the choice: a piece of text, or a piece of a tool call under its index.
// Told here as the Messages API's events - content_block_start, the deltas,
// content_block_stop - so the chat's followStream( ) needs no second
// implementation.
async function* sseEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at).replace(/\r$/, "");
        buffer = buffer.slice(at + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "" || data === "[DONE]") continue;
        yield data;
      }
      if (signal?.aborted) break;
    }
    const rest = buffer.trim();
    if (rest.startsWith("data:") && !/\[DONE\]$/.test(rest)) yield rest.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}

/**
 * One streamed Chat Completions request, answering the part of the SDK's
 * stream the chats use: on("text"), on("streamEvent"), finalMessage( ),
 * abort( ) and currentMessage. `request` is { system, tools, messages } in
 * the Messages API's shape plus the model.
 */
export function streamChatCompletion({ baseUrl, apiKey, model, system, tools, messages, fetch: doFetch = globalThis.fetch }) {
  const listeners = { text: [], streamEvent: [] };
  const controller = new AbortController();
  const url = chatCompletionsUrl(baseUrl);
  const host = hostOf(url);
  const current = { id: undefined, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: undefined };
  const emit = (name, payload) => {
    for (const fn of listeners[name]) fn(payload);
  };

  const body = {
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: toOpenAIMessages(system, messages),
  };
  if (tools?.length) {
    body.tools = toOpenAITools(tools);
    body.tool_choice = "auto";
  }

  const headers = { "content-type": "application/json" };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
    // Azure OpenAI takes an API key in a header of its own; sent to nobody
    // else, since a header a server did not expect fails its CORS preflight.
    if (/\.(openai\.azure\.com|cognitiveservices\.azure\.com)$/i.test(new URL(url).hostname)) headers["api-key"] = apiKey;
  }

  async function run() {
    let response;
    try {
      response = await doFetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    } catch (e) {
      if (controller.signal.aborted || e?.name === "AbortError") throw new LLMAbortError();
      throw new OpenAIError(String(e?.message ?? e), { host });
    }
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`.trim();
      let code;
      try {
        const text = await response.text();
        try {
          const json = JSON.parse(text);
          message = json?.error?.message ?? json?.message ?? json?.detail ?? (text || message);
          code = json?.error?.code ?? json?.error?.type;
        } catch {
          if (text) message = text.slice(0, 300);
        }
      } catch {
        // The body is the detail, not the error.
      }
      throw new OpenAIError(message, { status: response.status, host, code });
    }
    if (!response.body) throw new OpenAIError("The server answered without a body.", { status: response.status, host });

    // The blocks as they arrive: text at most once (deltas may come between
    // tool calls; they are joined), and one tool_use per tool call index.
    let index = 0;
    let textBlock;
    const calls = new Map();
    let finish;
    const openText = () => {
      if (textBlock) return textBlock;
      textBlock = { type: "text", text: "", index: index++ };
      current.content.push(textBlock);
      emit("streamEvent", { type: "content_block_start", index: textBlock.index, content_block: { type: "text", text: "" } });
      return textBlock;
    };
    const closeText = () => {
      if (!textBlock) return;
      emit("streamEvent", { type: "content_block_stop", index: textBlock.index });
      textBlock = undefined;
    };
    // A server that sends a call without an index sends it whole, in one
    // chunk; each such chunk is a call of its own.
    let unindexed = 0;
    for await (const data of sseEvents(response.body, controller.signal)) {
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new OpenAIError(chunk.error.message ?? String(chunk.error), { status: response.status, host, code: chunk.error.code });
      if (chunk.id && !current.id) current.id = chunk.id;
      if (chunk.model) current.model = chunk.model;
      if (chunk.usage) current.usage = usageOf(chunk.usage);
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content !== "") {
        const block = openText();
        block.text += delta.content;
        emit("streamEvent", { type: "content_block_delta", index: block.index, delta: { type: "text_delta", text: delta.content } });
        emit("text", delta.content);
      }
      for (const call of delta.tool_calls ?? []) {
        const key = typeof call.index === "number" ? call.index : `u${unindexed++}`;
        let block = calls.get(key);
        if (!block) {
          closeText();
          block = { type: "tool_use", id: call.id || `call_${index}`, name: call.function?.name ?? "", input: {}, json: "", index: index++ };
          calls.set(key, block);
          current.content.push(block);
          emit("streamEvent", { type: "content_block_start", index: block.index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
        } else {
          // The id and the name may arrive a chunk after the call began.
          if (call.id && block.id === `call_${block.index}`) block.id = call.id;
          if (call.function?.name && !block.name) block.name = call.function.name;
        }
        const piece = call.function?.arguments ?? "";
        if (piece) {
          block.json += piece;
          emit("streamEvent", { type: "content_block_delta", index: block.index, delta: { type: "input_json_delta", partial_json: piece } });
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    closeText();
    for (const block of calls.values()) emit("streamEvent", { type: "content_block_stop", index: block.index });
    // Parsed once the block is whole - the loop re-asks on this error.
    for (const block of calls.values()) {
      block.input = parseArguments(block.json);
      delete block.json;
    }
    for (const block of current.content) delete block.index;
    current.stop_reason = stopReasonOf(finish, calls.size > 0);
    emit("streamEvent", { type: "message_delta", delta: { stop_reason: current.stop_reason, stop_sequence: null }, usage: current.usage ?? {} });
    emit("streamEvent", { type: "message_stop" });
    return current;
  }

  let final;
  const stream = {
    on(name, fn) {
      if (listeners[name]) listeners[name].push(fn);
      return stream;
    },
    finalMessage() {
      final ??= run().catch((e) => {
        if (controller.signal.aborted && !(e instanceof LLMAbortError) && !(e instanceof OpenAIError && e.status)) throw new LLMAbortError();
        throw e;
      });
      return final;
    },
    abort() {
      controller.abort();
    },
    get currentMessage() {
      return current;
    },
  };
  return stream;
}

// --------------------------------------------------------- the provider

/**
 * The provider for one conversation. `settings` is what the key form
 * saved (readProviderSettings) with the key and, for Anthropic, the
 * workspace; `Anthropic` the SDK, handed in by ai-common.mjs so this
 * module carries none of it.
 *
 *   provider.stream({ system, tools, messages, maxTokens, speed })  the SDK's stream, or its twin above
 *   provider.modelFor(speed)   the model a request at this speed goes to (the usage is counted under it)
 *   provider.priced            whether the usage can be priced (the Anthropic list; a local model costs nothing)
 *   provider.isAbort(err)      the reader pressed Stop
 *   provider.isApiError(err)   the API itself refused - not asked again
 */
export function createProvider({ provider = DEFAULT_PROVIDER, apiKey, workspace, baseUrl, model }, { Anthropic, request = {} } = {}) {
  if (provider === "openai") {
    const base = normaliseBaseUrl(baseUrl) || PROVIDERS.openai.baseUrl;
    const name = (model ?? "").trim() || PROVIDERS.openai.model;
    return {
      kind: "openai",
      label: `${name} · ${hostOf(base)}`,
      priced: false,
      modelFor: () => name,
      stream: ({ system, tools, messages }) => streamChatCompletion({ baseUrl: base, apiKey, model: name, system, tools, messages }),
      isAbort: (err) => err instanceof LLMAbortError,
      isApiError: (err) => err instanceof OpenAIError,
    };
  }
  if (!Anthropic) throw new Error("The Anthropic SDK is needed for the Anthropic provider.");
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    // A key that is not tied to a workspace is refused without this header
    // ("This API key is not scoped to a workspace..."); the ordinary key
    // belongs to one already and sends nothing extra.
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  return {
    kind: "anthropic",
    label: "Anthropic",
    priced: true,
    modelFor: (speed) => speed.model,
    stream: ({ system, tools, messages, maxTokens, speed }) =>
      client.beta.messages.stream({
        model: speed.model,
        max_tokens: maxTokens,
        system,
        tools,
        messages,
        output_config: { effort: speed.effort },
        // The reasoning stays hidden; the short notes the model writes between
        // tool calls ("the table is there, now the search") come back as text,
        // so a long turn is not minutes of silence.
        thinking: { type: "adaptive", display: "updates" },
        // A request a safety classifier declines is answered by the model
        // the API picks for that category instead of stopping the turn.
        fallbacks: "default",
        // The conversation so far, cached up to its last block: every turn of
        // a tool loop resends all of it.
        cache_control: { type: "ephemeral" },
        ...request,
      }),
    isAbort: (err) => err instanceof Anthropic.APIUserAbortError,
    isApiError: (err) => err instanceof Anthropic.APIError,
  };
}
