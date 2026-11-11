import { test, expect } from "@playwright/test";
import { inflateRawSync } from "node:zlib";
import { getSource, MAIN_FILE, open } from "./helpers.mjs";

// The files on screen handed to another tool in a new tab
// (src/shell/hand-off.mjs): the AI App Builder's "Open in…" to the
// playground and the AI Agent, the playground's Share dialog to the Agent -
// and the studio's earlier builds, one per app (agent-hooks.mjs).

const appSource = (cls, mark) => `CLASS ${cls} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
ENDCLASS.
CLASS ${cls} IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    IF client->check_on_init( ).
      DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
          )->ele( n = \`View\` ns = \`mvc\`
              )->a( n = \`xmlns\`     v = \`sap.m\`
              )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).
      view->ele( \`Page\`
          )->a( n = \`title\` v = \`${mark}\` ).
      client->view_display( view->stringify( ) ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.`;

const CURRENT = [{ name: "zcl_ai_app.clas.abap", source: appSource("zcl_ai_app", "The current build") }];
const EARLIER = [{ name: "zcl_old_app.clas.abap", source: appSource("zcl_old_app", "An earlier build") }];

// The files a link's fragment carries (share.mjs: "2" + base64url of deflate-raw JSON).
function filesOf(hash) {
  const payload = hash.replace(/^#2/, "").replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(inflateRawSync(Buffer.from(payload, "base64")).toString("utf8"));
}

async function seedBuilds(page) {
  await page.addInitScript(({ current, earlier }) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("abap2ui5-playground:ai-files", JSON.stringify(current));
    localStorage.setItem("abap2ui5-playground:ai-builds", JSON.stringify([{ at: Date.now() - 60000, files: earlier }]));
  }, { current: CURRENT, earlier: EARLIER });
}

async function openStudio(page) {
  await page.goto("/ai/");
  await expect(page.locator("#status")).toHaveText("ready - describe the app you want", { timeout: 120000 });
}

test("the welcome offers the earlier builds, one per app, and one opened takes the current one's place", async ({ page }) => {
  await seedBuilds(page);
  await openStudio(page);
  await expect(page.locator(".chat-resume-open")).toContainText("ZCL_AI_APP");
  await expect(page.locator(".chat-earlier-open")).toHaveText(["ZCL_OLD_APP"]);

  await page.locator(".chat-earlier-open").click();
  await expect(page.frameLocator("#app").getByText("An earlier build")).toBeVisible({ timeout: 90000 });
  await expect(page.locator(".chat-notice").last()).toContainText("ZCL_OLD_APP is back in the editor");
  // Now the current build; the one it replaced is among the earlier ones.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("abap2ui5-playground:ai-files"))[0].name)).toBe("zcl_old_app.clas.abap");
  const earlier = await page.evaluate(() => JSON.parse(localStorage.getItem("abap2ui5-playground:ai-builds")).map((b) => b.files[0].name));
  expect(earlier).toEqual(["zcl_ai_app.clas.abap"]);
});

test("Open in… hands the build to the playground in a new tab, and the playground runs it", async ({ page }) => {
  await seedBuilds(page);
  await openStudio(page);
  // Nothing to hand on while the editor holds only the starting class.
  await page.locator("#chat-open-in summary").click();
  await page.locator('[data-hand-off="playground"]').click();
  await expect(page.locator("#status")).toHaveText("nothing to open yet - describe the app first");

  await page.locator(".chat-resume-open").click();
  await expect(page.frameLocator("#app").getByText("The current build")).toBeVisible({ timeout: 90000 });
  await page.locator("#chat-open-in summary").click();
  await expect(page.locator(".chat-open-in-menu")).toBeVisible();
  const [tab] = await Promise.all([page.waitForEvent("popup"), page.locator('[data-hand-off="playground"]').click()]);
  await tab.waitForURL(/#2/);
  const url = new URL(tab.url());
  expect(url.pathname).toBe("/");
  expect(filesOf(url.hash)).toEqual(CURRENT);
  await expect(page.locator(".chat-open-in-menu")).toBeHidden();
  // The playground opens a link's code at once and runs it.
  await expect(tab.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(tab.frameLocator("#app").getByText("The current build")).toBeVisible();
});

test("the playground's Share dialog hands the code to the AI Agent, which asks before it runs it", async ({ page }) => {
  await open(page);
  const source = await getSource(page);
  await page.locator("#share").click();
  await expect(page.locator("#share-dialog")).toBeVisible();
  const [tab] = await Promise.all([page.waitForEvent("popup"), page.locator("#share-pilot").click()]);
  await tab.waitForURL(/\/pilot\/#2/);
  expect(filesOf(new URL(tab.url()).hash)).toEqual([{ name: MAIN_FILE, source }]);
  // A link's code on the Agent's page is opened only after the reader said so.
  await expect(tab.locator("#linked-dialog")).toBeVisible({ timeout: 120000 });
});
