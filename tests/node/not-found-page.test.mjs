// The guesser of dist/404.html (tools/not-found-page.mjs), run over a list of
// its own in a stub document: only the inline script is under test, not the
// page around it (tests/not-found.spec.js holds the built page).
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { notFoundPage } from "../../tools/not-found-page.mjs";

const rows = [];
for (let i = 0; i < 40; i++) rows.push({ dir: `z2ui5_cl_smp_app_${String(i).padStart(3, "0")}`, title: `Sample number ${i}` });
const script = [...notFoundPage(rows).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  .find((s) => s.includes('getElementById("near")'));

function suggestions(pathname) {
  const shown = [];
  const box = { hidden: true, querySelector: () => ({ appendChild: (li) => shown.push(li.children[1].textContent.slice(3)) }) };
  const el = () => ({ children: [], textContent: "", appendChild(c) { this.children.push(c); } });
  vm.runInNewContext(script, { document: { getElementById: () => box, createElement: el }, location: { pathname }, decodeURIComponent });
  return shown;
}

test("a word that matched nothing leaves the name's closeness cut as a closeness", () => {
  // "x13" is a word of the address that is in no title and no name: the
  // closeness answers, and only the names within one of the best are shown -
  // not half the best, which is the whole list.
  assert.deepEqual(suggestions("/playground/samples/z2ui5_cl_smp_app_x13/"),
    ["Z2UI5_CL_SMP_APP_013", "Z2UI5_CL_SMP_APP_003", "Z2UI5_CL_SMP_APP_023", "Z2UI5_CL_SMP_APP_033"]);
});
