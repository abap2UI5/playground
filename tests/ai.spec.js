import { test, expect } from "@playwright/test";

// The AI Studio (src/shell/chat.mjs, src/shell/ai-agent.mjs), on its own page
// ai/index.html - the playground carries no way into it. No test talks to
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
function sse({ text = "", tools = [], stop, note }) {
  const events = [];
  const send = (type, data) => events.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", {
    message: {
      id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 },
    },
  });
  let index = 0;
  // A progress note, the way display "updates" streams one: a thinking block
  // whose text arrives as thinking deltas.
  if (note) {
    send("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
    send("content_block_delta", { index, delta: { type: "thinking_delta", thinking: note } });
    send("content_block_delta", { index, delta: { type: "signature_delta", signature: "sig" } });
    send("content_block_stop", { index });
    index += 1;
  }
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

// The studio's page: it opens on its own, on an empty class, without a run.
async function openStudio(page) {
  await page.goto("/ai/");
  await expect(page.locator("#status")).toHaveText("ready - describe the app you want", { timeout: 120000 });
  await expect(page.locator("body")).toHaveClass(/is-studio/);
}

async function saveKey(page) {
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
      : sse({ text: "**Done** - the page is running.\n\n- one `class`\n- one run" });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });

  await openStudio(page);
  await saveKey(page);
  // AI turns the page into the studio: the site's bar and the toolbar step
  // aside, the chat beside the app on the stage (Preview at this width).
  await expect(page.locator("body")).toHaveClass(/is-studio/);
  await expect(page.locator("header.bar")).toBeHidden();
  await expect(page.locator("#run")).toBeHidden();
  await expect(page.locator("#chat")).toBeVisible();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator(".studio-stage[aria-selected=true]")).toHaveText("Preview");

  await page.locator("#chat-input").fill("A page that says it was built by the model");
  await page.locator("#chat-input").press("Enter");

  await expect(page.locator(".chat-user")).toHaveText("A page that says it was built by the model");
  await expect(page.locator(".chat-assistant").last()).toContainText("Done - the page is running.", { timeout: 90000 });
  // The answer's markdown is rendered as nodes, not shown as typed.
  await expect(page.locator(".chat-assistant").last().locator("strong")).toHaveText("Done");
  await expect(page.locator(".chat-assistant").last().locator("li code")).toHaveText("class");
  // The file the model wrote is the one on screen in the editor.
  expect(await page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().uri.path)).toBe(`/${APP_FILE}`);
  await expect(page.locator(".chat-tool").first()).toHaveText(`created ${APP_FILE}`);
  await expect(page.locator(".chat-tool").nth(1)).toContainText("ran: running");
  await expect(page.frameLocator("#app").getByText(MARK)).toBeVisible();
  // The run is a card in the conversation, and the stage's window names the app.
  await expect(page.locator(".chat-card")).toContainText("App updated");
  await expect(page.locator("#studio-url")).toContainText("ZCL_AI_APP");

  // Code on the stage shows the editor, on the file the model wrote.
  await page.locator('.studio-stage[data-stage="code"]').click();
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  // ...and the card brings the app back.
  await page.locator(".chat-card").click();
  await expect(page.locator("#app")).toBeVisible();

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

  // The model's class is the app, and the empty class the studio started on
  // went with its first write.
  const files = await page.evaluate(() =>
    window.monaco.editor.getModels().filter((m) => m.uri.scheme === "file").map((m) => m.uri.path.slice(1)));
  expect(files).toEqual([APP_FILE]);
  // Nothing the studio built was stored as the playground's draft.
  expect(await page.evaluate(() => localStorage.getItem("abap2ui5-playground:files"))).toBeNull();
});

test("a change is run by the page itself, its report rides on the change, and the turn shows what it is doing", async ({ page }) => {
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push({ headers: request.headers(), body: request.postDataJSON() });
    const answer = requests.length === 1
      ? sse({ note: "Writing the class now.", tools: [{ name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } }] })
      : sse({ text: "Done." });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });

  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Done.", { timeout: 90000 });

  // No run_app was asked for, and the app ran all the same - two requests,
  // not three, and the report on the write's own result.
  expect(requests).toHaveLength(2);
  const result = requests[1].body.messages.at(-1).content;
  expect(result).toHaveLength(1);
  expect(result[0].content).toContain("The page ran the app after these changes");
  expect(result[0].content).toContain("status: running");
  await expect(page.frameLocator("#app").getByText(MARK)).toBeVisible();

  // The turn said what it was doing: the progress note, then the rows of the
  // write and of the run - finished, none left pending.
  await expect(page.locator(".chat-progress")).toHaveText("Writing the class now.");
  await expect(page.locator(".chat-tool").first()).toHaveText(`created ${APP_FILE}`);
  await expect(page.locator(".chat-tool").nth(1)).toContainText("ran: running");
  await expect(page.locator(".chat-tool.is-pending")).toHaveCount(0);

  // Balanced by default: Opus 5.5 at medium, the progress notes asked for.
  expect(requests[0].body.model).toBe("claude-opus-5-5");
  expect(requests[0].body.output_config.effort).toBe("medium");
  expect(requests[0].body.thinking).toEqual({ type: "adaptive", display: "updates" });
  expect(requests[0].headers["anthropic-beta"]).toContain("thinking-display-updates-2026-08-18");
});

test("Fast in the header sends the next message to Sonnet 5.5, and is remembered", async ({ page }) => {
  const models = [];
  await page.route("https://api.anthropic.com/**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    models.push(route.request().postDataJSON().model);
    return route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: sse({ text: "Hi." }) });
  });

  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-speed").selectOption("fast");
  await page.locator("#chat-input").fill("hello");
  await page.locator("#chat-send").click();
  await expect(page.locator(".chat-assistant").last()).toHaveText("Hi.");
  expect(models).toEqual(["claude-sonnet-5-5"]);

  await page.reload();
  await expect(page.locator("#status")).toHaveText("ready - describe the app you want", { timeout: 120000 });
  await expect(page.locator("#chat-speed")).toHaveValue("fast");
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

  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("anything");
  await page.locator("#chat-send").click();

  await expect(page.locator(".chat-notice.is-error")).toContainText("API key was not accepted");
  await expect(page.locator("#chat-key")).toBeVisible();
  await expect(page.locator("#chat-send")).toHaveText("Send");
});

test("a key without a workspace is told which one to use, and the workspace goes with every request", async ({ page }) => {
  const seen = [];
  await page.route("https://api.anthropic.com/**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    const workspace = request.headers()["anthropic-workspace-id"];
    seen.push(workspace);
    return workspace
      ? route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: sse({ text: "Hello." }) })
      : route.fulfill({
          status: 400,
          headers: { ...cors(), "content-type": "application/json" },
          body: JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.",
            },
          }),
        });
  });

  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("hi");
  await page.locator("#chat-send").click();

  // Said in words a reader can act on, with the caret where the answer goes.
  await expect(page.locator(".chat-notice.is-error")).toContainText("not tied to a workspace");
  await expect(page.locator("#chat-key")).toBeVisible();
  await expect(page.locator("#chat-workspace-input")).toBeFocused();

  // The key is already stored; the workspace is added on its own.
  await page.locator("#chat-workspace-input").fill("wrkspc_test");
  await page.locator("#chat-key button[type=submit]").click();
  await page.locator("#chat-input").fill("hi again");
  await page.locator("#chat-send").click();
  await expect(page.locator(".chat-assistant").last()).toHaveText("Hello.");
  expect(seen).toEqual([undefined, "wrkspc_test"]);
});

test("on a phone the studio opens on the chat, the stages take turns, and the bar stays on screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page);
  await expect(page.locator("#chat")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  await expect(page.locator(".studio-stage[aria-selected=true]")).toHaveText("Chat");

  await page.locator('.studio-stage[data-stage="preview"]').click();
  await expect(page.locator("#chat")).toBeHidden();
  const stage = await page.locator("#pane-right").boundingBox();
  // The stage fits the screen, from under the bar to the bottom edge.
  expect(stage.y + stage.height).toBeLessThanOrEqual(844 + 1);

  // Every control of the bar is inside the screen.
  for (const id of ["#studio-fullscreen", '.studio-stage[data-stage="code"]']) {
    const box = await page.locator(id).boundingBox();
    expect(box.x + box.width, id).toBeLessThanOrEqual(390);
  }
});

test("on a wide screen the studio opens on Split: chat, code and app side by side", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openStudio(page);
  await expect(page.locator(".studio-stage[aria-selected=true]")).toHaveText("Split");
  const chat = await page.locator("#chat").boundingBox();
  const editor = await page.locator("#editor").boundingBox();
  const app = await page.locator("#pane-right").boundingBox();
  expect(chat.x + chat.width).toBeLessThanOrEqual(editor.x + 1);
  expect(editor.x + editor.width).toBeLessThanOrEqual(app.x + 1);
  expect(editor.height).toBeGreaterThan(300);
  expect(app.height).toBeGreaterThan(500);
});

test("the playground carries no way into the studio, embedded or not", async ({ page }) => {
  for (const url of ["/", "/?embed=1"]) {
    await page.goto(url);
    await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
    await expect(page.locator("#ai")).toHaveCount(0);
    await expect(page.locator("#studio-bar")).toBeHidden();
    await expect(page.locator("#chat")).toBeHidden();
  }
});

test("the studio's page starts on an empty class: no run, no sample, and no way out to a playground under it", async ({ page }) => {
  await openStudio(page);
  const files = await page.evaluate(() =>
    window.monaco.editor.getModels().filter((m) => m.uri.scheme === "file").map((m) => ({ name: m.uri.path.slice(1), source: m.getValue() })));
  expect(files).toEqual([{ name: "zcl_app.clas.abap", source: "" }]);
  await expect(page.locator(".app-placeholder-what")).toHaveText("Your app appears here as soon as Claude has built it.");
  await expect(page.locator("#studio-url")).toHaveText("your app");
  await expect(page.locator("#studio-exit")).toBeHidden();
  await expect(page).toHaveTitle("AI Studio · abap2UI5");
  // Kept out of search engines while it is being built.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
});

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
  };
}
