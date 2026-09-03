import { test, expect } from "@playwright/test";
import { control, open } from "./helpers.mjs";

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

test("what has to stay live is not cached", async ({ page }) => {
  await open(page);
  expect(await workerReady(page)).toBe(true);

  const { served, fetched } = watch(page);
  await open(page);

  // The page itself. A cached index.html would outlive the deploy that wrote
  // it, and it is the one file cheap enough that there is nothing to save.
  expect([...served]).not.toContain("/");
  expect([...fetched]).toContain("/");

  // The app's own document. Run reloads it with a new counter every time, and
  // the counter is the whole mechanism: cached, an app would never restart.
  expect([...served].filter((p) => p.startsWith("/app/index.html"))).toEqual([]);

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
        /^\/assets\/[\w.-]+\.(ttf|mjs)$/.test(entry) ||
        (entry.startsWith("/app/") && entry !== "/app/index.html"),
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
  await expect(control(page, "btnGreet")).toBeVisible();

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

  // The document itself is the one thing under app/ that stays live.
  expect([...fetched].filter((p) => p.startsWith("/app/")).map((p) => p.split("?")[0])).toEqual(["/app/index.html"]);
});

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
