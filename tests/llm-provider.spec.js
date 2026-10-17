import { test, expect } from "@playwright/test";
import {
  chatCompletionsUrl,
  createProvider,
  explainOpenAIError,
  fromOpenAIMessages,
  keyHost,
  OpenAIError,
  parseArguments,
  readProviderSettings,
  streamChatCompletion,
  toOpenAIMessages,
  toOpenAITools,
} from "../src/shell/llm-provider.mjs";

// The two AI chats keep their conversation in the Messages API's shape and
// hand each request to a provider (src/shell/llm-provider.mjs): the Anthropic
// SDK as it always was, or an OpenAI-compatible server over Chat Completions.
// What has to stay true is the translation both ways - a tool_use is a
// tool_call with the same id and arguments, a tool_result the tool message
// answering it - and that the Anthropic request is the one it was.

const SYSTEM = [{ type: "text", text: "You build abap2UI5 apps.", cache_control: { type: "ephemeral" } }];

// A conversation as the studio's loop holds it: a question with an image,
// an answer with text and two parallel calls, both results in one message
// (one an error), and the follow-up text.
const CONVERSATION = [
  {
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
      { type: "text", text: "Build the app in the picture." },
    ],
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Writing it and running it." },
      { type: "tool_use", id: "toolu_1", name: "write_file", input: { name: "zcl_a.clas.abap", source: "CLASS zcl_a…" } },
      { type: "tool_use", id: "toolu_2", name: "run_app", input: {} },
    ],
  },
  {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "toolu_1", content: "created zcl_a.clas.abap" },
      { type: "tool_result", tool_use_id: "toolu_2", is_error: true, content: "status: syntax error" },
    ],
  },
  { role: "assistant", content: [{ type: "text", text: "Fixed." }] },
];

test("a tool_use is a tool_call and a tool_result the tool message answering it, and back again", () => {
  const openai = toOpenAIMessages(SYSTEM, CONVERSATION);
  expect(openai[0]).toEqual({ role: "system", content: "You build abap2UI5 apps." });
  expect(openai[1]).toEqual({
    role: "user",
    content: [
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      { type: "text", text: "Build the app in the picture." },
    ],
  });
  expect(openai[2]).toEqual({
    role: "assistant",
    content: "Writing it and running it.",
    tool_calls: [
      { id: "toolu_1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ name: "zcl_a.clas.abap", source: "CLASS zcl_a…" }) } },
      { id: "toolu_2", type: "function", function: { name: "run_app", arguments: "{}" } },
    ],
  });
  // Each result a message of its own, in the order of the calls; an error
  // said as one, since Chat Completions has no is_error.
  expect(openai[3]).toEqual({ role: "tool", tool_call_id: "toolu_1", content: "created zcl_a.clas.abap" });
  expect(openai[4]).toEqual({ role: "tool", tool_call_id: "toolu_2", content: "Error: status: syntax error" });
  expect(openai[5]).toEqual({ role: "assistant", content: "Fixed." });

  // Back to the Messages API: the same conversation, results of one answer
  // in one user message again.
  const back = fromOpenAIMessages(openai);
  expect(back.system).toBe("You build abap2UI5 apps.");
  expect(back.messages).toEqual(CONVERSATION);
  expect(toOpenAIMessages(back.system, back.messages)).toEqual(openai);
});

test("tool results go before the text of the same message, plain text stays a string, thinking stays home", () => {
  const openai = toOpenAIMessages("sys", [
    { role: "user", content: "hello" },
    { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "t1", name: "look", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "a screen" }] }, { type: "text", text: "<editor_files>…</editor_files>" }] },
  ]);
  expect(openai.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
  expect(openai[1].content).toBe("hello");
  expect(openai[2].content).toBeNull();
  expect(openai[3].content).toBe("a screen");
  expect(openai[4].content).toBe("<editor_files>…</editor_files>");
  // A text document travels as text under its title, a PDF as a file part.
  const docs = toOpenAIMessages(undefined, [{
    role: "user",
    content: [
      { type: "document", title: "orders.xlsx", source: { type: "text", media_type: "text/plain", data: "a,b" } },
      { type: "document", title: "note.pdf", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } },
    ],
  }]);
  expect(docs[0].content[0]).toEqual({ type: "text", text: '<document title="orders.xlsx">\na,b\n</document>' });
  expect(docs[0].content[1]).toEqual({ type: "file", file: { filename: "note.pdf", file_data: "data:application/pdf;base64,JVBERi0=" } });
});

test("the tools are functions with their schema, and arguments that do not parse are said in the SDK's words", () => {
  const schema = { type: "object", properties: { name: { type: "string" } }, required: ["name"] };
  expect(toOpenAITools([{ name: "read_files", description: "Reads.", input_schema: schema, eager_input_streaming: true }])).toEqual([
    { type: "function", function: { name: "read_files", description: "Reads.", parameters: schema } },
  ]);
  expect(parseArguments("")).toEqual({});
  expect(parseArguments(' {"a":1} ')).toEqual({ a: 1 });
  // The agent loop asks again on exactly this message.
  expect(() => parseArguments('{"a":')).toThrow(/Unable to parse tool parameter JSON/);
  expect(() => parseArguments("[1]")).toThrow(/Unable to parse tool parameter JSON/);
});

// A fetch that answers with these SSE lines, cut at awkward places, and
// records what it was asked.
function fakeFetch(lines, asked, { status = 200 } = {}) {
  return async (url, init) => {
    asked.push({ url, init, body: JSON.parse(init.body) });
    if (status !== 200) return new Response(JSON.stringify({ error: { message: "no such model", code: "model_not_found" } }), { status });
    const text = lines.join("");
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}

const data = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

test("a streamed answer becomes a Messages API message, and its events the ones the chat draws from", async () => {
  const asked = [];
  const lines = [
    data({ id: "c1", model: "local", choices: [{ index: 0, delta: { role: "assistant", content: "Let me " } }] }),
    data({ id: "c1", choices: [{ index: 0, delta: { content: "write it." } }] }),
    data({ id: "c1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "write_file", arguments: '{"name":"zcl' } }] } }] }),
    data({ id: "c1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '_a.clas.abap"}' } }] } }] }),
    data({ id: "c1", choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "run_app", arguments: "" } }] } }] }),
    data({ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
    data({ id: "c1", choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 400 } } }),
    "data: [DONE]\n\n",
  ];
  const stream = streamChatCompletion({
    baseUrl: "http://localhost:11434/v1/",
    apiKey: "",
    model: "local",
    system: SYSTEM,
    tools: [{ name: "write_file", input_schema: { type: "object" } }],
    messages: [{ role: "user", content: "go" }],
    fetch: fakeFetch(lines, asked),
  });
  const texts = [];
  const events = [];
  stream.on("text", (t) => texts.push(t));
  stream.on("streamEvent", (e) => events.push(e));
  const message = await stream.finalMessage();

  expect(asked[0].url).toBe("http://localhost:11434/v1/chat/completions");
  // No key, no authorization header - a local server takes none.
  expect(asked[0].init.headers.authorization).toBeUndefined();
  expect(asked[0].body).toMatchObject({ model: "local", stream: true, tool_choice: "auto" });
  expect(asked[0].body.messages[0]).toEqual({ role: "system", content: "You build abap2UI5 apps." });

  expect(texts.join("")).toBe("Let me write it.");
  expect(message.stop_reason).toBe("tool_use");
  expect(message.content).toEqual([
    { type: "text", text: "Let me write it." },
    { type: "tool_use", id: "call_a", name: "write_file", input: { name: "zcl_a.clas.abap" } },
    { type: "tool_use", id: "call_b", name: "run_app", input: {} },
  ]);
  // The cached part of the prompt counted apart, as the Messages API does.
  expect(message.usage).toEqual({ input_tokens: 600, cache_read_input_tokens: 400, cache_creation_input_tokens: 0, output_tokens: 50 });
  // followStream( ) sees a tool block start with its id and its input arrive.
  expect(events.filter((e) => e.type === "content_block_start").map((e) => e.content_block.type)).toEqual(["text", "tool_use", "tool_use"]);
  expect(events.filter((e) => e.delta?.type === "input_json_delta").map((e) => e.delta.partial_json).join("")).toBe('{"name":"zcl_a.clas.abap"}');
  expect(events.at(-1)).toEqual({ type: "message_stop" });

  // The answer, appended as the loop appends it, goes out again as the
  // tool_calls it came in as.
  const again = toOpenAIMessages(undefined, [{ role: "assistant", content: message.content }]);
  expect(again[0].tool_calls.map((c) => [c.id, c.function.name, JSON.parse(c.function.arguments)])).toEqual([
    ["call_a", "write_file", { name: "zcl_a.clas.abap" }],
    ["call_b", "run_app", {}],
  ]);
});

test("a key goes as a bearer, a refusal is said with what to do, an unreachable server with CORS in mind", async () => {
  const asked = [];
  const stream = streamChatCompletion({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    fetch: fakeFetch([], asked, { status: 404 }),
  });
  const err = await stream.finalMessage().catch((e) => e);
  expect(asked[0].init.headers.authorization).toBe("Bearer sk-test");
  expect(asked[0].body.tools).toBeUndefined();
  expect(err).toBeInstanceOf(OpenAIError);
  expect(err.status).toBe(404);
  expect(explainOpenAIError(err)).toMatchObject({ key: true });
  expect(explainOpenAIError(err).text).toContain("no such model");

  const unreachable = streamChatCompletion({
    baseUrl: "http://localhost:1234/v1",
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    fetch: async () => { throw new TypeError("Failed to fetch"); },
  });
  const said = explainOpenAIError(await unreachable.finalMessage().catch((e) => e));
  expect(said.text).toContain("localhost:1234 could not be reached");
  expect(said.text).toContain("OLLAMA_ORIGINS");
});

test("the settings default to Anthropic, keep a base URL without its slash, and never carry a key", () => {
  expect(readProviderSettings(undefined)).toEqual({ provider: "anthropic" });
  expect(readProviderSettings({ provider: "nonsense" })).toEqual({ provider: "anthropic" });
  expect(readProviderSettings({ provider: "openai" })).toEqual({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
  expect(readProviderSettings({ provider: "openai", baseUrl: " http://localhost:11434/v1/chat/completions ", model: " local-model ", apiKey: "sk" }))
    .toEqual({ provider: "openai", baseUrl: "http://localhost:11434/v1", model: "local-model" });
  expect(chatCompletionsUrl("http://localhost:1234/v1/")).toBe("http://localhost:1234/v1/chat/completions");
  // Only an http(s) URL is a base URL: anything else read back is the default.
  for (const baseUrl of ["javascript:alert(1)", "data:text/plain,x", "ftp://example.com/v1", "not a url"]) {
    expect(readProviderSettings({ provider: "openai", baseUrl }).baseUrl).toBe("https://api.openai.com/v1");
  }
});

test("where a key goes is said whenever it is not the provider's own server", () => {
  expect(keyHost({ provider: "anthropic" })).toBeUndefined();
  expect(keyHost(readProviderSettings({ provider: "openai" }))).toBeUndefined();
  expect(keyHost(readProviderSettings({ provider: "openai", baseUrl: "http://localhost:11434/v1" })))
    .toEqual({ host: "localhost:11434", plain: false });
  expect(keyHost(readProviderSettings({ provider: "openai", baseUrl: "http://10.0.0.5:8000/v1" })))
    .toEqual({ host: "10.0.0.5:8000", plain: true });
  expect(keyHost(readProviderSettings({ provider: "openai", baseUrl: "https://collector.example/v1" })))
    .toEqual({ host: "collector.example", plain: false });
});

test("the Anthropic provider sends the request it always sent", () => {
  const made = [];
  class Anthropic {
    constructor(options) {
      made.push(options);
      this.beta = { messages: { stream: (params) => ({ params }) } };
    }
  }
  Anthropic.APIUserAbortError = class extends Error {};
  Anthropic.APIError = class extends Error {};
  const request = { betas: ["b1"], context_management: { edits: [] } };
  const provider = createProvider({ apiKey: "sk-ant", workspace: "wrkspc_1" }, { Anthropic, request });
  expect(made[0]).toEqual({ apiKey: "sk-ant", dangerouslyAllowBrowser: true, defaultHeaders: { "anthropic-workspace-id": "wrkspc_1" } });
  expect(provider.priced).toBe(true);
  const speed = { model: "claude-opus-5-5", effort: "medium" };
  expect(provider.modelFor(speed)).toBe("claude-opus-5-5");
  const { params } = provider.stream({ system: SYSTEM, tools: [], messages: [], maxTokens: 32000, speed });
  expect(params).toEqual({
    model: "claude-opus-5-5",
    max_tokens: 32000,
    system: SYSTEM,
    tools: [],
    messages: [],
    output_config: { effort: "medium" },
    thinking: { type: "adaptive", display: "updates" },
    fallbacks: "default",
    cache_control: { type: "ephemeral" },
    betas: ["b1"],
    context_management: { edits: [] },
  });
  // The OpenAI-compatible provider has no price list and no SDK.
  const local = createProvider({ provider: "openai", baseUrl: "http://localhost:11434/v1", model: "local-model" });
  expect(local.priced).toBe(false);
  expect(local.modelFor(speed)).toBe("local-model");
});
