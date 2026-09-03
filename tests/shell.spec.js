import { test, expect } from "@playwright/test";
import { getSource, open, runSample, setSource } from "./helpers.mjs";

// The playground around the editor: sharing a link, keeping a draft, and the
// two shapes the page takes.

const MARKER = "written for the share test";

test("Share puts the code in the address bar and the link brings it back", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);

  const source = (await getSource(page)).replace("Hello abap2UI5", MARKER);
  await setSource(page, source);
  await page.locator("#share").click();
  await expect(page.locator("#status")).toContainText("link", { timeout: 15000 });

  const shared = page.url();
  expect(shared, "the code travels in the fragment, not the query").toContain("#");
  // Short enough to paste into a chat: the source is deflated before it is
  // encoded, and ABAP compresses well.
  expect(shared.length).toBeLessThan(source.length);

  // Open it as somebody receiving the link would - in a browser context that
  // has never seen this playground. A page in the same context would share its
  // localStorage, and the draft saved above already contains the marker - the
  // link could be completely broken and the assertion would still hold.
  const elsewhere = await browser.newContext();
  const fresh = await elsewhere.newPage();
  await fresh.goto(shared);
  await expect(fresh.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(fresh)).toContain(MARKER);
  await elsewhere.close();
});

test("editing after a share retires the link, and the reload keeps the edits", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);

  await setSource(page, (await getSource(page)).replace("Hello abap2UI5", "the shared version"));
  await page.locator("#share").click();
  await expect(page.locator("#status")).toContainText("link", { timeout: 15000 });
  expect(page.url()).toContain("#");

  // The next edit makes the fragment a lie, so it goes. Were it kept, this
  // reload would decode it - a link outranks the stored draft - and the editor
  // would quietly travel back to the shared version, which the first keystroke
  // would then write over the newer draft.
  await setSource(page, (await getSource(page)).replace("the shared version", "edited after sharing"));
  expect(page.url()).not.toContain("#");

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("edited after sharing");
});

test("Full screen opens the app on its own in a new tab, carrying the code", async ({ page }) => {
  await open(page);

  await setSource(page, (await getSource(page)).replace("Hello abap2UI5", "the full screen version"));

  // The new tab shares this browser context, so it also shares the stored
  // draft - which now contains the marker too. Dropping the draft first leaves
  // the URL as the only way the marker can reach the new tab; without this the
  // fragment could be empty and every assertion below would still hold.
  await page.evaluate(() => localStorage.removeItem("abap2ui5-playground:files"));

  const [tab] = await Promise.all([
    page.waitForEvent("popup"),
    page.locator("#fullscreen").click(),
  ]);
  await tab.waitForURL(/view=full/, { timeout: 15000 });
  expect(tab.url(), "the code travels in the fragment, as it does with Share").toContain("#");

  await expect(tab.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(tab.locator("#pane-left")).toBeHidden();
  await expect(tab.frameLocator("#app").getByText("the full screen version")).toBeVisible();

  // The app and nothing else: no editor, and no bar over it either. Measured
  // rather than asserted on the class, because what was asked for is a window
  // filled by the app - a bar that is merely transparent would pass a class
  // check and still take the top of the screen.
  await expect(tab.locator(".bar")).toBeHidden();
  const viewport = tab.viewportSize();
  const app = await tab.locator("#app").boundingBox();
  expect(Math.round(app.y), "the app starts at the top of the window").toBe(0);
  expect(Math.round(app.height), "and reaches the bottom of it").toBe(viewport.height);

  // A tab of its own, not a window onto this one: what happens here afterwards
  // is none of its business. Run resets the database and reloads the frame,
  // which is the loudest thing this page can do to a shared runtime.
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(tab.frameLocator("#app").getByText("the full screen version")).toBeVisible();

  await tab.close();
});

test("the bar comes back in the full screen view when something goes wrong", async ({ page }) => {
  // A ?src= nobody can follow: the page opens on its sample and says so. In
  // this view the status line is the only channel there is - the log panel
  // lives in the pane the view hides - so the bar that carries it has to
  // return, or the reader is left with an app that is not the one the link
  // named and nothing anywhere saying why.
  await page.goto("/?view=full&src=https://example.invalid/zcl_thing.clas.abap");
  await expect(page.locator("#status")).toContainText("could not be followed", { timeout: 120000 });
  await expect(page.locator(".bar")).toBeVisible();

  // And it goes again once the trouble does. Run clears the report, so what is
  // on screen afterwards is a running app with nothing over it.
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.locator(".bar")).toBeHidden();
});

test("a link nobody wrote opens on the sample instead of failing", async ({ page }) => {
  await page.goto("/#thisisnotavalidfragment");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("CLASS zcl_playground DEFINITION");
});

test("Undo takes the last edit back, Redo brings it again, and both are inactive when they cannot", async ({ page }) => {
  await open(page);
  // A sample as it was opened has nothing to take back, nothing to do again.
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#redo")).toBeDisabled();

  const original = await getSource(page);
  // Through the undo stack, the way typing and Fix them go - setValue( ), which
  // setSource( ) uses, replaces the document and resets the stack instead.
  await page.evaluate((text) => {
    const model = window.monaco.editor.getModels()[0];
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  }, original.replace("Hello abap2UI5", "about to be undone"));
  await expect(page.locator("#undo")).toBeEnabled();

  await page.locator("#undo").click();
  await expect.poll(() => getSource(page)).toBe(original);
  // One edit, so one press took the whole of it back - and it is there to redo.
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#redo")).toBeEnabled();

  await page.locator("#redo").click();
  await expect.poll(() => getSource(page)).toContain("about to be undone");
  await expect(page.locator("#redo")).toBeDisabled();
});

test("Ctrl+S runs, instead of offering to save the page", async ({ page }) => {
  await open(page);
  const before = await page.locator("#app").getAttribute("src");
  await page.locator("#editor").click();
  await page.keyboard.press("Control+s");
  await expect(page.locator("#app")).not.toHaveAttribute("src", before ?? "", { timeout: 60000 });
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
});

test("the editor content survives a reload", async ({ page }) => {
  await open(page);
  await setSource(page, (await getSource(page)).replace("Hello abap2UI5", "kept across a reload"));

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("kept across a reload");
});

test("picking a sample replaces the draft, and leaves it one Undo away", async ({ page }) => {
  await open(page);
  await setSource(page, (await getSource(page)).replace("Hello abap2UI5", "about to be replaced"));

  await runSample(page, "counter");
  expect(await getSource(page)).not.toContain("about to be replaced");
  expect(await getSource(page)).toContain("Counter");
  // Said, because the click just wrote over somebody's work.
  await expect(page.locator("#status")).toContainText("one Undo away");

  // And it is: the sample went in through the undo stack, not over it.
  await expect(page.locator("#undo")).toBeEnabled();
  await page.locator("#undo").click();
  await expect.poll(() => getSource(page)).toContain("about to be replaced");
  // A sample opened over a sample says nothing - there was no work to lose.
  await runSample(page, "hello");
  await runSample(page, "counter");
  await expect(page.locator("#status")).toHaveText("running");
});

test("a sample that was only read is not kept as a draft", async ({ page }) => {
  await open(page);
  await runSample(page, "counter");

  // Reading a sample is not work to continue. Stored as a draft it would pin
  // this visitor to a frozen copy of it - the sample improves in a later deploy
  // and they go on being opened on the old one, findings and all, labelled as
  // their own last session.
  expect(await page.evaluate(() => localStorage.getItem("abap2ui5-playground:files"))).toBeNull();

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("Hello abap2UI5");

  // One keystroke and it is a draft like any other.
  await runSample(page, "counter");
  await setSource(page, (await getSource(page)).replace("Counter", "a counter of my own"));
  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("a counter of my own");
});

test("the splitter moves the divide and remembers it", async ({ page }) => {
  await open(page);

  const width = async () => (await page.locator("#pane-left").boundingBox()).width;
  const before = await width();

  const splitter = page.locator("#splitter");
  const box = await splitter.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = await width();
  expect(after).toBeLessThan(before - 100);

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(Math.abs((await width()) - after)).toBeLessThan(20);
});

test("a narrow window shows tabs instead of a split", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await open(page);

  await expect(page.locator(".tabs")).toBeVisible();
  await expect(page.locator("#splitter")).toBeHidden();

  // One pane at a time, and the tabs switch between them.
  await expect(page.locator("#pane-left")).toBeVisible();
  await expect(page.locator("#pane-right")).toBeHidden();

  await page.locator(".tab", { hasText: "App" }).click();
  await expect(page.locator("#pane-right")).toBeVisible();
  await expect(page.locator("#pane-left")).toBeHidden();
});

test("on a phone Run brings the app forward - unless there is no app to bring", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await open(page);
  await expect(page.locator("#pane-left"), "the page opens on the code").toBeVisible();

  // Pressing Run and being left looking at the code is a dead end where only
  // one pane is on screen.
  await page.locator("#run").click();
  await expect(page.locator("#pane-right")).toBeVisible();
  await expect(page.locator("#pane-left")).toBeHidden();

  // A run that never started an app is the other way round: what it left open -
  // here the problems it stopped on - is what has to stay in front.
  await page.locator(".tab", { hasText: "ABAP" }).click();
  await setSource(
    page,
    (await getSource(page)).replace("PUBLIC SECTION.", "PUBLIC SECTION.\n    DATA broken TYPE zcl_does_not_exist."),
  );
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("fix them");
  await expect(page.locator("#pane-left")).toBeVisible();
  await expect(page.locator(".insight-row.is-error").first()).toBeVisible();
});

test("the bar keeps to a few rows on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await open(page);

  // It wrapped to four rows - a fifth of the screen, spent before the editor or
  // the app got any of it. What it must not do is grow back.
  const bar = await page.locator(".bar").boundingBox();
  expect(bar.height, "the bar is not a fifth of the phone").toBeLessThan(100);

  // And nothing that has to be reachable was compacted away with the rows.
  for (const id of ["#undo", "#redo", "#format", "#examples", "#run", "#share", "#source-link", "#status", "#about", "#theme"]) {
    await expect(page.locator(id)).toBeVisible();
  }
});

test("both panes stay visible when a wide window gets narrow and wide again", async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 480, height: 800 });
  await page.locator(".tab", { hasText: "App" }).click();
  await expect(page.locator("#pane-left")).toBeHidden();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("#pane-left")).toBeVisible();
  await expect(page.locator("#pane-right")).toBeVisible();
});

test("the app follows the system theme, and a change does not restart it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);

  // The frame is started in UI5's dark theme, matching the rest of the page.
  await expect(page.locator("#app")).toHaveAttribute("src", /sap-ui-theme=sap_horizon_dark/);
  const dark = await page.frameLocator("#app").locator("body").evaluate((b) => getComputedStyle(b).backgroundColor);

  // Type something, then switch the system theme: the app changes colour but
  // keeps what was typed - somebody with a half-filled form is not punished
  // for the sun going down.
  await page.frameLocator("#app").locator('[id$="--inpName-inner"]').fill("still here");
  await page.emulateMedia({ colorScheme: "light" });

  await expect
    .poll(async () =>
      page.frameLocator("#app").locator("body").evaluate((b) => getComputedStyle(b).backgroundColor),
    )
    .not.toBe(dark);
  await expect(page.frameLocator("#app").locator('[id$="--inpName-inner"]')).toHaveValue("still here");
});

test("the switch in the bar overrides the system theme, and is forgotten again when it agrees with it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  const html = page.locator("html");
  const theme = page.locator("#theme");
  const editor = page.locator(".monaco-editor").first();
  const stored = () => page.evaluate(() => localStorage.getItem("abap2ui5-playground:theme"));
  const chosen = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const appBackground = () =>
    page.frameLocator("#app").locator("body").evaluate((b) => getComputedStyle(b).backgroundColor);

  // Following the system: nothing chosen, nothing stored, and the switch
  // says so.
  expect(await chosen()).toBeNull();
  expect(await stored()).toBeNull();
  await expect(theme).toHaveAttribute("aria-checked", "false");
  await expect(editor).toHaveClass(/\bvs\b/);
  const light = await appBackground();

  // One click: the page, the editor and the running app go dark - the app
  // told rather than restarted, as for a system change - and the choice is
  // kept for next time.
  await theme.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(theme).toHaveAttribute("aria-checked", "true");
  await expect(editor).toHaveClass(/vs-dark/);
  expect(await stored()).toBe("dark");
  await expect.poll(appBackground).not.toBe(light);

  // Next time: dark before the bundle has said anything - the inline script
  // at the top of the document applies the stored choice - and the app
  // starts in the dark theme.
  await page.goto("/");
  expect(await chosen()).toBe("dark");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(theme).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#app")).toHaveAttribute("src", /sap-ui-theme=sap_horizon_dark/);

  // Switching back to what the system says is not a choice to keep: the
  // page follows the system again, and nothing is stored.
  await theme.click();
  expect(await chosen()).toBeNull();
  expect(await stored()).toBeNull();
  await expect(theme).toHaveAttribute("aria-checked", "false");
  await expect(editor).toHaveClass(/\bvs\b/);
});

// The entries of a stored zip, read the way the format is written: a local
// header per entry, name and bytes right behind it. Enough to check what the
// Share dialog hands out without a zip library in the tests either.
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extraLength;
    entries.push({ name, text: new TextDecoder().decode(bytes.subarray(start, start + size)) });
    at = start + size;
  }
  return entries;
}

test("the Share dialog offers an embed block, a markdown fence and an abapGit zip", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.locator("#share").click();
  const dialog = page.locator("#share-dialog");
  await expect(dialog).toBeVisible();

  // The link is the first box and is what the address bar now shows.
  const boxes = dialog.locator("textarea");
  await expect(boxes.nth(0)).toHaveValue(page.url());
  // The embed block carries the class inline and the loader from this site.
  const embed = await boxes.nth(1).inputValue();
  expect(embed).toContain('class="abap2ui5-demo"');
  expect(embed).toContain("data-code=");
  expect(embed).toContain("/embed/abap2ui5-embed.js");
  // The markdown fence is the class as a documentation page would print it.
  const markdown = await boxes.nth(2).inputValue();
  expect(markdown.startsWith("```abap\n")).toBe(true);
  expect(markdown).toContain("CLASS zcl_playground DEFINITION");
  expect(markdown.endsWith("```")).toBe(true);

  // The zip: named after the app, laid out as a repository abapGit reads -
  // the settings file at the root, the source and its metadata under src/,
  // the source normalised to LF with a newline at the end.
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#share-abapgit").click()]);
  expect(download.suggestedFilename()).toBe("zcl_playground.zip");
  const { readFileSync } = await import("node:fs");
  const entries = zipEntries(new Uint8Array(readFileSync(await download.path())));
  expect(entries.map((e) => e.name)).toEqual([
    ".abapgit.xml",
    "src/zcl_playground.clas.abap",
    "src/zcl_playground.clas.xml",
  ]);
  expect(entries[0].text).toContain("<STARTING_FOLDER>/src/</STARTING_FOLDER>");
  expect(entries[1].text).toContain("CLASS zcl_playground DEFINITION");
  expect(entries[1].text).not.toContain("\r");
  expect(entries[1].text.endsWith("\n")).toBe(true);
  expect(entries[2].text).toContain("<CLSNAME>ZCL_PLAYGROUND</CLSNAME>");
});
