import { test, expect } from "@playwright/test";
import { control, getSource, MAIN_MARK, open, runSample, SAMPLES, setSource } from "./helpers.mjs";

// The sample with an input and a button in it, and the word this test writes
// into it so it can tell its own copy from a fresh one.
const BINDING = SAMPLES.find((s) => s.id === "binding");
const MARK = "Kept for the offline visit";

// The service worker exists for one reason: a second visit should not pay for
// the first one again. What has to hold is both halves of that - the heavy
// assets come out of its cache, and everything that has to stay live is still
// fetched. See src/shell/sw.js.
//
// Every test here visits twice on purpose. The worker deliberately does not
// claim the page that registered it, so the first visit is the one that fills
// the cache and the second is the first one it serves.

// Where a response came from, as the browser saw it: the worker, or the wire.
function watch(page) {
  const served = new Set();
  const fetched = new Set();
  page.on("response", (r) => {
    const url = new URL(r.url());
    (r.fromServiceWorker() ? served : fetched).add(url.pathname + url.search);
  });
  return { served, fetched };
}

// Resolves once a worker is active for this scope - which, because activation
// waits on install, is also when its precache is filled.
const workerReady = (page) => page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

test("the heavy assets come out of the worker's cache on a second visit", async ({ page }) => {
  await open(page);
  expect(await workerReady(page)).toBe(true);

  const { served, fetched } = watch(page);
  await open(page);

  // The four the size budget is written around - every byte a visitor waits on
  // before the playground can do anything.
  for (const asset of [
    "/assets/shell.mjs",
    "/editor/registry.mjs",
    "/editor/corpus.json",
    "/runtime/framework.mjs",
    "/runtime/sql-wasm.wasm",
  ]) {
    expect([...served], `${asset} should have been served by the worker`).toContain(asset);
  }
  // And the chunks split off the bundle - the transpiler, the linter - whose
  // hashed names the build writes into the worker so it can precache them.
  const chunks = [...served, ...fetched].filter((p) => /^\/assets\/[\w.-]+\.mjs$/.test(p) && p !== "/assets/shell.mjs");
  expect(chunks.length, "the bundle has chunks").toBeGreaterThan(0);
  expect([...fetched].filter((p) => chunks.includes(p)), "every chunk came out of the worker's cache").toEqual([]);
});

test("the documents are answered from the network first, and the cache is only the fallback", async ({ page }) => {
  await open(page);
  expect(await workerReady(page)).toBe(true);

  // Both documents are in the cache - that is what the installed playground
  // opens on with no network - but a copy in the cache must never win over
  // the network: this page's, because a cached index.html would outlive the
  // deploy that wrote it; the app's, because Run reloads it with a new
  // counter every time and the counter is the whole mechanism. So the
  // cached copies are replaced by hand with pages that would say so, and
  // the visit has to be the real thing anyway.
  await page.evaluate(async () => {
    const [name] = await caches.keys();
    const cache = await caches.open(name);
    for (const rel of ["index.html", "app/index.html"]) {
      await cache.put(
        new URL(rel, document.baseURI),
        new Response("<title>stale</title><p>a copy from the cache</p>", { headers: { "content-type": "text/html" } }),
      );
    }
  });
  await open(page);
  await expect(page).not.toHaveTitle("stale");
  await expect(page.frameLocator("#app").getByText(MAIN_MARK)).toBeVisible();

  // And nothing at all is in the cache that was not asked for by name.
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names[0]);
    return { names, entries: (await cache.keys()).map((r) => new URL(r.url).pathname) };
  });
  // One build, one cache: the name carries the build id, and activate deletes
  // every other one.
  expect(cached.names).toHaveLength(1);
  expect(cached.names[0]).toMatch(/^abap2ui5-playground-[0-9a-f]{16}$/);
  for (const entry of cached.entries) {
    expect(
      entry === "/assets/shell.mjs" ||
        entry === "/assets/shell.css" ||
        entry === "/editor/corpus.json" ||
        entry === "/editor/registry.mjs" ||
        entry === "/runtime/framework.mjs" ||
        entry === "/runtime/sql-wasm.wasm" ||
        entry === "/index.html" ||
        /^\/assets\/[\w.-]+\.(ttf|mjs)$/.test(entry) ||
        entry.startsWith("/app/"),
      `${entry} is in the cache and is not on the allow list`,
    ).toBe(true);
  }
});

test("the app frame's first load is precached, in the theme the page has not used", async ({ page }) => {
  await open(page);
  expect(await workerReady(page)).toBe(true);

  // The light theme the page just ran in would be in the cache through use;
  // the dark one it never asked for is only there because install put it
  // there - and so, on a second visit, is a first Run that needs no network.
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names[0]);
    return (await cache.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
  });
  expect(cached.some((p) => /^\/app\/resources\/sap\/m\/themes\/sap_horizon_dark\/library\.css\?/.test(p))).toBe(true);
  expect(cached).toContain("/app/resources/sap-ui-core.js");
  expect(cached).toContain("/app/Component-preload.js");
});

test("the app frame's stylesheets and component come out of the cache as well", async ({ page }) => {
  await open(page);
  expect(await workerReady(page)).toBe(true);
  // The first visit's app is still fetching its fonts when the status line
  // says running, and this page is not the worker's yet - so the watch would
  // count those against the second visit. Let it finish first.
  await page.waitForLoadState("networkidle");

  const { served, fetched } = watch(page);
  await open(page);
  await expect(page.frameLocator("#app").getByText(MAIN_MARK)).toBeVisible();

  // The two theme stylesheets carry a query (?sap-ui-dist-version=...) that
  // names the build rather than a moment, and the frontend's own bundle and
  // manifest sit beside app/resources rather than under it. Every one of them
  // went to the network on every Run until the allow list said otherwise -
  // and the stylesheets are what the app's first paint waits on.
  const kept = [...served];
  expect(kept.some((p) => /^\/app\/resources\/sap\/m\/themes\/[^/]+\/library\.css\?/.test(p))).toBe(true);
  expect(kept.some((p) => /^\/app\/resources\/sap\/ui\/core\/themes\/[^/]+\/library\.css\?/.test(p))).toBe(true);
  expect(kept).toContain("/app/Component-preload.js");
  expect(kept).toContain("/app/frontend-bridge.js");
  expect(kept.some((p) => p.startsWith("/app/manifest.json"))).toBe(true);

  // The document itself is the one thing under app/ that goes to the network
  // (through the worker, which asks the network first - see the test above).
  expect([...fetched].filter((p) => p.startsWith("/app/")).map((p) => p.split("?")[0]).filter((p) => p !== "/app/index.html")).toEqual([]);
});

test("the playground opens and runs with no network, on what the last visit left in the cache", async ({ page, context }) => {
  // Installed from a home screen, opened on a train: the manifest makes the
  // page installable, and this is the half the worker has to hold up - every
  // asset the page and the app frame ask for is in the cache, the two
  // documents included, and the ABAP runs where it always did, in this tab.
  await open(page);
  expect(await workerReady(page)).toBe(true);
  await page.waitForLoadState("networkidle");
  // A controlled visit, so the app's own assets have all passed through the
  // worker once and been kept - including what the app only reaches for on
  // the first press of its button, UI5's message toast, which is the honest
  // shape of "what the last visit left": the modules a UI5 app loads lazily
  // are in the cache once they have been loaded, and not before.
  await open(page);
  // An app with something to press, made into a draft so the offline visit
  // opens on the same one: a sample that was only read is not stored (see
  // remember( ) in main.mjs), and this test needs the button on both visits.
  await runSample(page, BINDING.id);
  const [file] = BINDING.files;
  await setSource(page, (await getSource(page, file)).replace("Data Binding", MARK), file);
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/^running/, { timeout: 60000 });
  await press(page, "online");
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  try {
    await open(page);
    await expect(page.frameLocator("#app").getByText(MARK)).toBeVisible();
    await press(page, "offline");
  } finally {
    await context.setOffline(false);
  }
});

// Type a name and press Greet, and read the answer the ABAP wrote back. By
// role and by text: the samples come out of abap2UI5/samples and give their
// controls no ids.
async function press(page, name) {
  await page.frameLocator("#app").getByRole("textbox").first().fill(name);
  await page.frameLocator("#app").getByRole("button", { name: "Greet" }).click();
  await expect(page.frameLocator("#app").getByText(`Hello ${name}!`)).toBeVisible({ timeout: 30000 });
}

test("a ?src= link is still read from where it lives, and still runs", async ({ page }) => {
  await open(page);
  expect(await workerReady(page)).toBe(true);

  const { served, fetched } = watch(page);
  // Same origin, so it is exactly the case the allow list has to say no to:
  // linked ABAP that a cache would freeze at whatever it said the first time.
  await page.goto("/?src=examples/zcl_linked_example.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  expect([...fetched]).toContain("/examples/zcl_linked_example.clas.abap");
  expect([...served]).not.toContain("/examples/zcl_linked_example.clas.abap");
  await expect(control(page, "txtNote")).toContainText("fetched from a URL");
});

test("the worker is served under a project path as well as at the root", async ({ page }) => {
  // GitHub Pages puts the site under /<repo>/, and a worker can only ever
  // control the directory it was served from - so registering it against the
  // document rather than the origin is what makes it work there at all.
  await page.goto("/under-a-subpath/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await workerReady(page)).toBe(true);

  const scope = await page.evaluate(() =>
    navigator.serviceWorker.ready.then((r) => new URL(r.scope).pathname),
  );
  expect(scope).toBe("/under-a-subpath/");

  const { served } = watch(page);
  await page.goto("/under-a-subpath/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect([...served]).toContain("/under-a-subpath/assets/shell.mjs");
});

test("a cached runtime from another build is thrown away, not waited on forever", async ({ page }) => {
  // The failure a deploy used to leave behind: a service worker cache holding
  // the new shell beside an old framework - the old one a page module that,
  // started as a worker, loads cleanly and never says a word. Put that shape
  // into the cache by hand, then visit again.
  await open(page);
  expect(await workerReady(page)).toBe(true);
  await page.evaluate(async () => {
    const [name] = await caches.keys();
    const cache = await caches.open(name);
    await cache.put(
      new URL("runtime/framework.mjs", document.baseURI),
      new Response("// a framework from another build: loads, says nothing\n", {
        headers: { "content-type": "text/javascript" },
      }),
    );
  });

  // Seconds of patience rather than the minute a visitor gets, so the test
  // does not wait a minute to prove it.
  await page.addInitScript(() => {
    window.__abap2ui5RuntimePatience = 3000;
  });
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText(/did not start.*please reload/, { timeout: 120000 });
  await expect(page.locator(".log-body")).toContainText("never reported ready");

  // The remedy: the cache and the worker are gone, so the reload is a first
  // visit - and it runs.
  expect(
    await page.evaluate(async () => ({
      caches: (await caches.keys()).filter((n) => n.startsWith("abap2ui5-playground-")),
      worker: (await navigator.serviceWorker.getRegistration()) !== undefined,
    })),
  ).toEqual({ caches: [], worker: false });
  await open(page);
});

test("a core asset the worker fetches on a miss is hashed against the build, and kept when it matches", async ({ page }) => {
  // What install and serve( ) put in the cache under a core asset's name is
  // checked against the hash the build wrote into the worker: a copy the
  // CDN or the HTTP cache still had from the previous deploy is not kept.
  // A stranger's bytes cannot be handed to the worker from here - a route
  // answers the page's requests, not a service worker's - so this holds the
  // half that can be driven: the cache emptied of the framework, the worker
  // asked for it again through a fetch it answers, and the real bytes back
  // in the cache, which they only are if the hash agreed.
  await open(page);
  expect(await workerReady(page)).toBe(true);
  // The page that registered the worker is not served by it - it claims
  // nothing - so a second visit, which is.
  await open(page);

  const cachedFramework = () =>
    page.evaluate(async () => {
      const [name] = await caches.keys();
      const cache = await caches.open(name);
      const hit = await cache.match(new URL("runtime/framework.mjs", document.baseURI));
      return hit ? (await hit.text()).length : null;
    });
  const before = await cachedFramework();
  expect(before).toBeGreaterThan(1000);

  // Emptied, then asked for again: the worker misses, fetches the real bytes
  // and keeps them, because they hash to the build.
  await page.evaluate(async () => {
    const [name] = await caches.keys();
    await (await caches.open(name)).delete(new URL("runtime/framework.mjs", document.baseURI));
    await (await fetch(new URL("runtime/framework.mjs", document.baseURI))).text();
  });
  await expect.poll(cachedFramework, { timeout: 20000 }).toBe(before);
});

test("a startup failure on a page the worker is serving throws the cached site away", async ({ page }) => {
  // The first visit is the one that installs the worker and fills its cache.
  await open(page);
  expect(await workerReady(page)).toBe(true);

  // The second is served by it, and fails - the shape of a cache holding one
  // build's bundle under another build's document, which is what a deploy
  // could leave behind before the build stamp above was checked on every
  // asset. A page that cannot start and is being served from a cache has one
  // repair, and it is the reader who has to be asked for it.
  // Staged for one load only: an init script runs on every navigation in this
  // page, and the reload below has to be the ordinary one a reader would do.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("staged-boot-failure")) return;
    sessionStorage.setItem("staged-boot-failure", "1");
    const real = document.getElementById.bind(document);
    document.getElementById = (id) => {
      if (id === "editor") throw new Error("staged: no editor container");
      return real(id);
    };
  });
  await page.goto("/");

  await expect(page.locator("#status")).toContainText("cached copy was discarded, please reload", {
    timeout: 60000,
  });

  // The worker is gone, and that is the repair: it goes on controlling the
  // page it is already serving until that page unloads, so the reload is the
  // first load it cannot touch.
  //
  // What is deliberately NOT asserted here is an empty cache, and this cost a
  // CI run to learn. The caches ARE emptied - for an instant. A startup
  // failure this early lands with the page's own requests still in flight,
  // every one of them through a worker that is still serving, and its
  // on-a-miss path puts what it fetches back under the same name. So the
  // cache comes back within a second and stays. It is harmless - nothing
  // reads a cache but a worker, and there is no longer one - and the fresh
  // worker the next visit registers re-fetches every core asset past the HTTP
  // cache and checks it against the build. The late failure two tests up
  // (STALLED) does empty it for good, because by then the page has stopped
  // asking for anything.
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))).toBe(0);

  // And the reload the reader was asked for is a first visit: nothing is
  // served from a cache, and the playground comes up.
  const { served } = watch(page);
  await open(page);
  expect([...served], "the reload went to the network, not to a worker").toEqual([]);
});
