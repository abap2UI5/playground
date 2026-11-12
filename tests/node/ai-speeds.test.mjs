// The header's speeds and the prices the usage line counts with
// (src/shell/ai-speeds.mjs): a model offered in the select without a price
// showed tokens and no dollars, and nothing said why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SPEED, PRICES, PRICES_AS_OF, SPEEDS } from "../../src/shell/ai-speeds.mjs";

test("every model the header offers has a price, and the default is one of the speeds", () => {
  assert.ok(SPEEDS[DEFAULT_SPEED]);
  for (const [speed, { model }] of Object.entries(SPEEDS)) {
    assert.ok(PRICES[model], `${speed} uses ${model}, which has no entry in PRICES`);
  }
});

test("a price is four numbers, a cache read cheaper than fresh input, a write dearer", () => {
  for (const [model, p] of Object.entries(PRICES)) {
    for (const k of ["input", "output", "cacheWrite", "cacheRead"]) assert.equal(typeof p[k], "number", `${model}.${k}`);
    assert.ok(p.cacheRead < p.input && p.cacheWrite > p.input, model);
  }
  assert.match(PRICES_AS_OF, /^[A-Z][a-z]+ \d{4}$/);
});
