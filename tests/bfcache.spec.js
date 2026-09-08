import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Nothing on this site may keep a page out of the back/forward cache.
//
// The bar steps back to a page that is still behind the reader so that the
// browser can hand it back alive - the playground with its running app, the
// catalogue at the row the reader was on (site-memory.mjs, and the hand copy
// on the sample pages). The browser declines the moment a page registers an
// unload listener, and Firefox declines on beforeunload too; a Cache-Control
// of no-store declines it everywhere. None of these has a use in this
// repository, and the one place the site would learn it had grown one is the
// console line main.mjs prints on the page that came back rebuilt - after the
// fact, on somebody else's screen. So the sources are read for them here, and
// the three documents the build writes, before anything is published.
//
// Not read: dist/app, the abap2UI5 frontend the app frame loads. Its dirty
// check sets window.onbeforeunload when an app asks for it, which is that
// app's business and not this site's - and a beforeunload does not keep a
// page out of the cache in the browser most readers use.

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const at = path.join(dir, e.name);
    return e.isDirectory() ? walk(at) : /\.(?:mjs|js|html)$/.test(e.name) ? [at] : [];
  });

const SOURCES = [
  ...walk(path.join(ROOT, "src", "shell")),
  ...walk(path.join(ROOT, "src", "catalogue")),
  ...walk(path.join(ROOT, "src", "embed")),
  path.join(ROOT, "tools", "sample-pages.mjs"),
  path.join(ROOT, "tools", "serve.mjs"),
];

const index = JSON.parse(fs.readFileSync(path.join(DIST, "samples", "apps.json"), "utf8"));
const firstPage = index.entries.find((e) => e.page).page;
const DOCUMENTS = [
  path.join(DIST, "index.html"),
  path.join(DIST, "samples", "index.html"),
  path.join(DIST, "samples", firstPage, "index.html"),
];

const KEEPS_OUT = [
  [/addEventListener\(\s*['"](?:before)?unload['"]/, "an unload or beforeunload listener"],
  [/\bon(?:before)?unload\s*=/, "an unload or beforeunload handler property"],
  [/\bon(?:before)?unload=/, "an inline unload attribute"],
  [/no-store/, "a Cache-Control of no-store"],
  [/http-equiv="Cache-Control"/i, "a Cache-Control written into the page"],
];

test("the sources and the built documents are there to be read", () => {
  expect(SOURCES.length, "the source walk found too little - a directory moved").toBeGreaterThan(20);
  for (const doc of DOCUMENTS) expect(fs.existsSync(doc), doc).toBe(true);
});

for (const file of [...SOURCES, ...DOCUMENTS]) {
  test(`${path.relative(ROOT, file)} keeps no page out of the back/forward cache`, () => {
    const text = fs.readFileSync(file, "utf8");
    for (const [re, what] of KEEPS_OUT) {
      expect(text, `${what} keeps every page it lands on out of the cache, and the bar's step back becomes a reload`).not.toMatch(re);
    }
  });
}
