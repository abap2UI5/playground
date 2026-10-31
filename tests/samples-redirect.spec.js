import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// The sample catalogue is a site of its own (abap2UI5/samples-site); what
// this deployment keeps under samples/ is the index and a forward for every
// address it used to answer (tools/sample-pages.mjs).

const SAMPLES_SITE = "https://abap2ui5.github.io/samples-site/";
const index = JSON.parse(readFileSync(new URL("../dist/samples/apps.json", import.meta.url), "utf8"));

test("samples/ and samples/all/ forward to the samples site", async ({ request }) => {
  for (const rel of ["/samples/", "/samples/all/"]) {
    const html = await (await request.get(rel)).text();
    expect(html).toContain(`<meta http-equiv="refresh" content="0; url=${SAMPLES_SITE}">`);
    expect(html).toContain(`<link rel="canonical" href="${SAMPLES_SITE}">`);
    expect(html).not.toMatch(/<script/);
  }
});

test("every sample that had a page here forwards to its page there", async ({ request }) => {
  const paged = index.entries.filter((e) => e.page);
  expect(paged.length).toBeGreaterThan(500);
  for (const e of [paged[0], paged[Math.floor(paged.length / 2)], paged.at(-1)]) {
    const html = await (await request.get(`/samples/${e.page}`)).text();
    expect(html).toContain(`url=${SAMPLES_SITE}sample/${e.page}`);
  }
});

test("the index stays, with what the samples site builds from", async ({ request }) => {
  const json = await (await request.get("/samples/apps.json")).json();
  expect(json.entries.length).toBeGreaterThan(500);
  expect(json.sources.length).toBe(3);
  expect(json.entries[0]).toHaveProperty("class");
  expect(json.entries[0]).toHaveProperty("file");
});
