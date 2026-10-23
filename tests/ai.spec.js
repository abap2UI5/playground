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

// The studio's page: it opens on its own, on a minimal class, without a run.
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
  // The file strip without the playground's "+ table": the model writes
  // classes only.
  await expect(page.locator(".file-add")).toBeVisible();
  await expect(page.locator(".file-add-table")).toBeHidden();
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

  // The model's class is the app, and the untouched class the studio started
  // on went with its first write.
  const files = await page.evaluate(() =>
    window.monaco.editor.getModels().filter((m) => m.uri.scheme === "file").map((m) => m.uri.path.slice(1)));
  expect(files).toEqual([APP_FILE]);
  // Nothing the studio built was stored as the playground's draft.
  expect(await page.evaluate(() => localStorage.getItem("abap2ui5-playground:files"))).toBeNull();
});

test("an interface written before the app's class leaves the starting class until the class takes its place", async ({ page }) => {
  // The natural order for a model: what the class implements, then the class.
  const intf = "INTERFACE zif_ai_thing PUBLIC.\n  CONSTANTS greeting TYPE string VALUE `hi`.\nENDINTERFACE.\n";
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push({ body: request.postDataJSON() });
    const answer = requests.length === 1
      ? sse({ tools: [
          { name: "write_file", input: { name: "zif_ai_thing.intf.abap", source: intf } },
          { name: "write_file", input: { name: APP_FILE, source: APP } },
        ] })
      : sse({ text: "Both written." });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("An app with an interface beside it");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toContainText("Both written.", { timeout: 90000 });
  // Neither write was refused, and the class is the app, the interface beside it.
  const results = requests[1].body.messages.at(-1).content;
  expect(results.map((r) => r.is_error ?? false)).toEqual([false, false]);
  await expect(page.locator("#files .file-name")).toHaveText([APP_FILE, "zif_ai_thing.intf.abap"]);
  await expect(page.frameLocator("#app").getByText(MARK)).toBeVisible();
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

test("a hint of the linter is told as advice, not as a problem that must be fixed", async ({ page }) => {
  const requests = [];
  // A public attribute nothing binds: the linter's unused-public-attribute,
  // a hint by default.
  const withHint = APP.replace("INTERFACES z2ui5_if_app.", "INTERFACES z2ui5_if_app.\n    DATA spare TYPE string.");
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push({ body: request.postDataJSON() });
    const answer = requests.length === 1
      ? sse({ tools: [{ name: "write_file", input: { name: APP_FILE, source: withHint, as_app: true } }] })
      : sse({ text: "Done." });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });
  await openStudio(page);
  await saveKey(page);
  // Ctrl+Enter in the chat is "send" - not also the playground's Run, which
  // ran the empty starting class behind the placeholder.
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Control+Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Done.", { timeout: 90000 });
  const report = requests[1].body.messages.at(-1).content[0].content;
  // Among the advice, and not among the problems (the class's warnings).
  expect(report.slice(0, report.indexOf("hints ("))).not.toContain("unused-public-attribute");
  expect(report).toMatch(/hints \(\d+\) - advice, optional:\n- zcl_ai_app\.clas\.abap:\d+:\d+ \[abap2UI5 hint unused-public-attribute\]/);
});

test("a run an abaplint error stopped reports no roundtrip of the run before it", async ({ page }) => {
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push(request.postDataJSON());
    const answer = requests.length === 1
      ? sse({ tools: [{ name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } }] })
      : requests.length === 2
        // The full stop goes: the app's last statement no longer parses.
        ? sse({ tools: [{ name: "edit_file", input: { name: APP_FILE, old_text: "view->stringify( ) ).", new_text: "view->stringify( ) )" } }] })
        : sse({ text: "Done." });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });

  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Done.", { timeout: 90000 });

  expect(requests[1].messages.at(-1).content[0].content).toContain("first roundtrip: HTTP 200");
  // The second run stopped before the fresh database: the first app's view
  // is still in the Roundtrips tab, and was told to the model as this run's.
  const report = requests[2].messages.at(-1).content[0].content;
  expect(report).toContain("(the app did not start)");
  expect(report).not.toContain("first roundtrip");
  expect(report).not.toContain(MARK);
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
  // The header counts the tokens and estimates the dollars at list prices.
  await expect(page.locator("#chat-usage")).toContainText("1.2k in · 300 out · ≈ $0.01");
  await expect(page.locator("#chat-usage")).toHaveAttribute("title", /October 2026/);
  // The key itself is in no storage the page's ABAP could read - only the
  // speed is remembered.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain(KEY);

  await page.reload();
  await expect(page.locator("#status")).toHaveText("ready - describe the app you want", { timeout: 120000 });
  await expect(page.locator("#chat-speed")).toHaveValue("fast");
});

test("the target system in the header moves the syntax check, is told to the model and is remembered", async ({ page }) => {
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push(request.postDataJSON());
    const answer = requests.length === 1
      ? sse({ tools: [{ name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } }] })
      : sse({ text: "Done." });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });

  await openStudio(page);
  await saveKey(page);
  // The default is the release the editor checks against out of the box.
  await expect(page.locator("#chat-target")).toHaveValue("v750");
  await page.locator("#chat-target").selectOption("v702");
  await expect(page.locator("#status")).toHaveText("the code is checked against ABAP 7.02 - 7.31 now", { timeout: 120000 });
  await expect(page.locator(".chat-notice").last()).toContainText("Your system: ABAP 7.02 - 7.31");

  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Done.", { timeout: 90000 });

  // The model was told the release, and what it rules out.
  const system = requests[0].system.map((b) => b.text).join("");
  expect(system).toContain("SAP NetWeaver 7.02 to 7.31");
  expect(system).toContain("no inline declarations");
  expect(system).toContain("TODO(system):");
  // The app's DATA( ) is 7.40 syntax: at v702 the check stops the run.
  const report = requests[1].messages.at(-1).content[0].content;
  expect(report).toContain("(the app did not start)");
  expect(report).toMatch(/\[abaplint error/);

  // Kept like a setting typed into the Config tab.
  await page.reload();
  await expect(page.locator("#status")).toHaveText("ready - describe the app you want", { timeout: 120000 });
  await expect(page.locator("#chat-target")).toHaveValue("v702");
});

test("the download says what the model left to connect on the reader's system", async ({ page }) => {
  const todo = "SELECT the carriers from SCARR";
  const app = APP.replace("    IF client->check_on_init( ).", `    " TODO(system): ${todo}\n    IF client->check_on_init( ).`);
  const line = app.split("\n").findIndex((l) => l.includes("TODO(system)")) + 1;
  let calls = 0;
  await page.route("https://api.anthropic.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    calls += 1;
    const answer = calls === 1
      ? sse({ tools: [{ name: "write_file", input: { name: APP_FILE, source: app, as_app: true } }] })
      : sse({ text: "Done." });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });

  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page of carriers");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Done.", { timeout: 90000 });

  const downloaded = page.waitForEvent("download");
  await page.locator("#chat-download").click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.zip$/);
  const notice = page.locator(".chat-notice").last();
  await expect(notice).toContainText("Checked against ABAP 7.50+ / S/4HANA. 1 place is left to connect on your system");
  await expect(notice.locator("li")).toHaveText(`${APP_FILE}:${line} - ${todo}`);
});

test("without a key the welcome offers a model on the reader's own machine", async ({ page }) => {
  await openStudio(page);
  await page.locator(".chat-local-open").click();
  await expect(page.locator("#chat-key")).toBeVisible();
  await expect(page.locator("#chat-provider")).toHaveValue("openai");
  await expect(page.locator("#chat-base-url")).toHaveValue("http://localhost:11434/v1");
  await expect(page.locator("#chat-model")).toBeFocused();
  // A local server needs no key: the form says where requests go.
  await expect(page.locator("#chat-key-target")).toContainText("localhost");
  // Saved, the offer is done.
  await page.locator("#chat-model").fill("qwen3-coder");
  await page.locator("#chat-key button[type=submit]").click();
  await expect(page.locator("#chat-key")).toBeHidden();
  await expect(page.locator(".chat-local")).toHaveCount(0);
});

test("the header follows a release applied in the Config tab", async ({ page }) => {
  await openStudio(page);
  await page.locator('.studio-stage[data-stage="code"]').click();
  await page.locator('[data-insight="abaplint"]').click();
  const box = page.locator(".config-text");
  const config = JSON.parse(await box.inputValue());
  config.version = "v757";
  await box.fill(JSON.stringify(config));
  await page.locator(".config-row .primary").click();
  await expect(page.locator(".config-said")).toContainText("applied", { timeout: 60000 });
  // A release the header does not list is added as abaplint names it.
  await expect(page.locator("#chat-target")).toHaveValue("v757");
  await expect(page.locator("#chat-target option:checked")).toHaveText("ABAP v757");
});

// An app whose one abaplint error none of the edits below touches: each
// edit changes the page's title, the run after it says the same again.
const STUCK_APP = APP.replace("    IF client->check_on_init( ).", "    DATA lv_broken TYPE zzz_not_there.\n    IF client->check_on_init( ).");

test("the same problems three runs in a row end the turn and ask the reader", async ({ page }) => {
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push(request.postDataJSON());
    const n = requests.length;
    const answer = n === 1
      ? sse({ tools: [{ name: "write_file", input: { name: APP_FILE, source: STUCK_APP, as_app: true } }] })
      : sse({ tools: [{ name: "edit_file", input: { name: APP_FILE, old_text: n === 2 ? MARK : `Try ${n - 1}`, new_text: `Try ${n}` } }] });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });

  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-notice").last()).toContainText(/The same (problem|\d+ problems) came back 3 runs in a row/, { timeout: 90000 });
  await expect(page.locator("#chat")).not.toHaveClass(/is-busy/);
  // Three runs, three requests: no fourth was asked for after the third
  // report said the same again.
  expect(requests).toHaveLength(3);
});

test("a turn that keeps calling tools ends after thirty rounds", async ({ page }) => {
  let calls = 0;
  await page.route("https://api.anthropic.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    calls += 1;
    await route.fulfill({
      status: 200,
      headers: { ...cors(), "content-type": "text/event-stream" },
      body: sse({ tools: [{ name: "read_files", input: {} }] }),
    });
  });

  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("Read the files, forever");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-notice").last()).toContainText("Stopped after 30 steps in one message", { timeout: 90000 });
  expect(calls).toBe(30);
});

test("a run's report says what CDS notation means in ABAP, and lists a CALL FUNCTION nobody marked", async ({ page }) => {
  const app = APP
    .replace("    IF client->check_on_init( ).", "    DATA lv_name TYPE abap.char(20).\n    IF client->check_on_init( ).")
    .replace("    ENDIF.\n  ENDMETHOD.", "    ENDIF.\n    IF client->get( )-event = `GO`.\n      CALL FUNCTION 'BAPI_SALESORDER_GETLIST'.\n    ENDIF.\n  ENDMETHOD.");
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push(request.postDataJSON());
    const answer = requests.length === 1
      ? sse({ tools: [{ name: "write_file", input: { name: APP_FILE, source: app, as_app: true } }] })
      : requests.length === 2
        ? sse({ tools: [{ name: "edit_file", input: { name: APP_FILE, old_text: "TYPE abap.char(20)", new_text: "TYPE c LENGTH 20" } }] })
        : sse({ text: "Done." });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });

  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Done.", { timeout: 90000 });

  const first = requests[1].messages.at(-1).content[0].content;
  expect(first).toContain("CDS notation; in ABAP write TYPE c LENGTH 20");
  const second = requests[2].messages.at(-1).content[0].content;
  expect(second).toContain("not checked here (1)");
  expect(second).toMatch(/zcl_ai_app\.clas\.abap:\d+ CALL FUNCTION BAPI_SALESORDER_GETLIST/);

  await page.locator("#chat-download").click();
  await expect(page.locator(".chat-notice").last().locator("li")).toContainText("CALL FUNCTION BAPI_SALESORDER_GETLIST - not checked here");
});

test("a key an earlier version stored is removed by the playground itself, not only by the studio", async ({ page }) => {
  // Stored once, before the first load - the page's own removal is what is
  // being watched, not this script putting it back on the reload.
  await page.addInitScript((key) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("abap2ui5-playground:anthropic-key", key);
  }, KEY);
  // The playground is where a shared link's ABAP runs, and that code can
  // read this origin's storage - the studio's page is not where it was at risk.
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await page.evaluate(() => localStorage.getItem("abap2ui5-playground:anthropic-key"))).toBeNull();
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

test("the playground links to the studio's page and never opens it over its own work; an embed links nowhere", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#studio-bar")).toBeHidden();
  await expect(page.locator("#chat")).toBeHidden();
  // The toolbar's link and the menu's, both to the page.
  await expect(page.locator("#ai-studio")).toBeVisible();
  await expect(page.locator("#ai-studio")).toHaveAttribute("href", "ai/");
  await expect(page.locator('#extra .menu a[data-site="ai"]')).toHaveAttribute("href", "ai/");
  await page.locator("#ai-studio").click();
  await expect(page).toHaveURL(/\/ai\/$/);
  await expect(page.locator("body")).toHaveClass(/is-studio/, { timeout: 120000 });

  await page.goto("/?embed=1");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#ai-studio")).toBeHidden();
  await expect(page.locator("#studio-bar")).toBeHidden();
  await expect(page.locator("#chat")).toBeHidden();
});

test("the studio's page starts on a minimal class: no run, no sample, and no way out to a playground under it", async ({ page }) => {
  await openStudio(page);
  const files = await page.evaluate(() =>
    window.monaco.editor.getModels().filter((m) => m.uri.scheme === "file").map((m) => ({ name: m.uri.path.slice(1), source: m.getValue() })));
  expect(files).toHaveLength(1);
  expect(files[0].name).toBe("zcl_app.clas.abap");
  // The interface implemented, main( ) there and empty.
  expect(files[0].source).toContain("INTERFACES z2ui5_if_app.");
  expect(files[0].source).toMatch(/METHOD z2ui5_if_app~main\.\s*ENDMETHOD\./);
  await expect(page.locator(".app-placeholder-what")).toHaveText("Your app appears here as soon as Claude has built it.");
  await expect(page.locator("#studio-url")).toHaveText("your app");
  await expect(page.locator("#studio-exit")).toBeHidden();
  await expect(page).toHaveTitle("AI Studio · abap2UI5");
  // Published: indexed, with a canonical of its own.
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://abap2ui5.github.io/playground/ai/");
});

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
  };
}

test("files go with a studio message: the paperclip, a drop anywhere on the page, a sheet as CSV", async ({ page }) => {
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push(request.postDataJSON());
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: sse({ text: "Read them." }) });
  });
  await openStudio(page);
  await saveKey(page);

  // The paperclip opens the browser's file picker.
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#chat-attach").click();
  await (await chooser).setFiles(["tests/fixtures/orders.xlsx", "tests/fixtures/note.pdf"]);
  await expect(page.locator(".chat-file")).toHaveCount(2);

  // A file dropped on the studio's bar goes to the chat, not to a new tab.
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["# Spec\nA list of orders"], "spec.md", { type: "text/markdown" }));
    const bar = document.getElementById("studio-bar");
    bar.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    const drop = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
    bar.dispatchEvent(drop);
    return drop.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page.locator(".chat-file")).toHaveCount(3);
  // An old binary Office file is refused with what to save it as.
  await page.locator("#chat-file-input").setInputFiles([{ name: "old.doc", mimeType: "application/msword", buffer: Buffer.from("x") }]);
  await expect(page.locator(".chat-notice.is-error")).toContainText("old.doc is the old binary Office format");

  await page.locator("#chat-input").fill("Build an app for these orders");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toContainText("Read them.", { timeout: 60000 });
  await expect(page.locator(".chat-file")).toHaveCount(0);
  await expect(page.locator(".chat-user .chat-user-files")).toContainText("📎 orders.xlsx");

  const content = requests[0].messages[0].content;
  const documents = content.filter((b) => b.type === "document");
  expect(documents.find((b) => b.source.media_type === "application/pdf").title).toBe("note.pdf");
  expect(documents.find((b) => b.title === "orders.xlsx - sheet Orders").source.data).toContain("Carol,7");
  expect(documents.find((b) => b.title === "spec.md").source.data).toContain("A list of orders");
  expect(content.at(-1)).toEqual({ type: "text", text: "Build an app for these orders" });
  // The studio's rules say what to do with them.
  expect(JSON.stringify(requests[0].system)).toContain("Files the person attaches");
});

// The studio keeps what the model built under a key of its own (main.mjs),
// and the welcome offers it back; the playground's own draft is never
// touched. The conversation is not kept, which is why leaving asks first.
test("a built app comes back after a reload from the welcome", async ({ page }) => {
  await page.route("https://api.anthropic.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    const first = route.request().postDataJSON().messages.length === 1;
    const answer = first
      ? sse({ tools: [{ name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } }] })
      : sse({ text: "Done." });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });
  await openStudio(page);
  await expect(page.locator(".chat-resume")).toHaveCount(0);

  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Done.", { timeout: 90000 });
  await expect(page.frameLocator("#app").getByText(MARK)).toBeVisible();

  // The reload takes the key and the running app (no beforeunload - the
  // back/forward cache rule, tests/bfcache.spec.js); the conversation is
  // kept for the tab, the files are back from the welcome's offer.
  await page.reload();
  await expect(page.locator("#status")).toHaveText("ready - describe the app you want", { timeout: 120000 });
  await expect(page.locator(".chat-user")).toContainText("A page");
  await expect(page.locator(".chat-assistant")).toHaveText("Done.");
  await expect(page.locator(".chat-notice").last()).toContainText("back from before the reload");
  await expect(page.locator("#chat-key")).toBeVisible();

  // Back on the minimal class, the last build one click away.
  await expect(page.locator("#studio-url")).toHaveText("your app");
  await expect(page.locator(".chat-resume-open")).toContainText("ZCL_AI_APP");
  await page.locator(".chat-resume-open").click();
  await expect(page.locator(".chat-resume")).toHaveCount(0);
  await expect(page.frameLocator("#app").getByText(MARK)).toBeVisible({ timeout: 60000 });
  await expect(page.locator("#studio-url")).toContainText("ZCL_AI_APP");
  expect(await page.evaluate(() => localStorage.getItem("abap2ui5-playground:files"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("abap2ui5-playground:ai-files"))).toContain(APP_FILE);

  // The key typed again does not start the conversation over: the next
  // message goes out with the history from before the reload, and the
  // usage so far is back in the header.
  const sent = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: sse({ text: "Still here." }) });
  });
  await saveKey(page);
  await expect(page.locator(".chat-assistant")).toHaveCount(1);
  await page.locator("#chat-input").fill("and now?");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Still here.", { timeout: 90000 });
  await expect(page.locator("#chat-usage")).toContainText("in");
  expect(sent[0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
  expect(sent[0].messages.at(-1).content.at(-1).text).toBe("and now?");

  // New chat forgets it: a reload comes back to the welcome.
  await page.locator("#chat-new").click();
  await page.reload();
  await expect(page.locator("#status")).toHaveText("ready - describe the app you want", { timeout: 120000 });
  await expect(page.locator(".chat-welcome")).toBeVisible();
  await expect(page.locator(".chat-user")).toHaveCount(0);
});

test("a message whose first request failed is out of the conversation, and its ✎ with it", async ({ page }) => {
  let calls = 0;
  await page.route("https://api.anthropic.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    calls += 1;
    // The second message is refused (every time: the SDK retries an
    // overload twice); everything else answers.
    if (route.request().postDataJSON().messages.at(-1).content.at(-1).text === "second") {
      return route.fulfill({ status: 529, headers: { ...cors(), "content-type": "application/json" }, body: JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }) });
    }
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: sse({ text: calls === 1 ? "One." : "Two." }) });
  });
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("first");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("One.", { timeout: 90000 });
  await page.locator("#chat-input").fill("second");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-notice.is-error")).toContainText("overloaded", { timeout: 90000 });
  await expect(page.locator("#chat-send")).toHaveText("Send");

  // ✎ is on the first message - the one still in the history - not on the
  // refused one; it used to be on the refused one and took the FIRST
  // exchange out of the history while the log kept showing it.
  await expect(page.locator(".chat-user")).toHaveCount(2);
  await expect(page.locator(".chat-edit")).toHaveCount(1);
  await expect(page.locator(".chat-user").first().locator(".chat-edit")).toHaveCount(1);
  await page.locator(".chat-user").first().hover();
  await page.locator(".chat-edit").click();
  await expect(page.locator(".chat-user")).toHaveCount(0);
  await expect(page.locator("#chat-input")).toHaveValue("first");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Two.", { timeout: 90000 });
});

test("Save on a key form left as it was keeps the conversation; a changed one starts over", async ({ page }) => {
  const requests = await answerWith(page, [{ text: "One." }, { text: "Two." }, { text: "Three." }]);
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("first");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("One.", { timeout: 90000 });

  // Opened to look, closed with Save: nothing changed, the chat stays.
  await page.locator("#chat-key-button").click();
  await expect(page.locator("#chat-key")).toBeVisible();
  await page.locator("#chat-key button[type=submit]").click();
  await expect(page.locator("#chat-key")).toBeHidden();
  await expect(page.locator(".chat-assistant")).toHaveCount(1);
  await page.locator("#chat-input").fill("second");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Two.", { timeout: 90000 });
  expect(requests[1].messages).toHaveLength(3);

  // Another key is another client: the conversation starts over.
  await page.locator("#chat-key-button").click();
  await page.locator("#chat-key-input").fill("sk-ant-another");
  await page.locator("#chat-key button[type=submit]").click();
  await page.locator("#chat-input").fill("third");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Three.", { timeout: 90000 });
  expect(requests[2].messages).toHaveLength(1);
});

test("a turn that changed the files and then failed still offers them back", async ({ page }) => {
  let calls = 0;
  await page.route("https://api.anthropic.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    calls += 1;
    if (calls === 1) {
      return route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: sse({ tools: [{ name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } }] }) });
    }
    await route.fulfill({ status: 500, headers: { ...cors(), "content-type": "application/json" }, body: JSON.stringify({ type: "error", error: { type: "api_error", message: "Internal server error" } }) });
  });
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-notice.is-error")).toContainText("had an error", { timeout: 90000 });
  await expect(page.locator("#chat-send")).toHaveText("Send");
  await expect(page.locator(".chat-checkpoint-restore")).toHaveCount(1);
  await page.locator(".chat-checkpoint-restore").click();
  await expect(page.locator("#studio-url")).toHaveText("your app");
});

test("an edit typed with CRLF lands in an LF file with LF", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [{ name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } }] },
    { tools: [{ name: "edit_file", input: { name: APP_FILE, old_text: "    IF client->check_on_init( ).\r\n      DATA(view)", new_text: "    IF client->check_on_init( ).\r\n      \" edited\r\n      DATA(view)" } }] },
    { text: "Done." },
  ]);
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Done.", { timeout: 90000 });
  expect(resultsOf(requests[2])[0].is_error).toBeUndefined();
  const source = await page.evaluate(() => window.monaco.editor.getModels().find((m) => m.uri.path.endsWith("zcl_ai_app.clas.abap")).getValue());
  expect(source).toContain('\n      " edited\n');
  expect(source).not.toContain("\r");
});

// A mocked API that answers each request from `answers` in turn (the last one
// again when they run out) and records what was sent.
async function answerWith(page, answers) {
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push(request.postDataJSON());
    const answer = answers[Math.min(requests.length, answers.length) - 1];
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: sse(answer) });
  });
  return requests;
}

const resultsOf = (request) => request.messages.at(-1).content;

test("read_files reads a file whole by its name, and edit_file forgives an indentation that is off", async ({ page }) => {
  // The model's old_text: the right lines, indented two spaces too few and
  // with a trailing space, as a model types them.
  const sloppy = "  view->ele( `Page` \n    )->a( n = `title` v = `" + MARK + "` ).";
  const typed = "  view->ele( `Page`\n    )->a( n = `title` v = `Fixed by edit` ).";
  // What lands: the file's depth for the first line (six spaces), and the
  // new text's own relative depth under it for the second.
  const fixed = "      view->ele( `Page`\n        )->a( n = `title` v = `Fixed by edit` ).";
  const requests = await answerWith(page, [
    { tools: [{ name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } }] },
    { tools: [
      { name: "read_files", input: { names: [APP_FILE] } },
      { name: "edit_file", input: { name: APP_FILE, old_text: sloppy, new_text: typed } },
      { name: "read_files", input: { names: ["zcl_nowhere.clas.abap"] } },
    ] },
    { text: "Done." },
  ]);
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Done.", { timeout: 90000 });

  const results = resultsOf(requests[2]);
  // The read names every file with its length, then the file itself, whole.
  expect(results[0].content).toMatch(new RegExp(`files in the editor: ${APP_FILE} \\(\\d+ lines\\) - the app`));
  expect(results[0].content).toContain("INTERFACES z2ui5_if_app.");
  expect(results[0].is_error).toBeUndefined();
  // The loose edit landed, at the file's own indentation.
  expect(results[1].content).toContain("matched loosely");
  const source = await page.evaluate(() => window.monaco.editor.getModels().find((m) => m.uri.path.endsWith("zcl_ai_app.clas.abap")).getValue());
  expect(source).toContain(fixed);
  expect(source).not.toContain(MARK);
  // A name that is not there is said, with what is.
  expect(results[2].is_error).toBe(true);
  expect(results[2].content).toContain("There is no file zcl_nowhere.clas.abap");
  await expect(page.frameLocator("#app").getByText("Fixed by edit")).toBeVisible();
});

test("a file with CRLF line endings takes an edit typed with LF", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [{ name: "write_file", input: { name: APP_FILE, source: APP.replace(/\n/g, "\r\n"), as_app: true } }] },
    { tools: [{ name: "edit_file", input: { name: APP_FILE, old_text: "    IF client->check_on_init( ).\n      DATA(view)", new_text: "    IF client->check_on_init( ).\n      \" edited\n      DATA(view)" } }] },
    { text: "Done." },
  ]);
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Done.", { timeout: 90000 });
  expect(resultsOf(requests[2])[0].is_error).toBeUndefined();
  const source = await page.evaluate(() => window.monaco.editor.getModels().find((m) => m.uri.path.endsWith("zcl_ai_app.clas.abap")).getValue());
  expect(source).toContain('\r\n      " edited\r\n');
});

test("a hand edit between two messages is told as the changed file, not as every file", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [
      { name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } },
      { name: "write_file", input: { name: "zif_ai_thing.intf.abap", source: "INTERFACE zif_ai_thing PUBLIC.\nENDINTERFACE.\n" } },
    ] },
    { text: "Built." },
  ]);
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Built.", { timeout: 90000 });
  // The first message carried the starting class as what the editor held.
  expect(requests[0].messages[0].content[0].text).toContain("The editor holds these files right now:");

  // By hand, in the interface only.
  await page.evaluate(() => {
    const model = window.monaco.editor.getModels().find((m) => m.uri.path.endsWith("zif_ai_thing.intf.abap"));
    model.setValue(model.getValue().replace("PUBLIC.", "PUBLIC.\n  CONSTANTS c TYPE i VALUE 1."));
  });
  await page.locator("#chat-input").fill("and now?");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant")).toHaveCount(2, { timeout: 90000 });
  await expect(page.locator("#chat-send")).toHaveText("Send");
  const told = requests[2].messages.at(-1).content[0].text;
  expect(told).toContain("changed: zif_ai_thing.intf.abap");
  expect(told).toContain(`files in the editor: ${APP_FILE}`);
  expect(told).toContain("CONSTANTS c TYPE i VALUE 1.");
  // The app's class did not change and is not sent again.
  expect(told).not.toContain("INTERFACES z2ui5_if_app.");
});

test("an answer cut off at max_tokens runs none of its tools, and the model is asked for smaller steps", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [{ name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } }], stop: "max_tokens" },
    { text: "I will write less." },
  ]);
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("I will write less.", { timeout: 90000 });
  await expect(page.locator(".chat-notice")).toContainText("ran out of room");
  await expect(page.locator(".chat-tool.is-error")).toContainText("cut off");
  const result = resultsOf(requests[1])[0];
  expect(result.is_error).toBe(true);
  expect(result.content).toContain("may be cut off");
  // Nothing was written: the studio is still on its starting class.
  const files = await page.evaluate(() =>
    window.monaco.editor.getModels().filter((m) => m.uri.scheme === "file").map((m) => m.uri.path.slice(1)));
  expect(files).toEqual(["zcl_app.clas.abap"]);
});

test("a declined answer keeps the conversation valid for the next message", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [{ name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } }], stop: "refusal" },
    { text: "Something else, then." },
  ]);
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-notice")).toContainText("declined");
  await expect(page.locator("#chat-send")).toHaveText("Send");
  await page.locator("#chat-input").fill("Another page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Something else, then.", { timeout: 90000 });
  // The declined turn stands in the history as a plain placeholder, no
  // tool_use left unanswered.
  const history = requests[1].messages;
  expect(history[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "(The request was declined.)" }] });
  expect(JSON.stringify(history)).not.toContain("toolu_0");
});

test("Stop ends a turn whose answer is still on its way, and the next message goes out", async ({ page }) => {
  let hung = 0;
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push(request.postDataJSON());
    if (requests.length === 1) {
      // An answer that never arrives: left to Stop.
      hung += 1;
      await new Promise((resolve) => setTimeout(resolve, 60000));
      return route.abort();
    }
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: sse({ text: "Here." }) });
  });
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator("#chat-send")).toHaveText("Stop");
  await expect.poll(() => hung).toBe(1);
  await page.locator("#chat-send").click();
  await expect(page.locator(".chat-notice").last()).toHaveText("Stopped.");
  await expect(page.locator("#chat-send")).toHaveText("Send");
  await expect(page.locator("#status")).toHaveText("stopped");

  await page.locator("#chat-input").fill("again");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Here.", { timeout: 60000 });
  // The stopped message stayed in the history, and the new one follows it.
  expect(requests[1].messages.map((m) => m.role)).toEqual(["user", "user"]);
});

// Once the run is clean the model can try what it built: the screen comes
// with the run's report as the agent snapshot, and act types into the app
// on the stage and presses its button - the Pilot's eyes and hands
// (src/shell/ai-operator.mjs), on Run's own frame.
const GREETER = `CLASS zcl_ai_greet DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
    DATA name     TYPE string.
    DATA greeting TYPE string.
ENDCLASS.
CLASS zcl_ai_greet IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    IF client->check_on_navigated( ).
      DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
          )->ele( n = \`View\` ns = \`mvc\`
              )->a( n = \`xmlns\`     v = \`sap.m\`
              )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).
      DATA(page) = view->ele( \`Page\`
          )->a( n = \`title\` v = \`Greeter\` ).
      page->tag( \`Input\`
          )->a( n = \`value\` v = client->_bind( name ) ).
      page->tag( \`Button\`
          )->a( n = \`text\`  v = \`Greet\`
          )->a( n = \`press\` v = client->_event( \`GREET\` ) ).
      page->tag( \`Text\`
          )->a( n = \`text\` v = client->_bind( greeting ) ).
      client->view_display( view->stringify( ) ).
    ELSEIF client->check_on_event( \`GREET\` ).
      greeting = |Hello { name }!|.
      client->message_toast_display( greeting ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.`;

test("after a clean run the model tries the app: the screen rides on the report, act types and presses on the stage", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [{ name: "write_file", input: { name: "zcl_ai_greet.clas.abap", source: GREETER, as_app: true } }] },
    { tools: [{ name: "act", input: { values: { NAME: "Carol" }, event: "GREET" } }] },
    { tools: [{ name: "act", input: { event: "NOWHERE" } }, { name: "look", input: {} }] },
    { text: "It greets." },
  ]);
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A greeter");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("It greets.", { timeout: 120000 });

  // The run's report ends on the screen: the Input, the Greet action.
  const report = resultsOf(requests[1])[0].content;
  expect(report).toContain("screen (agent snapshot");
  expect(report).toMatch(/"event":"GREET"/);
  expect(report).toMatch(/"path":"\/NAME"/);

  // The act happened in the real app: the ABAP ran, the toast came up, and
  // the model read the answer.
  const acted = resultsOf(requests[2])[0];
  expect(acted.is_error).toBeUndefined();
  expect(acted.content).toContain("Hello Carol!");
  await expect(page.locator(".chat-tool").filter({ hasText: "pressed GREET" })).toContainText("Hello Carol!");
  await expect(page.frameLocator("#app").getByText("Hello Carol!").first()).toBeVisible();

  // An event the screen does not offer is refused with what it does, and
  // nothing was pressed; look reads the screen again.
  const refused = resultsOf(requests[3]);
  expect(refused[0].is_error).toBe(true);
  expect(refused[0].content).toContain("no action 'NOWHERE'");
  expect(refused[0].content).toContain("GREET");
  expect(refused[1].content).toContain('"value":"Carol"');
});

// Phase 5: a step's files can be put back, the last message edited and sent
// again, the conversation exported, and a table or a link in the answer
// rendered as one.
test("a step's files can be put back, and the last message edited and sent again", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [{ name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } }] },
    { text: "| Field | Type |\n| --- | --- |\n| NAME | string |\n\nSee [the docs](https://abap2ui5.github.io/docs/) and [no](http://x.y/) - *really*, zcl_app_main is a name." },
    { text: "Again, differently." },
  ]);
  await openStudio(page);
  await saveKey(page);
  await page.locator("#chat-input").fill("A page");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last().locator("table td").first()).toHaveText("NAME", { timeout: 90000 });
  // A link only for https, opened beside; a plain http stays text.
  const link = page.locator(".chat-assistant").last().locator("a");
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("href", "https://abap2ui5.github.io/docs/");
  await expect(link).toHaveAttribute("target", "_blank");
  // *italic*, and an underscore in a name is not one.
  await expect(page.locator(".chat-assistant").last().locator("em")).toHaveText("really");
  await expect(page.locator(".chat-assistant").last()).toContainText("zcl_app_main is a name");
  await expect(page.frameLocator("#app").getByText(MARK)).toBeVisible();

  // The files changed in this step: offered back.
  await page.locator(".chat-checkpoint-restore").click();
  await expect(page.locator(".chat-checkpoint")).toHaveCount(0);
  const files = await page.evaluate(() =>
    window.monaco.editor.getModels().filter((m) => m.uri.scheme === "file").map((m) => m.uri.path.slice(1)));
  expect(files).toEqual(["zcl_app.clas.abap"]);
  await expect(page.locator("#studio-url")).toHaveText("your app");

  // Edit the message: the exchange goes, the text is back in the box, and
  // the next request's history starts over with the new message - which
  // tells the model the editor as it is now (the starter again).
  await page.locator(".chat-user").hover();
  await page.locator(".chat-edit").click();
  await expect(page.locator(".chat-assistant")).toHaveCount(0);
  await expect(page.locator("#chat-input")).toHaveValue("A page");
  await page.locator("#chat-input").fill("A page, but blue");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toHaveText("Again, differently.", { timeout: 90000 });
  const history = requests.at(-1).messages;
  expect(history).toHaveLength(1);
  expect(history[0].content.at(-1).text).toBe("A page, but blue");
  // Rewound to before the first message, the model has seen nothing of the
  // editor yet - it is told the whole of it, the starter again.
  expect(history[0].content[0].text).toContain("The editor holds these files right now:");
  expect(history[0].content[0].text).toContain("METHOD z2ui5_if_app~main.");

  // The conversation as a file.
  const downloaded = page.waitForEvent("download");
  await page.locator("#chat-export").click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^abap2ui5-ai-studio-.*\.md$/);
  const text = await new Response(await file.createReadStream()).text();
  expect(text).toContain("## You\n\nA page, but blue");
  expect(text).toContain("Again, differently.");
  expect(text).not.toContain(KEY);
});

// One streamed Chat Completions answer, as an OpenAI-compatible server sends
// it: text deltas, then each tool call's arguments in two pieces under its
// index, then the finish reason and the usage.
function openaiSse({ text = "", tools = [] }) {
  const chunks = [];
  const send = (choice, extra = {}) => chunks.push(`data: ${JSON.stringify({ id: "chatcmpl-test", model: "local-test", choices: choice ? [choice] : [], ...extra })}\n\n`);
  if (text) send({ index: 0, delta: { role: "assistant", content: text } });
  for (const [i, tool] of tools.entries()) {
    const json = JSON.stringify(tool.input);
    const half = Math.floor(json.length / 2);
    send({ index: 0, delta: { tool_calls: [{ index: i, id: `call_${i}`, type: "function", function: { name: tool.name, arguments: json.slice(0, half) } }] } });
    send({ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: json.slice(half) } }] } });
  }
  send({ index: 0, delta: {}, finish_reason: tools.length ? "tool_calls" : "stop" });
  send(null, { usage: { prompt_tokens: 900, completion_tokens: 120 } });
  chunks.push("data: [DONE]\n\n");
  return chunks.join("");
}

test("an OpenAI-compatible server answers the studio: tools as function calls, results as tool messages, no key it was not given", async ({ page }) => {
  const requests = [];
  // Anthropic is not to be asked at all once the provider is switched.
  await page.route("https://api.anthropic.com/**", (route) => route.abort());
  await page.route("http://localhost:11434/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push({ url: request.url(), headers: request.headers(), body: request.postDataJSON() });
    const answer = requests.length === 1
      ? openaiSse({ text: "Building it.", tools: [{ name: "write_file", input: { name: APP_FILE, source: APP, as_app: true } }] })
      : openaiSse({ text: "**Done** - it runs." });
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: answer });
  });

  await openStudio(page);
  // An Anthropic key first - and then a local server, with no key typed:
  // the Anthropic key must not go along as its bearer.
  await saveKey(page);
  await page.locator("#chat-key-button").click();
  await page.locator("#chat-provider").selectOption("openai");
  await expect(page.locator("#chat-openai")).toBeVisible();
  await expect(page.locator("#chat-workspace")).toBeHidden();
  await expect(page.locator("#chat-key-note-openai")).toContainText("OLLAMA_ORIGINS");
  // OpenAI's own server needs no word; any other is named before a key is typed.
  await expect(page.locator("#chat-key-target")).toBeHidden();
  await page.locator("#chat-base-url").fill("http://localhost:11434/v1/");
  await expect(page.locator("#chat-key-target")).toHaveText("Your key will be sent to localhost:11434.");
  await page.locator("#chat-model").fill("local-test");
  await page.locator("#chat-key button[type=submit]").click();
  await expect(page.locator("#chat-key")).toBeHidden();
  // The speeds are Anthropic's models; this server has one.
  await expect(page.locator("#chat-speed")).toBeHidden();

  await page.locator("#chat-input").fill("A page that says it was built by the model");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator(".chat-assistant").last()).toContainText("Done - it runs.", { timeout: 90000 });
  await expect(page.frameLocator("#app").getByText(MARK)).toBeVisible();

  // Chat Completions at the base URL, the trailing slash gone, no bearer.
  expect(requests[0].url).toBe("http://localhost:11434/v1/chat/completions");
  expect(requests[0].headers.authorization).toBeUndefined();
  expect(requests[0].headers["x-api-key"]).toBeUndefined();
  const first = requests[0].body;
  expect(first.model).toBe("local-test");
  expect(first.stream).toBe(true);
  expect(first.messages[0].role).toBe("system");
  expect(first.messages[1].role).toBe("user");
  expect(first.tools.map((t) => t.type)).toContain("function");
  expect(first.tools.map((t) => t.function.name)).toContain("write_file");
  // The call went back as the assistant's tool_calls and its result as a
  // tool message answering it - with the run's report in it.
  const second = requests[1].body.messages;
  const call = second.find((m) => m.role === "assistant" && m.tool_calls);
  expect(call.tool_calls[0]).toMatchObject({ id: "call_0", type: "function", function: { name: "write_file" } });
  expect(JSON.parse(call.tool_calls[0].function.arguments).name).toBe(APP_FILE);
  const result = second.find((m) => m.role === "tool");
  expect(result.tool_call_id).toBe("call_0");
  expect(result.content).toContain("status: running");

  // The provider, the base URL and the model are remembered; no key is.
  const stored = await page.evaluate(() => ({ ...localStorage }));
  expect(JSON.parse(stored["abap2ui5-playground:llm"])).toEqual({ provider: "openai", baseUrl: "http://localhost:11434/v1", model: "local-test" });
  expect(JSON.stringify(stored)).not.toContain(KEY);
});

test("a base URL somebody else stored is said on the key form, and one that is not http(s) is not followed", async ({ page }) => {
  // localStorage is where a link's ABAP can write (src/shell/linked-code.mjs):
  // a base URL put there sends the next key typed to that server.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("abap2ui5-playground:llm", JSON.stringify({ provider: "openai", baseUrl: "https://collector.example/v1", model: "m" }));
  });
  await openStudio(page);
  await expect(page.locator("#chat-key")).toBeVisible();
  await expect(page.locator("#chat-key-target")).toHaveText("Your key will be sent to collector.example.");
  // Plain http to another machine is said as well.
  await page.locator("#chat-base-url").fill("http://192.168.1.20:8000/v1");
  await expect(page.locator("#chat-key-target")).toContainText("192.168.1.20:8000 - over plain http");

  // A stored URL that is no web server is read back as the default.
  await page.evaluate(() =>
    localStorage.setItem("abap2ui5-playground:llm", JSON.stringify({ provider: "openai", baseUrl: "javascript:alert(1)" })));
  await page.reload();
  await expect(page.locator("#status")).toHaveText("ready - describe the app you want", { timeout: 120000 });
  await expect(page.locator("#chat-base-url")).toHaveValue("https://api.openai.com/v1");
  await expect(page.locator("#chat-key-target")).toBeHidden();
});
