import { test, expect } from "@playwright/test";
import { MAIN_MARK } from "./helpers.mjs";

// Putting a live demo in somebody else's page: the app-only view, the messages
// an embedding page listens for, and the loader script that ties them together.

const SOURCE = "abap2ui5-playground";

// Everything the embedded playground says, collected from the moment the page
// exists. Installed before navigation, because "ready" arrives once and early.
async function collectMessages(page) {
  await page.addInitScript(() => {
    window.__messages = [];
    window.addEventListener("message", (e) => {
      if (e.data?.source === "abap2ui5-playground") window.__messages.push(e.data);
    });
  });
}

test("?view=app shows the app and nothing else - no editor and no bar", async ({ page }) => {
  await page.goto("/?embed=1&view=app");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  await expect(page.locator("#pane-left")).toBeHidden();
  await expect(page.locator("#splitter")).toBeHidden();
  await expect(page.locator("#pane-right")).toBeVisible();
  await expect(page.frameLocator("#app").getByText(MAIN_MARK)).toBeVisible();

  // The bar goes with the editor. An embedded demo is furniture in somebody
  // else's page, and Run, the source and undo are all a click away in the
  // "open this in the playground" link that page prints beside the frame -
  // so what is left here is a strip of our chrome across their paragraph.
  // Measured rather than asserted on the class, for the same reason the full
  // screen test measures: a bar that is merely transparent would pass a class
  // check and still take the top of the box.
  await expect(page.locator(".bar")).toBeHidden();
  const app = await page.locator("#app").boundingBox();
  expect(Math.round(app.y), "the app starts at the top of the frame").toBe(0);

  // And no theme switch or links out of it: furniture in somebody else's
  // page keeps to what it was given.
  await expect(page.locator("#theme")).toBeHidden();
  await expect(page.locator(".social")).toHaveCount(3);
  await expect(page.locator(".social").first()).toBeHidden();

  // The editor is gone from the screen, not from the playground - what runs is
  // still compiled from it, and Run still runs. There is no button to press for
  // it here, which is the point of the view; Ctrl+Enter is the same command and
  // is bound on the document rather than on the editor, so it works in a view
  // that has neither on screen.
  await expect(page.locator("#run")).toBeEnabled();
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.frameLocator("#app").getByText(MAIN_MARK)).toBeVisible();
});

test("an embedded playground reports ready, status and height to the page around it", async ({ page }) => {
  // The playground only talks when it is framed, so it gets a frame.
  await collectMessages(page);
  await page.goto("/embed/host.html");

  await expect
    .poll(() => page.evaluate(() => window.__messages.some((m) => m.type === "ready")), {
      timeout: 120000,
    })
    .toBe(true);

  const messages = await page.evaluate(() => window.__messages);
  expect(
    messages.every((m) => m.source === SOURCE),
    "every message names its sender",
  ).toBe(true);

  const status = messages.filter((m) => m.type === "status");
  expect(status.length, "the status line travels").toBeGreaterThan(0);
  expect(status.at(-1).state).toBe("running");

  const heights = messages.filter((m) => m.type === "height");
  expect(heights.length, "an app-only demo reports how tall it wants to be").toBeGreaterThan(0);
  expect(heights.at(-1).height).toBeGreaterThan(50);

  // And the page around it actually grew. host.html is the copy-and-paste
  // version of the loader, so the guards in its handler have to let a real
  // message through - a check that only ever rejects is a broken example.
  await expect
    .poll(
      async () => {
        const wanted = await page.evaluate(
          () => window.__messages.filter((m) => m.type === "height").at(-1)?.height,
        );
        const shown = await page.locator("#demo").evaluate((el) => el.clientHeight);
        return Math.abs(shown - Math.max(120, Math.min(1200, wanted))) <= 1;
      },
      { timeout: 30000 },
    )
    .toBe(true);
});

test("an embedded playground follows its reader's system theme, not a choice made elsewhere", async ({ page }) => {
  // A dark theme chosen in a playground of one's own - and the embedded one
  // in a documentation page does not pick it up, the same as it never picks
  // up the draft: a demo has to read the same to every reader.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("abap2ui5-playground:theme", "dark"));
  await page.goto("/?embed=1");
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();
  await expect(page.locator("#app")).toHaveAttribute("src", /sap-ui-theme=sap_horizon(&|$)/);
});

test("a playground that is not embedded stays silent", async ({ page }) => {
  await collectMessages(page);
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  expect(await page.evaluate(() => window.__messages)).toEqual([]);
});

test("the loader waits for a click, then runs the example", async ({ page }) => {
  await page.goto("/embed/");

  // Nothing has loaded: every demo on the page is a button, and no frame
  // exists. Counted rather than fixed at a number, so the showcase can grow a
  // seventh shape without this test having an opinion about it.
  const demos = await page.locator(".abap2ui5-demo").count();
  expect(demos, "the page shows some demos").toBeGreaterThan(2);
  await expect(page.locator(".abap2ui5-demo-start")).toHaveCount(demos);
  expect(await page.locator(".abap2ui5-demo iframe").count()).toBe(0);

  await page.locator(".abap2ui5-demo-start").first().click();
  // Only the clicked one.
  await expect(page.locator(".abap2ui5-demo iframe")).toHaveCount(1);

  const demo = page.frameLocator(".abap2ui5-demo iframe").first();
  await expect(demo.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(demo.locator("#editor")).toContainText("CLASS zcl_linked_example");
});

test("inline data-code reaches the playground through the fragment", async ({ page }) => {
  await page.goto("/embed/");

  // The inline demo carries its ABAP in the attribute rather than in a file. It
  // has to arrive in the format the playground's own Share button writes -
  // anything else is read as somebody else's link and silently replaced by the
  // sample, which would show a reader the wrong code. Found by its label
  // rather than its position, so reordering the showcase cannot silently point
  // this test at a different demo.
  await page.locator(".abap2ui5-demo-start", { hasText: "Run the inline example" }).click();
  const demo = page.frameLocator(".abap2ui5-demo iframe").first();
  await expect(demo.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(demo.locator("#editor")).toContainText("Written in the documentation");
  await expect(
    demo.frameLocator("#app").locator('[id$="--txtInline"]'),
    "the inline example actually rendered",
  ).toContainText("This ABAP travelled in the URL.");
});

test("the side-by-side shape renders the app next to the printed code", async ({ page }) => {
  await page.goto("/embed/");

  // The shape a documentation page most often wants: the manual's own code
  // block on one side, the running result on the other. The two halves carry
  // the same ABAP, so this checks that what is printed is what runs.
  const pair = page.locator(".side-by-side");
  await expect(pair.locator("pre")).toContainText("Side by side");

  await pair.locator(".abap2ui5-demo-start").click();
  const demo = pair.frameLocator("iframe");
  await expect(demo.locator("#status")).toHaveText("running", { timeout: 120000 });
  // App-only, so no editor beside it - and the button the code block promises.
  await expect(demo.locator("#pane-left")).toBeHidden();
  await expect(demo.frameLocator("#app").locator('[id$="--btnSide"]')).toContainText("Press me");
});

test("inline code keeps the class name the page gave it", async ({ page }) => {
  await page.goto("/embed/");

  // The file an inline demo is put into is named after the class in it. It used
  // to be called zcl_playground whatever the code said, so `data-code` only
  // ever worked for a class of that one name - and a documentation page prints
  // its example under the name its reader is meant to create. Everything else
  // was refused before it ran: "zcl_playground.clas.abap has to declare
  // ZCL_PLAYGROUND, not Z2UI5_CL_DEMO_INLINE".
  await page.locator(".abap2ui5-demo-start", { hasText: "Run the inline example" }).click();
  const demo = page.frameLocator(".abap2ui5-demo iframe").first();
  await expect(demo.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(demo.locator("#files")).toContainText("z2ui5_cl_demo_inline.clas.abap");
  await expect(
    demo.frameLocator("#app").locator('[id$="--txtInline"]'),
    "a class the page named itself actually ran",
  ).toContainText("This ABAP travelled in the URL.");
});

test("the loader hands out the URL it would open", async ({ page }) => {
  await page.goto("/embed/");

  // For the page that draws its own Run button and wants "open this in the
  // playground" beside it. It has to come from the loader: a page writing the
  // fragment itself gets one character of version and a deflate-raw wrong, and
  // the playground reads an unreadable fragment as somebody else's link and
  // opens its own sample instead - a broken link that looks like a working one.
  const url = await page.evaluate(() =>
    window.abap2ui5Embed.url({
      code: [
        "CLASS z2ui5_cl_demo_linked DEFINITION PUBLIC CREATE PUBLIC.",
        "  PUBLIC SECTION.",
        "    INTERFACES z2ui5_if_app.",
        "ENDCLASS.",
        "CLASS z2ui5_cl_demo_linked IMPLEMENTATION.",
        "  METHOD z2ui5_if_app~main.",
        "    client->message_box_display( `From a link` ).",
        "  ENDMETHOD.",
        "ENDCLASS.",
      ].join("\n"),
    }));

  await page.goto(url);
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#files")).toContainText("z2ui5_cl_demo_linked.clas.abap");
  await expect(page.locator("#editor")).toContainText("From a link");
});

test("an app-only playground renders in a column narrower than a desk", async ({ page }) => {
  // 820px is where the two panes stop sitting side by side and become tabs -
  // and the reading column of a documentation page is narrower than that, so
  // this is the NORMAL width for an embedded demo rather than an edge of one.
  // The tab machinery brought the editor to the front, which ?view=app has
  // hidden in CSS, and hid the app behind it: an empty box, with the status bar
  // still saying "running".
  await page.setViewportSize({ width: 700, height: 520 });
  await page.goto("/?embed=1&view=app");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  await expect(page.locator("#pane-right")).toBeVisible();
  await expect(page.locator("#app")).toBeVisible();
  const box = await page.locator("#app").boundingBox();
  expect(box.width, "the app frame has a width").toBeGreaterThan(300);
  expect(box.height, "the app frame has a height").toBeGreaterThan(100);
  await expect(page.frameLocator("#app").getByText(MAIN_MARK)).toBeVisible();
});

test("the app frame lets itself be framed from another origin", async ({ page }) => {
  // UI5 protects an app from clickjacking with frameOptions "trusted", which
  // abap2UI5 ships and which is right for an app on a real system. Here the app
  // is always in a frame, and the page framing the playground is on somebody
  // else's origin - which is what embedding IS. UI5 then asks that top window
  // for permission over postMessage, waits ten seconds for an answer no
  // documentation site knows to give, and HIDES everything it rendered: the app
  // is in the DOM, correct and invisible, and the status bar says "running".
  //
  // Checked as text rather than by framing from a second origin, because there
  // is one server here and the failure is silent either way. `tools/build-ui5.mjs`
  // rewrites the attribute and fails the build if it is no longer there to
  // rewrite.
  // The frontend page on its own - it says so and stops, so nothing boots.
  await page.goto("/app/index.html");
  const html = await page.evaluate(async () => (await fetch("index.html")).text());
  expect(html).toContain('data-sap-ui-frameOptions="allow"');
});
