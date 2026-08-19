import { test, expect } from "@playwright/test";
import { control, getSource, openFiles } from "./helpers.mjs";

// Two ways of arriving at the playground that are not "somebody opened it":
// a link that names ABAP living somewhere else, and an embed in another page.

test("?src= opens the class the link names, and runs it", async ({ page }) => {
  await page.goto("/?src=examples/zcl_linked_example.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  // The file keeps the name it had, and the class it declares is what runs -
  // the playground has no fixed name it insists on.
  expect(await openFiles(page)).toEqual(["zcl_linked_example.clas.abap"]);
  await expect(page.frameLocator("#app").getByText("Linked example")).toBeVisible();
  await expect(control(page, "txtNote")).toContainText("fetched from a URL");
});

test("several ?src= parameters open several files, the first one being the app", async ({ page }) => {
  await page.goto("/?src=examples/zcl_linked_pair.clas.abap&src=examples/zcl_linked_helper.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  expect(await openFiles(page)).toEqual(["zcl_linked_pair.clas.abap", "zcl_linked_helper.clas.abap"]);
  // The app is the first one, and it calls the second - which only compiles
  // because both were linked.
  await expect(control(page, "txtNote")).toContainText("TWO FILES, ONE LINK!");
});

test("two linked files under the same name are refused rather than silently merged", async ({ page }) => {
  await page.goto("/?src=examples/zcl_linked_example.clas.abap&src=examples/zcl_linked_example.clas.abap");
  await expect(page.locator(".log-body")).toBeVisible({ timeout: 120000 });
  await expect(page.locator(".log-body")).toContainText("both called");
});

test("a first file that is a class but not an app fails where a real system would", async ({ page }) => {
  await page.goto("/?src=examples/zcl_linked_helper.clas.abap&src=examples/zcl_linked_pair.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  // It compiles and starts - and then the framework cannot treat it as an app,
  // which is exactly what happens on a real system, reported the same way.
  await expect(page.frameLocator("#app").getByText(/Error/i).first()).toBeVisible({ timeout: 60000 });
});

test("the entry file of a linked set cannot be closed", async ({ page }) => {
  await page.goto("/?src=examples/zcl_linked_pair.clas.abap&src=examples/zcl_linked_helper.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  // Keyed on the position, not on a name: nothing here is called
  // zcl_playground, and the first file is still the one that runs.
  await expect(page.locator(".file-tab").first().locator(".file-close")).toHaveCount(0);
  await expect(page.locator(".file-tab").nth(1).locator(".file-close")).toHaveCount(1);
});

// Builds a share fragment out of an arbitrary file set, so the checks that
// guard the entry path can be exercised with sets no UI would produce.
async function fragmentFor(page, files) {
  return page.evaluate(async (list) => {
    const bytes = new TextEncoder().encode(JSON.stringify(list));
    const deflated = new Uint8Array(
      await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer(),
    );
    let binary = "";
    for (const b of deflated) binary += String.fromCharCode(b);
    return "2" + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  }, files);
}

test("a shared set whose first file is an interface opens the sample instead", async ({ page }) => {
  await page.goto("/");
  const fragment = await fragmentFor(page, [
    { name: "zif_thing.intf.abap", source: "INTERFACE zif_thing PUBLIC.\nENDINTERFACE." },
    { name: "zcl_playground.clas.abap", source: "CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.\nENDCLASS." },
  ]);

  await page.goto(`/#${fragment}`);
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  // The first file is the app, so a set that opens with an interface has no
  // app at all - and is refused before it can wedge the editor.
  expect(await getSource(page)).toContain("INTERFACES z2ui5_if_app");
});

test("a fragment that decodes to nonsense opens the sample instead of wedging", async ({ page }) => {
  // Valid deflate, valid JSON, impossible file set - the case that used to
  // throw inside Monaco while the page was still starting.
  await page.goto("/");
  const fragment = await fragmentFor(page, [{ name: "not a file name", source: "CLASS x." }]);

  await page.goto(`/#${fragment}`);
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("CLASS zcl_playground DEFINITION");
});

test("a link to somewhere the playground will not fetch from says so", async ({ page }) => {
  await page.goto("/?src=https://example.invalid/zcl_thing.clas.abap");
  await expect(page.locator("#status")).toContainText("could not be followed", { timeout: 120000 });

  // Visible, not merely present: the panel is cleared at the start of every
  // run, so a message written before the first run would be gone by the time
  // anybody could read it.
  await expect(page.locator(".log-body")).toBeVisible();
  await expect(page.locator(".log-body")).toContainText("example.invalid");
  await expect(page.locator(".log-body")).toContainText("raw.githubusercontent.com");

  // And it falls back to the sample rather than showing nothing.
  expect(await getSource(page)).toContain("CLASS zcl_playground DEFINITION");
});

test("a link to a file that is not an ABAP object says so", async ({ page }) => {
  await page.goto("/?src=index.html");
  await expect(page.locator(".log-body")).toBeVisible({ timeout: 120000 });
  await expect(page.locator(".log-body")).toContainText("not an ABAP object file");
});

test("the embedded playground drops the chrome and keeps the code", async ({ page }) => {
  await page.goto("/?embed=1&src=examples/zcl_linked_example.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  await expect(page.locator(".brand")).toBeHidden();
  await expect(page.locator("#samples")).toBeHidden();
  await expect(page.locator("#share")).toBeHidden();

  // Still a playground: the editor is there and Run works.
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.locator("#run")).toBeEnabled();
  await expect(page.frameLocator("#app").getByText("Linked example")).toBeVisible();
});

test("an embedded playground does not write over the draft of a normal one", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await page.evaluate(() =>
    window.monaco.editor
      .getModel(window.monaco.Uri.parse("file:///zcl_playground.clas.abap"))
      .setValue("CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.\n\" my own work\nENDCLASS.\nCLASS zcl_playground IMPLEMENTATION.\nENDCLASS."),
  );
  await page.waitForTimeout(500);

  await page.goto("/?embed=1&src=examples/zcl_linked_example.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("my own work");
});

test("a linked app brings the classes it needs with it", async ({ page }) => {
  // One ?src=, and zcl_linked_pair calls zcl_linked_helper. Linking an app that
  // does not compile on its own would be a link to an error message.
  await page.goto("/?src=examples/zcl_linked_pair.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  expect(await openFiles(page), "the helper came along").toEqual([
    "zcl_linked_pair.clas.abap",
    "zcl_linked_helper.clas.abap",
  ]);
  // The first file is still the app - what was linked is what starts.
  await expect(page.frameLocator("#app").getByText("Two files, one link")).toBeVisible();
});
