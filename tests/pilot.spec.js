import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";

// The AI Pilot (src/shell/pilot.mjs, src/shell/pilot-agent.mjs), on its own
// page pilot/index.html: Claude operates the running app while the reader
// watches. No test talks to a model - api.anthropic.com is answered here with
// the events the Messages API streams, as in tests/ai.spec.js - so what is
// held is the page's half: the act reaching the REAL app in the frame (the
// field filled, the button's event run by the ABAP, the answer rendered by
// the frontend), what the model is told afterwards, and the reader's own
// clicks reaching the model too.
//
// The app is the one the page opens on, Basics II (z2ui5_cl_smp_app_494):
// an Input bound to NAME, a Greet button, GREETING written back and a
// MessageBox that confirms the roundtrip.

const KEY = "sk-ant-test-key";

function sse({ text = "", tools = [] }) {
  const events = [];
  const send = (type, data) => events.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", {
    message: {
      id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 },
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
  send("message_delta", { delta: { stop_reason: tools.length ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 120 } });
  send("message_stop", {});
  return events.join("");
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
  };
}

// The model, played by the test: one answer per request, in order.
async function answerWith(page, answers) {
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    requests.push({ headers: request.headers(), body: request.postDataJSON() });
    const answer = answers[Math.min(requests.length, answers.length) - 1];
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: sse(answer) });
  });
  return requests;
}

async function openPilot(page) {
  await page.goto("/pilot/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("body")).toHaveClass(/is-pilot/);
  // The app is live, and the bar names it once the Pilot has seen its start.
  await expect(page.locator("#pilot-app-name")).toContainText("Z2UI5_CL_SMP_APP_494", { timeout: 30000 });
}

async function useKey(page) {
  await expect(page.locator("#pilot-key")).toBeVisible();
  await page.locator("#pilot-key-input").fill(KEY);
  await page.locator("#pilot-key button[type=submit]").click();
  await expect(page.locator("#pilot-key")).toBeHidden();
}

async function say(page, text) {
  await page.locator("#pilot-input").fill(text);
  await page.locator("#pilot-input").press("Enter");
}

// The text of every block of a request's message, tool results included.
const textOf = (message) =>
  (Array.isArray(message.content) ? message.content : [{ text: message.content }])
    .map((b) => (typeof b.content === "string" ? b.content : b.text ?? ""))
    .join("\n");

test("the Pilot types into the app on screen, presses its button and reads the answer", async ({ page }) => {
  const requests = await answerWith(page, [
    { text: "I will greet Carol.", tools: [{ name: "act", input: { values: { "/NAME": "Carol" }, event: "GREET" } }] },
    { text: "**Done** - the app greeted Carol." },
  ]);
  await openPilot(page);
  // The page is the Pilot's: the site's bar, the toolbar and the editor step
  // aside, the app and the chat are on screen.
  await expect(page.locator("header.bar")).toBeHidden();
  await expect(page.locator("#run")).toBeHidden();
  await expect(page.locator("#editor")).toBeHidden();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#pilot")).toBeVisible();

  await useKey(page);
  await say(page, "Greet Carol");
  await expect(page.locator(".pilot-assistant").last()).toContainText("Done - the app greeted Carol.", { timeout: 60000 });

  // It happened in the app on screen: the ABAP read the name and wrote the
  // greeting, the frontend rendered it, and the MessageBox came up.
  const app = page.frameLocator("#app");
  await expect(app.getByText("Hello Carol!")).toBeVisible();
  await expect(app.getByText("Roundtrip done: the backend read NAME = 'Carol'")).toBeVisible();
  await expect(page.locator(".pilot-tool").first()).toContainText("typed 1 value, pressed GREET");

  // The first message carried the screen as the agent snapshot, so the model
  // knew the field and the button before it acted.
  const first = textOf(requests[0].body.messages[0]);
  expect(first).toContain("<screen>");
  expect(first).toContain('"path":"/NAME"');
  expect(first).toContain('"event":"GREET"');
  expect(requests[0].headers["x-api-key"]).toBe(KEY);
  // ...and the act's result is the screen after it, with the app's answer.
  const result = textOf(requests[1].body.messages.at(-1));
  expect(result).toContain("Hello Carol!");
  expect(result).toContain("Roundtrip done");
});

test("an act the screen does not offer is refused with what it does offer, and nothing is sent", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [{ name: "act", input: { event: "LAUNCH_ROCKET" } }] },
    { text: "That app cannot do that." },
  ]);
  await openPilot(page);
  await useKey(page);
  const roundtrips = await page.locator("#roundtrip-count").textContent();
  await say(page, "Launch the rocket");
  await expect(page.locator(".pilot-assistant").last()).toContainText("cannot do that", { timeout: 60000 });
  const refusal = requests[1].body.messages.at(-1).content[0];
  expect(refusal.is_error).toBe(true);
  expect(refusal.content).toContain("LAUNCH_ROCKET");
  expect(refusal.content).toContain("GREET");
  await expect(page.locator(".pilot-tool.is-error")).toHaveCount(1);
  // Refused before anything went over the wire: no roundtrip was added.
  expect(await page.locator("#roundtrip-count").textContent()).toBe(roundtrips);
});

test("two presses in one answer: the second, on a screen the model has not seen, is refused", async ({ page }) => {
  // The model wrote both for the screen it was shown: the second GREET is a
  // button of the screen the first one answered - as a1 was NEXT, then
  // DELETE_ALL.
  const requests = await answerWith(page, [
    { tools: [{ name: "act", input: { values: { "/NAME": "Ann" }, event: "GREET" } }, { name: "act", input: { event: "GREET" } }] },
    { text: "Greeted once." },
  ]);
  await openPilot(page);
  await useKey(page);
  const roundtrips = Number(await page.locator("#roundtrip-count").textContent());
  await say(page, "Greet Ann twice");
  await expect(page.locator(".pilot-assistant").last()).toContainText("Greeted once.", { timeout: 60000 });
  const [first, second] = requests[1].body.messages.at(-1).content;
  expect(first.is_error).toBeUndefined();
  expect(second.is_error).toBe(true);
  expect(second.content).toContain("the screen changed since you saw it");
  expect(second.content).toContain("The screen now:");
  expect(Number(await page.locator("#roundtrip-count").textContent())).toBe(roundtrips + 1);
});

test("an argument a tool does not take is refused, and nothing is typed or pressed", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [{ name: "act", input: { value: { "/NAME": "Carol" }, event: "GREET" } }, { name: "look", input: { max_rows: "lots" } }] },
    { text: "I will use values." },
  ]);
  await openPilot(page);
  await useKey(page);
  const roundtrips = await page.locator("#roundtrip-count").textContent();
  await say(page, "Greet Carol");
  await expect(page.locator(".pilot-assistant").last()).toContainText("I will use values.", { timeout: 60000 });
  const [act, look] = requests[1].body.messages.at(-1).content;
  expect(act.is_error).toBe(true);
  expect(act.content).toContain("act has no argument 'value' - its arguments:");
  expect(act.content).toContain("values");
  expect(look.is_error).toBe(true);
  expect(look.content).toContain('max_rows is a whole number, not "lots"');
  expect(await page.locator("#roundtrip-count").textContent()).toBe(roundtrips);
  await expect(page.frameLocator("#app").locator("input").first()).not.toHaveValue("Carol");
});

test("a screen too large for one answer is fitted: whole JSON, its actions and messages kept", async () => {
  const { fitSnapshot } = await import("../src/shell/pilot-agent.mjs");
  const snapshot = {
    snapshotVersion: 1,
    fields: [{ id: "f1", value: "x".repeat(120000), editable: true }, { id: "f2", path: "/NAME", value: "", editable: true }],
    actions: [{ id: "a1", event: "SAVE" }],
    tables: [{ id: "t1", rowCount: 200, truncated: false, editableCells: ["A"], rows: Array.from({ length: 200 }, (_, i) => ({ A: `${i}`.padEnd(500, ".") })) }],
    messages: [{ type: "success", text: "PONG" }],
  };
  const fitted = fitSnapshot(snapshot, 30000);
  const text = JSON.stringify(fitted);
  expect(text.length).toBeLessThanOrEqual(30000);
  expect(fitted.actions).toEqual(snapshot.actions);
  expect(fitted.messages).toEqual(snapshot.messages);
  expect(fitted.fields[0].editable).toBe(false);
  expect(fitted.fields[1].editable).toBe(true);
  expect(fitted.tables[0].truncated).toBe(true);
  expect(fitted.cut.join(" ")).toMatch(/f1 .*cut.*table t1 shows its first \d+ row/);
  expect(fitSnapshot({ fields: [] }, 30000)).toEqual({ fields: [] });
});

test("an answer whose connection dropped half way is said, not sent again", async ({ page }) => {
  // Started, a few words, then nothing: no message_stop.
  const torn = sse({ text: "Half an ans" }).split("event: content_block_stop")[0];
  let sent = 0;
  await page.route("https://api.anthropic.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    sent += 1;
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: torn });
  });
  await openPilot(page);
  await useKey(page);
  await say(page, "Greet Carol");
  await expect(page.locator(".pilot-notice.is-error")).toContainText("dropped mid-answer", { timeout: 60000 });
  expect(sent).toBe(1);
});

test("what the reader does in the app is told to the model with the next message", async ({ page }) => {
  const requests = await answerWith(page, [{ text: "I see." }]);
  await openPilot(page);
  await useKey(page);

  // The reader takes the controls: types a name and presses Greet themselves.
  const app = page.frameLocator("#app");
  const input = app.locator("input").first();
  await input.fill("Dora");
  await input.press("Tab");
  await app.getByRole("button", { name: "Greet" }).click();
  await expect(app.getByText("Hello Dora!")).toBeVisible();

  await say(page, "What happened?");
  await expect(page.locator(".pilot-assistant").last()).toContainText("I see.", { timeout: 60000 });
  const first = textOf(requests[0].body.messages[0]);
  expect(first).toContain("Hello Dora!");
});

test("the Pilot opens another app, works through its popup and picks a row", async ({ page }) => {
  // The value help sample: a valueHelpRequest opens a Dialog with a table,
  // a row is ticked, Continue writes the pick into the field behind it.
  const requests = await answerWith(page, [
    { tools: [{ name: "open_app", input: { class: "z2ui5_cl_smp_app_009" } }] },
    { tools: [{ name: "act", input: { event: "POPUP_TABLE_VALUE" } }] },
    { tools: [{ name: "act", input: { values: { "/T_SUGGESTION_SEL/2/SELKZ": true }, event: "POPUP_TABLE_VALUE_CONTINUE" } }] },
    { text: "BLACK it is." },
  ]);
  await openPilot(page);
  await useKey(page);
  await say(page, "Open the value help sample and pick the third colour");
  await expect(page.locator(".pilot-assistant").last()).toContainText("BLACK it is.", { timeout: 90000 });

  // The new app is the one on screen, said in the chat and in the bar.
  await expect(page.locator(".pilot-card")).toContainText("is now on Z2UI5_CL_SMP_APP_009");
  await expect(page.locator("#pilot-app-name")).toContainText("Z2UI5_CL_SMP_APP_009");
  // The popup was the model's screen while it was open...
  const popup = JSON.parse(textOf(requests[2].body.messages.at(-1)));
  expect(popup.layer).toBe("popup");
  expect(popup.tables[0].path).toBe("/T_SUGGESTION_SEL");
  // ...and its pick is in the field behind it, in the app on screen.
  const app = page.frameLocator("#app");
  await expect(app.getByRole("textbox", { name: "Input with value" })).toHaveValue("BLACK");
  await expect(app.getByRole("dialog")).toHaveCount(0);
  const after = JSON.parse(textOf(requests[3].body.messages.at(-1)));
  expect(after.layer).toBe("main");
  expect(after.fields.find((f) => f.path === "/S_SCREEN/COLOR_02").value).toBe("BLACK");
});

test("an app that dumps as it starts is said at once, with the dump", async ({ page }) => {
  // A catalogued class, answered here with one whose first roundtrip divides
  // by zero: the frame shows the dump and never a main view.
  const cls = "z2ui5_cl_smpc_app_001";
  await page.route(`https://raw.githubusercontent.com/**/${cls}.clas.abap`, (route) => route.fulfill({
    status: 200,
    body: `CLASS ${cls} DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES z2ui5_if_app.\nENDCLASS.\n\n`
      + `CLASS ${cls} IMPLEMENTATION.\n  METHOD z2ui5_if_app~main.\n    DATA(zero) = 0.\n    DATA(out) = |{ 1 / zero }|.\n`
      + "  ENDMETHOD.\nENDCLASS.\n",
  }));
  const requests = await answerWith(page, [
    { tools: [{ name: "open_app", input: { class: cls } }] },
    { text: "It dumped." },
  ]);
  await openPilot(page);
  await useKey(page);
  const asked = Date.now();
  await say(page, "Open it");
  await expect(page.locator(".pilot-assistant").last()).toContainText("It dumped.", { timeout: 60000 });
  // Not the thirty seconds a start is given, and not "did not start within".
  expect(Date.now() - asked).toBeLessThan(20000);
  const result = requests[1].body.messages.at(-1).content[0];
  expect(result.is_error).toBe(true);
  expect(result.content).toContain("Division by zero");
});

test("a value typed without an event shows in the field and stays pending", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [{ name: "act", input: { values: { "/NAME": "Eve" } } }] },
    { text: "Typed." },
  ]);
  await openPilot(page);
  await useKey(page);
  await say(page, "Type Eve, but do not greet yet");
  await expect(page.locator(".pilot-assistant").last()).toContainText("Typed.", { timeout: 60000 });
  // In the field on screen, not sent: no greeting yet.
  const app = page.frameLocator("#app");
  await expect(app.locator("input").first()).toHaveValue("Eve");
  await expect(app.getByText("Hello Eve!")).toHaveCount(0);
  expect(JSON.parse(textOf(requests[1].body.messages.at(-1))).pending).toEqual(["/NAME"]);
  // The reader presses Greet: what the Pilot typed goes out with it, as
  // typing would have.
  await app.getByRole("button", { name: "Greet" }).click();
  await expect(app.getByText("Hello Eve!")).toBeVisible();
});

test("what the reader typed and did not send goes with the Pilot's step, and nothing either typed stays pending after it", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [{ name: "act", input: { event: "GREET" } }] },
    { text: "Greeted." },
    { tools: [{ name: "act", input: { values: { "/NAME": "Carol" }, event: "GREET" } }] },
    { text: "Again." },
  ]);
  await openPilot(page);
  await useKey(page);
  const app = page.frameLocator("#app");
  const frame = await (await page.locator("#app").elementHandle()).contentFrame();
  const pending = () => frame.evaluate(() => window.__z2ui5PlaygroundPilot.pending());

  // The reader types a name and presses nothing: no roundtrip, so only the
  // frame knows it.
  await app.locator("input").first().fill("Bob");
  await app.locator("input").first().press("Tab");
  await say(page, "Greet them");
  await expect(page.locator(".pilot-assistant").last()).toContainText("Greeted.", { timeout: 60000 });
  // The model was told, and its GREET carried the name the reader typed.
  expect(textOf(requests[0].body.messages[0])).toContain("Bob");
  await expect(app.getByText("Hello Bob!")).toBeVisible();
  // Sent, so no longer pending - it went out once and is done.
  expect(await pending()).toEqual({});

  // The Pilot's own typing likewise: sent with its event and then cleared,
  // not put back over every later answer and sent again with the reader's
  // next click.
  await say(page, "Now greet Carol");
  await expect(page.locator(".pilot-assistant").last()).toContainText("Again.", { timeout: 60000 });
  await expect(app.getByText("Hello Carol!")).toBeVisible();
  expect(await pending()).toEqual({});
});

test("Ctrl+Enter in the Pilot's chat sends, and does not restart the apps under the reader", async ({ page }) => {
  await answerWith(page, [{ text: "Here." }]);
  await openPilot(page);
  await useKey(page);
  const app = page.frameLocator("#app");
  await app.locator("input").first().fill("Bob");
  await app.locator("input").first().press("Tab");
  await page.locator("#pilot-input").fill("Are you there?");
  await page.locator("#pilot-input").press("Control+Enter");
  await expect(page.locator(".pilot-assistant").last()).toContainText("Here.", { timeout: 60000 });
  // The playground's Run shortcut started every app over on a fresh
  // database: the name went back to "World".
  await expect(app.locator("input").first()).toHaveValue("Bob");
});

test("several apps side by side: the Pilot opens one beside, works in both, and each keeps its state", async ({ page }) => {
  const requests = await answerWith(page, [
    { tools: [{ name: "open_app", input: { class: "z2ui5_cl_smp_app_009", beside: true } }] },
    { tools: [{ name: "act", input: { app: "2", event: "POPUP_TABLE_VALUE" } }] },
    { tools: [{ name: "act", input: { app: "2", values: { "/T_SUGGESTION_SEL/1/SELKZ": true }, event: "POPUP_TABLE_VALUE_CONTINUE" } }] },
    { tools: [{ name: "act", input: { app: "1", values: { "/NAME": "Blue" }, event: "GREET" } }] },
    { text: "Both done." },
  ]);
  await openPilot(page);
  await useKey(page);
  await say(page, "Pick a colour in the value help app and greet it in the first one");
  await expect(page.locator(".pilot-assistant").last()).toContainText("Both done.", { timeout: 90000 });

  // Two apps on the stage, a tab each, and the chat said the second one came.
  await expect(page.locator(".pilot-tab")).toHaveCount(2);
  await expect(page.locator(".pilot-card")).toContainText("Opened Z2UI5_CL_SMP_APP_009 beside - tab 2");
  // The second app has the pick in its own frame...
  const second = page.frameLocator("iframe.pilot-frame");
  await expect(second.getByRole("textbox", { name: "Input with value" })).toHaveValue("BLUE");
  // ...and the first, brought back on screen by the act on it, its greeting.
  await expect(page.locator('.pilot-tab[data-tab="1"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.frameLocator("#app").getByText("Hello Blue!")).toBeVisible();
  // Every answer said which app it was about.
  expect(JSON.parse(textOf(requests[3].body.messages.at(-1))).tab).toBe("2");
  expect(JSON.parse(textOf(requests[4].body.messages.at(-1))).tab).toBe("1");

  // The reader closes the second tab; the first app is untouched.
  await page.locator(".pilot-tab-close").click();
  await expect(page.locator(".pilot-tab")).toHaveCount(1);
  await expect(page.locator("iframe.pilot-frame")).toHaveCount(0);
  await expect(page.frameLocator("#app").getByText("Hello Blue!")).toBeVisible();
});

test("Restart starts every app on the stage again", async ({ page }) => {
  await answerWith(page, [
    { tools: [{ name: "open_app", input: { class: "z2ui5_cl_smp_app_009", beside: true } }] },
    { tools: [{ name: "act", input: { app: "2", values: { "/S_SCREEN/QUANTITY": 7 }, event: "BUTTON_SEND" } }] },
    { text: "Sent." },
  ]);
  await openPilot(page);
  await useKey(page);
  await say(page, "Open the value help beside and send a quantity of 7");
  await expect(page.locator(".pilot-assistant").last()).toContainText("Sent.", { timeout: 90000 });
  const second = page.frameLocator("iframe.pilot-frame");
  await expect(second.locator('input[placeholder="quantity"]')).toHaveValue("7");
  await page.locator("#pilot-restart").click();
  await expect(page.locator(".pilot-tab")).toHaveCount(2);
  await expect(second.locator('input[placeholder="quantity"]')).not.toHaveValue("7", { timeout: 30000 });
});

test("what the reader typed stays on the model's screen when the answer carries no model", async ({ page }) => {
  // Send in the value help sample changes nothing bound, so the framework
  // answers without a MODEL - and the client keeps what it sent, here the
  // reader's 5, which the model must be told about.
  const requests = await answerWith(page, [
    { tools: [{ name: "open_app", input: { class: "z2ui5_cl_smp_app_009" } }] },
    { text: "Opened." },
    { text: "You sent 5." },
  ]);
  await openPilot(page);
  await useKey(page);
  await say(page, "Open the value help sample");
  await expect(page.locator(".pilot-assistant").last()).toContainText("Opened.", { timeout: 90000 });
  const app = page.frameLocator("#app");
  await app.locator('input[placeholder="quantity"]').fill("5");
  await app.locator('input[placeholder="quantity"]').press("Tab");
  await app.getByRole("button", { name: "Send to Server" }).click();
  await expect(app.getByText("success - values sent to the server")).toBeVisible();
  await say(page, "What did I send?");
  await expect(page.locator(".pilot-assistant").last()).toContainText("You sent 5.", { timeout: 60000 });
  // The message carried the changed screen, with the 5 in it.
  const told = textOf(requests[2].body.messages.at(-1));
  expect(told).toContain("<screen>");
  const snapshot = JSON.parse(told.slice(told.indexOf("{"), told.lastIndexOf("}") + 1));
  expect(snapshot.fields.find((f) => f.path === "/S_SCREEN/QUANTITY").value).toBe("5");
});

test("files go with a message: a PDF as it is, a spreadsheet as CSV, a Word document as text", async ({ page }) => {
  const requests = await answerWith(page, [{ text: "Three files read." }]);
  await openPilot(page);
  await useKey(page);
  const input = page.locator("#pilot-file-input");
  await input.setInputFiles([
    "tests/fixtures/orders.xlsx",
    "tests/fixtures/brief.docx",
    "tests/fixtures/note.pdf",
  ]);
  // The old binary format is refused at once, with what to save it as.
  await input.setInputFiles([{ name: "old.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("x") }]);
  await expect(page.locator(".pilot-notice.is-error")).toContainText("old.xls is the old binary Office format");
  await expect(page.locator(".pilot-file")).toHaveCount(3);
  // One removed and added again: still three, no duplicate.
  await page.locator(".pilot-file-remove").first().click();
  await expect(page.locator(".pilot-file")).toHaveCount(2);
  await input.setInputFiles(["tests/fixtures/orders.xlsx"]);
  await expect(page.locator(".pilot-file")).toHaveCount(3);

  await say(page, "Enter these orders");
  await expect(page.locator(".pilot-assistant").last()).toContainText("Three files read.", { timeout: 60000 });
  // The chips went with the message, and the message lists them.
  await expect(page.locator(".pilot-file")).toHaveCount(0);
  await expect(page.locator(".pilot-user .pilot-user-files")).toContainText("📎 orders.xlsx");

  const content = requests[0].body.messages[0].content;
  const documents = content.filter((b) => b.type === "document");
  const pdf = documents.find((b) => b.source.media_type === "application/pdf");
  expect(pdf.title).toBe("note.pdf");
  expect(Buffer.from(pdf.source.data, "base64").toString("latin1")).toContain("%PDF-1.4");
  const sheet = documents.find((b) => b.title === "orders.xlsx - sheet Orders").source.data;
  expect(sheet).toContain("Name,Quantity\nCarol,7\n\"Dora, Jr.\",12.5\nEve,,late");
  const word = documents.find((b) => b.title === "brief.docx").source.data;
  expect(word).toBe("Greet Frida\nthen\tstop");
  // ...and the text comes last.
  expect(content.at(-1)).toEqual({ type: "text", text: "Enter these orders" });
});

test("a file comes out as its author saw it: a Windows code page, a text box once, a sheet's rows where they are", async ({ page }) => {
  const requests = await answerWith(page, [{ text: "Read." }]);
  await openPilot(page);
  await useKey(page);
  const input = page.locator("#pilot-file-input");
  await input.setInputFiles([
    // An Excel "CSV (Comma delimited)" on Windows: Windows-1252, not UTF-8.
    { name: "kunden.csv", mimeType: "text/csv", buffer: Buffer.from("Name;Ort\nMüller;Köln\n", "latin1") },
  ]);
  await input.setInputFiles([
    // A paragraph holding a text box: Word writes the box twice.
    "tests/fixtures/textbox.docx",
    // Rows 1, 5 and 9 - the empty rows between are not in the file.
    "tests/fixtures/gaps.xlsx",
  ]);
  // An empty file is refused at once - the API refused the whole message.
  await input.setInputFiles([{ name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) }]);
  await expect(page.locator(".pilot-notice.is-error")).toContainText("empty.pdf is empty");
  await expect(page.locator(".pilot-file")).toHaveCount(3);
  await say(page, "Read these");
  await expect(page.locator(".pilot-assistant").last()).toContainText("Read.", { timeout: 60000 });
  const documents = requests[0].body.messages[0].content.filter((b) => b.type === "document");
  expect(documents.find((b) => b.title === "kunden.csv").source.data).toBe("Name;Ort\nMüller;Köln\n");
  expect(documents.find((b) => b.title === "textbox.docx").source.data).toBe("Body before\nBOXTEXT\nAfter");
  const sheet = documents.find((b) => b.title.startsWith("gaps.xlsx")).source.data;
  expect(sheet.split("\n").slice(1, 6)).toEqual(["1", "", "", "", "5"]);
});

test("the PDFs and images of one message are held to what one request can carry", async ({ page }) => {
  await openPilot(page);
  const input = page.locator("#pilot-file-input");
  const pdf = (name) => ({ name, mimeType: "application/pdf", buffer: Buffer.alloc(9 * 1000 * 1000, 32) });
  await input.setInputFiles([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")]);
  await expect(page.locator(".pilot-notice.is-error")).toContainText("c.pdf was left out");
  await expect(page.locator(".pilot-file")).toHaveCount(2);
});

test("a message the API refuses does not stay in the conversation, and an image too large is refused first", async ({ page }) => {
  const bodies = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    const body = request.postDataJSON();
    bodies.push(body);
    // An image the API will not take - past its pixel limit, say.
    if (body.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image"))) {
      return route.fulfill({
        status: 400,
        headers: { ...cors(), "content-type": "application/json" },
        body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "image dimensions exceed max allowed size" } }),
      });
    }
    await route.fulfill({ status: 200, headers: { ...cors(), "content-type": "text/event-stream" }, body: sse({ text: "Hello back." }) });
  });
  await openPilot(page);
  await useKey(page);
  const input = page.locator("#pilot-file-input");
  // Past the 10 MB of base64 the API takes for an image: refused here.
  await input.setInputFiles([{ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(8 * 1000 * 1000, 7) }]);
  await expect(page.locator(".pilot-notice.is-error")).toContainText("huge.png is larger than the 7.5 MB");
  await expect(page.locator(".pilot-file")).toHaveCount(0);

  await input.setInputFiles([{ name: "wide.png", mimeType: "image/png", buffer: Buffer.alloc(1000, 7) }]);
  await say(page, "What is in the picture?");
  await expect(page.locator(".pilot-notice.is-error").last()).toContainText("image dimensions", { timeout: 60000 });
  // Every later message used to resend the refused image, and was refused
  // with it.
  await say(page, "hello");
  await expect(page.locator(".pilot-assistant").last()).toHaveText("Hello back.", { timeout: 60000 });
  const last = bodies.at(-1);
  expect(last.messages).toHaveLength(1);
  expect(last.messages[0].content.some((b) => b.type === "image")).toBe(false);
  // ...and the screen the refused message carried goes with this one.
  expect(last.messages[0].content[0].text).toContain("<screen>");
});

test("the paperclip opens the file picker, and a file dropped anywhere - the bar, the app - goes to the chat", async ({ page }) => {
  await openPilot(page);
  // A real click on the paperclip: the browser's file picker comes up.
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#pilot-attach").click();
  await (await chooser).setFiles("tests/fixtures/note.pdf");
  await expect(page.locator(".pilot-file")).toHaveCount(1);

  // A drop the browser would otherwise answer by opening the file in a tab.
  const drop = async (frame, selector, name) => {
    const prevented = await frame.evaluate(({ selector, name }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([`a,b\n${name},2`], `${name}.csv`, { type: "text/csv" }));
      const target = document.querySelector(selector);
      target.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      const event = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    }, { selector, name });
    expect(prevented, `the drop on ${selector} was left to the browser`).toBe(true);
  };
  await drop(page, "#pilot-bar", "on-the-bar");
  await expect(page.locator(".pilot-file")).toHaveCount(2);
  // ...and on the app, through its frame.
  const app = page.frames().find((f) => f.url().includes("app/index.html"));
  await drop(app, "body", "on-the-app");
  await expect(page.locator(".pilot-file")).toHaveCount(3);
  await expect(page.locator(".pilot-file").last()).toContainText("on-the-app.csv");
});

test("What Claude sees shows the agent snapshot of the screen", async ({ page }) => {
  await openPilot(page);
  await page.locator("#pilot-sees").click();
  await expect(page.locator("#pilot-sees-panel")).toBeVisible();
  await expect(page.locator("#pilot-sees-body")).toContainText('"app": "Z2UI5_CL_SMP_APP_494"');
  await expect(page.locator("#pilot-sees-body")).toContainText('"event": "GREET"');
  await page.locator("#pilot-sees").click();
  await expect(page.locator("#pilot-sees-panel")).toBeHidden();
});

test("on a phone the app and the chat take turns", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await openPilot(page);
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#pilot")).toBeHidden();
  await page.locator('.pilot-view[data-view="chat"]').click();
  await expect(page.locator("#pilot")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test("the vendored agent client is mcp-server's, unchanged", () => {
  // tools/vendor-agent.mjs --check: every copy still hashes to source.json.
  execFileSync(process.execPath, ["tools/vendor-agent.mjs", "--check"], { stdio: "pipe" });
});
