import { test, expect } from "@playwright/test";
import { getSource, open, runSample, sampleFiles, setSource } from "./helpers.mjs";

// The playground as a user meets it: the class in the editor is compiled and
// started, it renders in the frame, and clicking something in it runs ABAP.
//
// The samples are abap2UI5/samples' own now (src/editor/sample-list.mjs), and
// they do not give their controls ids - so these locate what a person locates:
// a field by its label, a button by its text. `Basics II` is the one with both,
// and since it is also the app the page opens on, the two interaction tests
// still pick it by name: what they hold is the sample, not the start page.

// The input and the button of the "Data Binding" sample, and the Text the
// backend writes into.
const app = (page) => page.frameLocator("#app");
const nameField = (page) => app(page).getByRole("textbox").first();
const greetButton = (page) => app(page).getByRole("button", { name: "Greet" });

test("the class in the editor renders as an app", async ({ page }) => {
  await open(page);

  // The title comes out of the ABAP view builder, travels as XML through the
  // roundtrip, and is rendered by UI5 - so seeing it means the whole chain works.
  await expect(app(page).getByText("Data Binding: Input and Button")).toBeVisible();
  await expect(app(page).getByText("connects the public attribute NAME")).toBeVisible();
});

test("a click in the app runs ABAP and updates the view", async ({ page }) => {
  await open(page);
  await runSample(page, "binding");

  await nameField(page).fill("Playground");
  await greetButton(page).click();

  // Computed in ABAP from the value the input pushed over, and pushed back
  // into the model automatically.
  await expect(app(page).getByText("Hello Playground!")).toBeVisible({ timeout: 30000 });
});

test("Run restarts the app from scratch", async ({ page }) => {
  await open(page);
  await runSample(page, "binding");

  await nameField(page).fill("Changed");
  await greetButton(page).click();
  await expect(app(page).getByText("Hello Changed!")).toBeVisible({ timeout: 30000 });

  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running");

  // A fresh database and a reloaded frame: the attribute is back at what
  // check_on_init( ) puts there, and nothing the backend wrote survives.
  await expect(nameField(page)).toHaveValue("World", { timeout: 30000 });
  await expect(app(page).getByText("Hello Changed!")).toHaveCount(0);
});

// A Run after the first restarts the app INSIDE the frame's document - the
// component destroyed and created again on the new Run's address - rather
// than reloading it (frontend-bridge.js, __z2ui5PlaygroundRestart). What has
// to stay true is what the reload guaranteed: nothing of the old app
// survives, neither in the frontend (its typed values, its hash) nor in the
// database (the draft), and the new code is what runs. What is new is held
// by a mark on the frame's window, which a reload would have lost.
test("a second Run restarts the app in the kept frame, and nothing of the old one survives", async ({ page }) => {
  await open(page);
  await runSample(page, "binding");
  const frame = () => page.frames().find((f) => f.url().includes("/app/index.html"));

  await nameField(page).fill("Changed");
  await greetButton(page).click();
  await expect(app(page).getByText("Hello Changed!")).toBeVisible({ timeout: 30000 });
  await frame().evaluate(() => {
    window.__playgroundMark = "kept";
    // Routing state an app leaves in the address, which a reload dropped.
    window.location.hash = "#/somewhere";
  });
  const before = new URL(frame().url()).searchParams.get("run");

  // New code: the title changes, so the app on screen says which one runs.
  const [file] = sampleFiles("binding");
  await setSource(page, (await getSource(page, file)).replace("Data Binding: Input and Button", "Data Binding: Restarted"), file);
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });

  await expect(app(page).getByText("Data Binding: Restarted")).toBeVisible({ timeout: 30000 });
  await expect(nameField(page)).toHaveValue("World", { timeout: 30000 });
  await expect(app(page).getByText("Hello Changed!")).toHaveCount(0);
  // The same document: the mark is still there, the address is the new Run's.
  expect(await frame().evaluate(() => window.__playgroundMark)).toBe("kept");
  const after = new URL(frame().url());
  expect(after.searchParams.get("run")).not.toBe(before);
  expect(after.hash).toBe("");
  // And the restarted app works: a click runs ABAP against the fresh draft.
  await nameField(page).fill("Again");
  await greetButton(page).click();
  await expect(app(page).getByText("Hello Again!")).toBeVisible({ timeout: 30000 });
});

test("a run loads only from this origin, and nothing 404s", async ({ page }) => {
  const external = [];
  const missing = [];
  await page.route("**", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://localhost:8080") external.push(url.href);
    return route.continue();
  });
  page.on("response", (r) => {
    if (r.status() === 404) missing.push(r.url());
  });

  await open(page);
  await expect(app(page).getByText("Data Binding: Input and Button")).toBeVisible();

  expect(external, "the playground must work without a CDN").toEqual([]);
  expect(missing, "a 404 means the build left something out").toEqual([]);
});

// The frame's first load is fetched into the cache while the corpus parses,
// by the page rather than by the frame - see src/shell/warm-up.mjs. What is
// held here is that the page asks, for the right URLs (the stylesheets with
// the query UI5 puts on them), and before Run could have. Whether the frame
// then finds them in the cache is the server's caching headers' business:
// GitHub Pages answers with a max-age, the test server on purpose does not.
test("the page warms the app frame's first load while the corpus parses", async ({ page }) => {
  // Every request for something under app/, in the order the browser made
  // them, and who asked: the page (the warm-up) or the frame (UI5 itself).
  const asked = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!url.pathname.includes("/app/")) return;
    asked.push({ byPage: r.frame() === page.mainFrame(), path: url.pathname + url.search });
  });

  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  const firstByFrame = asked.findIndex((a) => !a.byPage);
  expect(firstByFrame, "the frame loaded something").toBeGreaterThan(0);
  const warmed = asked.slice(0, firstByFrame).map((a) => a.path);
  // Everything the page asked for, it asked for before the frame existed.
  expect(asked.slice(firstByFrame).filter((a) => a.byPage)).toEqual([]);

  expect(warmed).toContain("/app/resources/sap-ui-core.js");
  expect(warmed).toContain("/app/resources/sap/m/library-preload.js");
  expect(warmed.some((p) => /^\/app\/resources\/sap\/m\/themes\/sap_horizon\/library\.css\?sap-ui-dist-version=\d/.test(p))).toBe(true);
  // And every one of them is a file the build produced - a warm-up of a URL
  // that 404s would be a request for nothing on every visit.
  const answers = await Promise.all(warmed.map((p) => page.request.get(p).then((r) => `${r.status()} ${p}`)));
  expect(answers.filter((a) => !a.startsWith("200 "))).toEqual([]);
});

test("the frontend says something useful when opened without the playground", async ({ page }) => {
  await page.goto("/app/index.html?app_start=ZCL_PLAYGROUND");

  // UI5 boots, the first roundtrip has nowhere to go, and the frontend's own
  // error view carries the explanation - not a TypeError about a missing
  // property on window.parent.
  await expect(page.getByText("no backend of its own")).toBeVisible({ timeout: 60000 });
});
