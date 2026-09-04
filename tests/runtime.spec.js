import { test, expect } from "@playwright/test";

// The transpiled framework, driven directly - no UI5, no iframe. If these pass
// and the app on the page is still blank, the problem is in the frontend
// plumbing and not in the ABAP.

// The framework's own Hello World, not one of this repository's: there is no
// playground-owned app any more, and an app that ships with abap2UI5 is the
// one a reader actually starts first. It arrives with the pinned framework,
// so a rename upstream surfaces here at the bump rather than in a page that
// silently opens on nothing.
const APP = "Z2UI5_CL_UI5_APP_HI_WORLD";

// What the frontend POSTs when it boots: no draft id yet, and the app class
// taken from the page's query string (see z2ui5_cl_ui5_handler=>request_app_start).
const appStart = (app = APP) =>
  JSON.stringify({ value: { S_FRONT: { SEARCH: `?app_start=${app}` } } });

async function boot(page) {
  await page.goto("/");
  return page.evaluate(async () => {
    const t0 = performance.now();
    window.pg = await import("./runtime/framework.mjs");
    return { ms: Math.round(performance.now() - t0) };
  });
}

const call = (page, body) => page.evaluate((b) => window.pg.roundtrip(b), body);

test("the framework boots and answers an app start", async ({ page }) => {
  const { ms } = await boot(page);
  console.log(`framework boot: ${ms} ms`);

  const res = await call(page, appStart());
  expect(res.status).toBe(200);

  const data = JSON.parse(res.body);
  expect(data.S_FRONT?.ID, "the response must carry a draft id").toBeTruthy();
  // The view is the XML the view builder produced - the app's own title proves
  // it was this app that ran, not an error page.
  expect(JSON.stringify(data)).toContain("abap2UI5 - Hello World");
});

test("an event roundtrip sees the state of the previous one", async ({ page }) => {
  await boot(page);

  const first = JSON.parse((await call(page, appStart())).body);
  const id = first.S_FRONT.ID;

  // Type a name into the bound field and press the button, the way the
  // frontend would: the model delta plus the event name.
  const event = JSON.stringify({
    value: {
      MODEL: { NAME: "abap2UI5" },
      S_FRONT: { ID: id, EVENT: "BUTTON_POST" },
    },
  });
  const res = await call(page, event);
  expect(res.status).toBe(200);

  // The message was computed in ABAP by an app instance that only exists
  // because the draft of the first roundtrip was read back out of sql.js.
  expect(res.body).toContain("Your name is abap2UI5");
});

test("a run against an unknown app class fails with a readable 500", async ({ page }) => {
  await boot(page);

  const res = await call(page, appStart("ZCL_DOES_NOT_EXIST"));
  expect(res.status).toBe(500);
  expect(res.body).toContain("ZCL_DOES_NOT_EXIST");
});

test("resetDatabase makes an existing draft id unusable", async ({ page }) => {
  await boot(page);

  const first = JSON.parse((await call(page, appStart())).body);
  const id = first.S_FRONT.ID;

  await page.evaluate(() => window.pg.resetDatabase());

  const res = await call(page, JSON.stringify({ value: { S_FRONT: { ID: id, EVENT: "BUTTON_POST" } } }));
  expect(res.status, "the draft is gone, so the framework cannot continue that session").toBe(500);
});
