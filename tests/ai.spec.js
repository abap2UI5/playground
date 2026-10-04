import { test, expect } from "@playwright/test";
import { open } from "./helpers.mjs";

// The AI chat (src/shell/chat.mjs, src/shell/ai-agent.mjs). No test talks to
// a model: api.anthropic.com is answered here, with the server-sent events
// the Messages API streams, so what is held is the playground's half of the
// conversation - the key, the tools reaching the real editor and the real
// Run, and what goes back to the model afterwards.

const APP_FILE = "zcl_ai_app.clas.abap";
const MARK = "Built by the model";
const KEY = "sk-ant-test-key";

const APP = `CLASS zcl_ai_app DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
ENDCLASS.
CLASS zcl_ai_app IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    IF client->check_on_init( ).
      DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
          )->ele( n = \`View\` ns = \`mvc\`
              )->a( n = \`xmlns\`     v = \`sap.m\`
              )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).
      view->ele( \`Page\`
          )->a( n = \`title\` v = \`${MARK}\` ).
      client->view_display( view->stringify( ) ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.`;

// One streamed answer: some text, then the tool calls, as the API sends them.
function sse({ text = "", tools = [], stop }) {
  const events = [];
  const send = (type, data) => events.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", {
    message: {
      id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 },
    },
  });
  let index = 0;
  if (text) {
    send("content_block_start", { index, content_block: { type: "text", text: "" } });
    send("content_block_delta", { index, delta: { type: "text_delta", text } });
    send("content_block_stop", { index });
    index += 1;
  }
  for (const [i, tool] of tools.entries()) {
    send("content_block_start", { index, content_block: { type: "tool_use", id: `toolu_${i}`, name: tool.name, input: {} } });
    send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } });
    send("content_block_stop", { index });
    index += 1;
  }
  send("message_delta", { delta: { stop_reason: stop ?? (tools.length ? "tool_use" : "end_turn"), stop_sequence: null }, usage: { output_tokens: 300 } });
  send("message_stop", {});
  return events.join("");
}

async function saveKey(page) {
  await page.locator("#ai").click();
  await expect(page.locator("#chat-key")).toBeVisible();
  await page.locator("#chat-key-input").fill(KEY);
  await page.locator("#chat-key button[type=submit]").click();
  await expect(page.locator("#chat-key")).toBeHidden();
}

test("the chat builds an app in the editor, runs it and tells the model what happened", async ({ page }) => {
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    const body = request.postDataJSON();
    requests.push({ headers: request.headers(), body });
    const answer = requests.length === 1
      ? sse({
          text: "I will build it.",
          tools: [
            { name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } },
            { name: "run_app", input: {} },
          ],
        })
      : sse({ text: "Done - the page is running." });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });

  await open(page);
  await saveKey(page);
  // The editor makes way for the chat; the app stays on the right.
  await expect(page.locator("#editor")).toBeHidden();
  await expect(page.locator("#chat")).toBeVisible();

  await page.locator("#chat-input").fill("A page that says it was built by the model");
  await page.locator("#chat-input").press("Enter");

  await expect(page.locator(".chat-user")).toHaveText("A page that says it was built by the model");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Done - the page is running.", { timeout: 90000 });
  await expect(page.locator(".chat-tool").first()).toHaveText(`created ${APP_FILE}`);
  await expect(page.locator(".chat-tool").nth(1)).toContainText("ran: running");
  await expect(page.frameLocator("#app").getByText(MARK)).toBeVisible();

  // The key went to the API as the key, and the editor's files went with the
  // first message so the model knows what is open.
  expect(requests[0].headers["x-api-key"]).toBe(KEY);
  expect(requests[0].body.model).toBe("claude-opus-5-5");
  expect(JSON.stringify(requests[0].body.messages[0])).toContain("<editor_files>");
  // The second request carries both tool results, in one message, and the
  // run's report says the app started and what it rendered.
  const results = requests[1].body.messages.at(-1).content;
  expect(results.map((r) => r.type)).toEqual(["tool_result", "tool_result"]);
  expect(results[1].content).toContain("status: running");
  expect(results[1].content).toContain(MARK);

  // Back to the editor: the model's class is there, and it is the app.
  await page.locator("#ai").click();
  await expect(page.locator("#editor")).toBeVisible();
  const files = await page.evaluate(() =>
    window.monaco.editor.getModels().filter((m) => m.uri.scheme === "file").map((m) => m.uri.path.slice(1)));
  expect(files).toContain(APP_FILE);
  await expect(page.locator("#files")).toContainText(APP_FILE);
});

test("a key the API refuses brings the key form back and says why", async ({ page }) => {
  await page.route("https://api.anthropic.com/**", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: cors() })
      : route.fulfill({
          status: 401,
          headers: { ...cors(), "content-type": "application/json" },
          body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
        }));

  await open(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("anything");
  await page.locator("#chat-send").click();

  await expect(page.locator(".chat-notice.is-error")).toContainText("API key was not accepted");
  await expect(page.locator("#chat-key")).toBeVisible();
  await expect(page.locator("#chat-send")).toHaveText("Send");
});

test("the chat is not offered in an embedded playground", async ({ page }) => {
  await page.goto("/?embed=1");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#ai")).toBeHidden();
});

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
  };
}
