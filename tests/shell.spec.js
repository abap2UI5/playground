import { test, expect } from "@playwright/test";
import { getSource, MAIN_CLASS, MAIN_FILE, MAIN_MARK, open, runSample, SAMPLES, setSource } from "./helpers.mjs";

// A sample other than the one the page opens on - it brings its own class name,
// which is what makes replacing a draft with it interesting.
const OTHER = SAMPLES[1];

// The playground around the editor: sharing a link, keeping a draft, and the
// two shapes the page takes.

const MARKER = "written for the share test";

test("Share puts the code in the address bar and the link brings it back", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);

  const source = (await getSource(page)).replace(MAIN_MARK, MARKER);
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

  await setSource(page, (await getSource(page)).replace(MAIN_MARK, "the shared version"));
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

  await setSource(page, (await getSource(page)).replace(MAIN_MARK, "the full screen version"));

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
  await expect(tab.locator(".toolbar")).toBeHidden();
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

test("the toolbar comes back in the full screen view when something goes wrong", async ({ page }) => {
  // A ?src= nobody can follow: the page opens on its sample and says so. In
  // this view the status line is the only channel there is - the log panel
  // lives in the pane the view hides - so the row that carries it has to
  // return, or the reader is left with an app that is not the one the link
  // named and nothing anywhere saying why.
  //
  // The row that returns is the TOOLBAR. The header is two rows now - the
  // project's bar, then this page's tools - and the status line is in the
  // second. The first one stays away: it is the brand, the four sections and
  // the search, which is the part that had no business being in somebody
  // else's page in the first place, and it says nothing about what went wrong.
  await page.goto("/?view=full&src=https://example.invalid/zcl_thing.clas.abap");
  await expect(page.locator("#status")).toContainText("could not be followed", { timeout: 120000 });
  await expect(page.locator(".toolbar")).toBeVisible();
  await expect(page.locator(".bar")).toBeHidden();

  // And it goes again once the trouble does. Run clears the report, so what is
  // on screen afterwards is a running app with nothing over it.
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.locator(".toolbar")).toBeHidden();
});

test("a link nobody wrote opens on the sample instead of failing", async ({ page }) => {
  await page.goto("/#thisisnotavalidfragment");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain(`CLASS ${MAIN_CLASS} DEFINITION`);
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
  }, original.replace(MAIN_MARK, "about to be undone"));
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

test("Auto runs the edit by itself, and hands Run back when it is switched off", async ({ page }) => {
  await open(page);
  const auto = page.locator("#autorun");
  const stored = () => page.evaluate(() => localStorage.getItem("abap2ui5-playground:autorun"));

  // Off is the default and nothing is stored for it - a run is a fresh
  // database and a reloaded frame, so it is a choice somebody makes.
  await expect(auto).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#run")).toBeEnabled();
  expect(await stored()).toBeNull();

  // An edit with the switch off changes nothing on the right: that is what
  // Run is for, and it is the behaviour the switch exists to change.
  const before = await page.locator("#app").getAttribute("src");
  await setSource(page, (await getSource(page)).replace(MAIN_MARK, "not run yet"));
  await page.waitForTimeout(1500);
  await expect(page.locator("#app")).toHaveAttribute("src", before ?? "");

  // On: Run goes inactive, because there is nothing left for it to do - and
  // what was typed while it was off is run at once rather than waiting for
  // the next keystroke.
  await auto.click();
  await expect(auto).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#run")).toBeDisabled();
  expect(await stored()).toBe("on");
  await expect(page.locator("#app")).not.toHaveAttribute("src", before ?? "", { timeout: 60000 });
  await expect(page.frameLocator("#app").getByText("not run yet")).toBeVisible();

  // And from here on every change reaches the app on its own.
  const running = await page.locator("#app").getAttribute("src");
  await setSource(page, (await getSource(page)).replace("not run yet", "run by itself"));
  await expect(page.locator("#app")).not.toHaveAttribute("src", running ?? "", { timeout: 60000 });
  await expect(page.frameLocator("#app").getByText("run by itself")).toBeVisible();

  // Off again: Run comes back, the setting is forgotten rather than stored as
  // the default it now equals, and an edit stays in the editor.
  await auto.click();
  await expect(auto).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#run")).toBeEnabled();
  expect(await stored()).toBeNull();
  const last = await page.locator("#app").getAttribute("src");
  await setSource(page, (await getSource(page)).replace("run by itself", "not run either"));
  await page.waitForTimeout(1500);
  await expect(page.locator("#app")).toHaveAttribute("src", last ?? "");
});

test("Auto is remembered between visits, and never in an embedded playground", async ({ page }) => {
  await open(page);
  await page.locator("#autorun").click();
  await expect(page.locator("#autorun")).toHaveAttribute("aria-checked", "true");

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#autorun")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#run")).toBeDisabled();

  // A demo in somebody's documentation page reads the same to every reader -
  // the rule the theme and the checker settings follow, and the draft with
  // them. The stored choice is still there for the page that made it.
  await page.goto("/?embed=1");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#autorun")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#run")).toBeEnabled();
});

// The staged fault: boot( ) asks for the editor's container by id, outside
// its own try/catch, and every startup failure of this shape used to end the
// same way - the page reading "loading the ABAP runtime…" for ever with a
// stack in a console nobody has open. That is how the real one was reported:
// a cached assets/shell.mjs from one build under the next build's
// index.html, reaching for a control that document no longer has.
const breakBoot = (page) =>
  page.addInitScript(() => {
    const real = document.getElementById.bind(document);
    document.getElementById = (id) => {
      if (id === "editor") throw new Error("staged: no editor container");
      return real(id);
    };
  });

test("a startup failure is said in the bar instead of leaving the page loading", async ({ page }) => {
  await breakBoot(page);
  await page.goto("/");

  await expect(page.locator("#status")).toHaveText("the playground could not start", { timeout: 60000 });
  await expect(page.locator("#status")).toHaveClass(/error/);
  // Nothing is served from a cache on a first visit, so nothing is said about
  // one - the message is the failure and nothing else.
  await expect(page.locator("#status")).not.toContainText("cached");
});

test("the editor content survives a reload", async ({ page }) => {
  await open(page);
  await setSource(page, (await getSource(page)).replace(MAIN_MARK, "kept across a reload"));

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("kept across a reload");
});

test("picking a sample replaces the draft, and says how to get it back", async ({ page }) => {
  await open(page);
  await setSource(page, (await getSource(page)).replace(MAIN_MARK, "about to be replaced"));

  // A sample under the same file name goes in as an undoable edit, so the
  // draft is one Undo away and the status line says exactly that.
  const sameFile = SAMPLES.find((s) => s.files[0] === MAIN_FILE && s.title !== MAIN_MARK) ?? SAMPLES[0];
  await runSample(page, sameFile.id);
  await expect(page.locator("#status")).toContainText("one Undo away");
  await expect(page.locator("#undo")).toBeEnabled();
  await page.locator("#undo").click();
  await expect.poll(() => getSource(page)).toContain("about to be replaced");

  // A sample that brings its own class name cannot go in that way - the model
  // the work was in is disposed with the file - so the sentence changes with
  // it, and what it promises is the stored draft rather than the undo stack.
  await runSample(page, OTHER.id);
  expect(await getSource(page, OTHER.files[0])).not.toContain("about to be replaced");
  // Waited for by its whole text: the sentence from the replacement before it
  // also begins with "running", so a substring match would pass on the old one.
  await expect(page.locator("#status")).toHaveText("running - your draft comes back if you reload", {
    timeout: 60000,
  });
  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("about to be replaced");

  // A sample opened over a sample says nothing - there was no work to lose.
  await runSample(page, SAMPLES[0].id);
  await runSample(page, OTHER.id);
  await expect(page.locator("#status")).toHaveText("running");
});

test("a sample that was only read is not kept as a draft", async ({ page }) => {
  await open(page);
  await runSample(page, OTHER.id);

  // Reading a sample is not work to continue. Stored as a draft it would pin
  // this visitor to a frozen copy of it - the sample improves in a later deploy
  // and they go on being opened on the old one, findings and all, labelled as
  // their own last session.
  const stored = () => page.evaluate(() => localStorage.getItem("abap2ui5-playground:files"));
  expect(await stored()).toBeNull();

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain(MAIN_MARK);

  // One keystroke and it is a draft like any other.
  await runSample(page, OTHER.id);
  await setSource(page, (await getSource(page, OTHER.files[0])).replace(OTHER.title, "a sample of my own"), OTHER.files[0]);
  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page, OTHER.files[0])).toContain("a sample of my own");
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

test("the bar begins and ends as the sample catalogue's bar does", async ({ page }) => {
  await open(page);

  // The same brand: the mark and the name, and nothing more - the nav says
  // which part of the site this is (src/catalogue/index.html,
  // tools/sample-pages.mjs).
  await expect(page.locator(".brand")).toHaveText("abap2UI5");
  await expect(page.locator(".brand img")).toBeVisible();

  // And the same far end: the four sections - Home, Documentation, Samples and
  // where you are - then LinkedIn and GitHub, then the button that opens the
  // rest.
  await expect(page.locator(".bar-nav > *")).toHaveText(["Home", "Documentation", "Samples", "Playground"]);
  // The same box the other three bars carry, in the same place: the middle of
  // the row. It used to sit at the right-hand end here, because the workbench
  // owned the middle - the workbench has a row of its own now.
  await expect(page.locator(".bar .search-button")).toBeVisible();
  await expect(page.locator('.bar-nav [aria-current="page"]')).toHaveText("Playground");
  await expect(page.locator('.bar-nav a[href="samples/"]')).toBeVisible();
  await expect(page.locator('.bar-nav a[data-site="docs"]')).toHaveText("Documentation");
  await expect(page.locator(".bar .social")).toHaveCount(2);
  await expect(page.locator('.bar .social[href*="linkedin.com/company/abap2ui5"]')).toBeVisible();
  await expect(page.locator('.bar .social[href*="github.com/abap2UI5"]')).toBeVisible();
  // The menu: closed until pressed, the theme switch and the project's links in
  // it, closed again on Escape and on a click anywhere else.
  const extra = page.locator(".bar .extra");
  const theme = page.locator("#theme");
  await expect(extra.locator("summary")).toBeVisible();
  await expect(theme).toBeHidden();
  await extra.locator("summary").click();
  await expect(theme).toBeVisible();
  expect(await extra.locator(".menu a").count()).toBeGreaterThanOrEqual(10);
  for (const part of ["github.com/abap2UI5/linter", "github.com/abap2UI5/vscode-extension", "github.com/abap2UI5-addons"]) {
    await expect(extra.locator(`.menu a[href*="${part}"]`).first()).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(theme).toBeHidden();
  await extra.locator("summary").click();
  await expect(theme).toBeVisible();
  await page.locator("#status").click();
  await expect(theme).toBeHidden();
});

test("the header keeps to a few rows on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await open(page);

  // It wrapped to four rows - a fifth of the screen, spent before the editor or
  // the app got any of it. What it must not do is grow back.
  //
  // BOTH ROWS, because the header is two now: the project's bar and this
  // page's toolbar. Measuring only the first would be a check that passes
  // because it stopped looking at the part that wraps.
  const bar = await page.locator(".bar").boundingBox();
  const toolbar = await page.locator(".toolbar").boundingBox();
  expect(bar.height + toolbar.height, "the header is not a fifth of the phone").toBeLessThan(152);

  // And nothing that has to be reachable was compacted away with the rows.
  for (const id of ["#undo", "#redo", "#format", "#examples", "#run", "#autorun", "#share", "#source-link", "#status", "#about", ".bar .extra summary"]) {
    await expect(page.locator(id)).toBeVisible();
  }
  // The theme switch is one press further, in the menu - reachable, not gone.
  await page.locator(".bar .extra summary").click();
  await expect(page.locator("#theme")).toBeVisible();
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
  // A sample with a field in it, so there is something a restart would lose -
  // by name, not "the other one": the page opens on it now, and the other
  // one is the hello world, which has nothing to type into.
  await runSample(page, "binding");

  // The frame is started in UI5's dark theme, matching the rest of the page.
  await expect(page.locator("#app")).toHaveAttribute("src", /sap-ui-theme=sap_horizon_dark/);
  const dark = await page.frameLocator("#app").locator("body").evaluate((b) => getComputedStyle(b).backgroundColor);

  // Type something, then switch the system theme: the app changes colour but
  // keeps what was typed - somebody with a half-filled form is not punished
  // for the sun going down.
  const field = page.frameLocator("#app").getByRole("textbox").first();
  await field.fill("still here");
  await page.emulateMedia({ colorScheme: "light" });

  await expect
    .poll(async () =>
      page.frameLocator("#app").locator("body").evaluate((b) => getComputedStyle(b).backgroundColor),
    )
    .not.toBe(dark);
  await expect(field).toHaveValue("still here");
});

test("the switch in the bar overrides the system theme, and is forgotten again when it agrees with it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  const html = page.locator("html");
  const theme = page.locator("#theme");
  // In the menu behind the bar's last button, which a reload closes again.
  const openMenu = () => page.locator(".bar .extra summary").click();
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
  await openMenu();
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
  await openMenu();
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
    // Both, because one of these files is asserted on at the byte level: a
    // TextDecoder swallows a byte order mark by default, which is exactly the
    // thing .abapgit.xml is checked for.
    const data = bytes.subarray(start, start + size);
    entries.push({ name, text: new TextDecoder().decode(data), bytes: data });
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
  expect(markdown).toContain(`CLASS ${MAIN_CLASS} DEFINITION`);
  expect(markdown.endsWith("```")).toBe(true);

  // The zip: named after the app, laid out as a repository somebody could push
  // as it stands - the settings file and a README at the root, the source and
  // its metadata under src/, the source normalised to LF with a newline at the
  // end.
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#share-abapgit").click()]);
  expect(download.suggestedFilename()).toBe(`${MAIN_CLASS}.zip`);
  const { readFileSync } = await import("node:fs");
  const entries = zipEntries(new Uint8Array(readFileSync(await download.path())));
  expect(entries.map((e) => e.name)).toEqual([
    ".abapgit.xml",
    "README.md",
    `src/${MAIN_FILE}`,
    `src/${MAIN_CLASS}.clas.xml`,
  ]);
  // The settings in the shape abap2UI5/app-template carries them, named after
  // the app, and with the byte order mark abapGit writes for this file.
  expect([...entries[0].bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(entries[0].text).toContain(`<NAME>${MAIN_CLASS}</NAME>`);
  expect(entries[0].text).toContain("<STARTING_FOLDER>/src/</STARTING_FOLDER>");
  expect(entries[0].text).toContain("<FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>");
  // The README answers the two questions a folder of ABAP cannot: what it is,
  // and where it came from - the link being the one this dialog just made.
  expect(entries[1].text).toContain(`# ${MAIN_CLASS.toUpperCase()}`);
  expect(entries[1].text).toContain(`src/${MAIN_FILE}`);
  expect(entries[1].text).toContain(`?app_start=${MAIN_CLASS.toUpperCase()}`);
  expect(entries[1].text).toContain(page.url());
  expect(entries[2].text).toContain(`CLASS ${MAIN_CLASS} DEFINITION`);
  expect(entries[2].text).not.toContain("\r");
  expect(entries[2].text.endsWith("\n")).toBe(true);
  expect(entries[3].text).toContain(`<CLSNAME>${MAIN_CLASS.toUpperCase()}</CLSNAME>`);
});
