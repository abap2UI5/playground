import { test, expect } from "@playwright/test";
import { MAIN_CLASS, open, setSource } from "./helpers.mjs";

// The app frame and the page around it speak only in messages
// (src/shell/frame-link.mjs, src/shell/frontend-bridge.js), and on the AI
// Studio's and the AI Pilot's pages the frame is on an opaque origin: an
// app's own script - a view's core:HTML, anything the app loads - cannot
// reach the page that holds the reader's API key. What such a script can do
// is what code evaluated in the frame can do, so that is what these do.

const appFrame = (page) => page.frames().find((f) => f.url().includes("/app/index.html"));

// Everything an app's script would try, from inside the frame, answered as
// data: each reach either throws (and says how) or reads what it found.
const reachOut = () => {
  const tryIt = (fn) => {
    try {
      return { ok: true, value: String(fn()) };
    } catch (e) {
      return { ok: false, error: String(e?.name ?? e) };
    }
  };
  return {
    origin: self.origin,
    parentDocument: tryIt(() => window.parent.document.title),
    parentGlobal: tryIt(() => typeof window.parent.monaco),
    parentLocation: tryIt(() => window.parent.location.href),
    topDocument: tryIt(() => window.top.document.body.innerHTML.length),
    storage: tryIt(() => window.localStorage.getItem("isolation-probe")),
    caches: tryIt(() => typeof window.caches.open),
  };
};

test("on the AI Pilot's page the app frame is on an opaque origin and cannot reach the page", async ({ page }) => {
  await page.goto("/pilot/");
  // Something of the page's own in its storage, that a script in the frame
  // must not be able to read.
  await page.evaluate(() => window.localStorage.setItem("isolation-probe", "the page's"));
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#app")).toHaveAttribute("sandbox", /allow-scripts/);
  expect(await page.locator("#app").getAttribute("sandbox")).not.toContain("allow-same-origin");
  // The app is up, and was answered by the page - by message only.
  await expect(page.locator("#pilot-app-name")).toContainText("Z2UI5_CL_SMP_APP_494", { timeout: 30000 });

  const found = await appFrame(page).evaluate(reachOut);
  expect(found.origin).toBe("null");
  expect(found.parentDocument.ok).toBe(false);
  expect(found.parentGlobal.ok).toBe(false);
  expect(found.parentLocation.ok).toBe(false);
  expect(found.topDocument.ok).toBe(false);
  // The frame has a storage of its own for the document's lifetime
  // (frontend-bridge.js), not the page's.
  expect(found.storage).toEqual({ ok: true, value: "null" });
  expect(found.caches.ok).toBe(false);

  // A message that claims to be the page, from anywhere but the page, is not
  // taken: the frame's own window posting to itself changes no theme.
  const theme = await appFrame(page).evaluate(async () => {
    const Theming = window.sap.ui.require("sap/ui/core/Theming");
    const before = Theming.getTheme();
    window.postMessage({ z2ui5Frame: 1, type: "theme", theme: before === "sap_horizon" ? "sap_horizon_dark" : "sap_horizon" }, "*");
    await new Promise((resolve) => setTimeout(resolve, 300));
    return [before, Theming.getTheme()];
  });
  expect(theme[1]).toBe(theme[0]);
});

// The studio's frame is set up by the same switch (page.mjs) and holds no app
// until the model builds one - tests/ai.spec.js runs those in it.
test("on the AI Studio's page the app frame is sandboxed without allow-same-origin", async ({ page }) => {
  await page.goto("/ai/");
  await expect(page.locator("#status")).toHaveText("ready - describe the app you want", { timeout: 120000 });
  const sandbox = await page.locator("#app").getAttribute("sandbox");
  expect(sandbox).toContain("allow-scripts");
  expect(sandbox).not.toContain("allow-same-origin");
});

test("the playground's frame is answered by message: the page offers it no object to reach for", async ({ page }) => {
  await open(page);
  // The bridge once read window.parent.__z2ui5Playground; there is nothing
  // of the kind on the page any more, and the app ran all the same.
  expect(await page.evaluate(() => typeof window.__z2ui5Playground)).toBe("undefined");
  // Not isolated here - page.mjs says why (the HTTP cache, the service
  // worker, offline): same origin, no sandbox.
  expect(await page.locator("#app").getAttribute("sandbox")).toBeNull();
  await expect(page.frameLocator("#app").locator(".sapMShell, .sapMPage").first()).toBeVisible({ timeout: 30000 });
});

// Where a link's ABAP itself runs: the runtime worker, on the site's origin.
// It gives up the origin's CacheStorage and IndexedDB, and nested workers,
// before anything of the reader's runs in it (src/runtime/lockdown.mjs) - the
// service worker answers from that cache, so a script put there ran on the
// next visit, the AI pages' included.
const runtimeWorker = (page) => page.workers().find((w) => w.url().includes("/runtime/framework.mjs"));

test("the runtime worker cannot reach the origin's cache, its databases or a fresh worker", async ({ page }) => {
  await open(page);
  const found = await runtimeWorker(page).evaluate(() => {
    const own = (o, name) => Object.prototype.hasOwnProperty.call(o, name);
    const chain = [];
    for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) chain.push(o);
    const tryIt = (fn) => {
      try {
        return String(fn());
      } catch (e) {
        return `threw ${e?.name}`;
      }
    };
    return {
      types: [typeof caches, typeof indexedDB, typeof Worker, typeof self.SharedWorker].join(","),
      // No accessor left anywhere up the chain to call again...
      accessors: chain.filter((o) => o !== self).flatMap((o) => ["caches", "indexedDB", "Worker"].filter((n) => own(o, n))),
      // ...and the pinned property cannot be taken back.
      redefine: tryIt(() => Object.defineProperty(self, "caches", { value: 1 })),
      reassigned: tryIt(() => {
        self.indexedDB = {};
        return typeof self.indexedDB;
      }),
    };
  });
  expect(found.types).toBe("undefined,undefined,undefined,undefined");
  expect(found.accessors).toEqual([]);
  expect(found.redefine).toBe("threw TypeError");
  // Silently ignored in sloppy code, a TypeError in strict - never a store.
  expect(found.reassigned).toMatch(/^(undefined|threw TypeError)$/);
});

test("an app's WRITE '@KERNEL' finds no cache, database or worker to reach for", async ({ page }) => {
  await open(page);
  const cls = MAIN_CLASS.toLowerCase();
  await setSource(
    page,
    `CLASS ${cls} DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
    DATA probe TYPE string.
ENDCLASS.

CLASS ${cls} IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    WRITE '@KERNEL this.probe.set("reached:" + [typeof caches, typeof indexedDB, typeof Worker].join("/"));'.
    client->view_display( z2ui5_cl_ui5_view_builder=>factory( )->stringify( ) ).
    client->message_box_display( probe ).
  ENDMETHOD.
ENDCLASS.
`,
  );
  await page.locator("#run").click();
  await expect(page.frameLocator("#app").getByText("reached:undefined/undefined/undefined")).toBeVisible({ timeout: 60000 });
});
