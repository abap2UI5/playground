// The counted figures under the hero - unit tests, specs, browser suites,
// gates: what a reader who is deciding wants to know about the size of the
// thing, and a number nobody here types. The framework's README carries them
// between `facts:start` and `facts:end`, regenerated over there by
// `npm run facts` and held current by a gate; the framework this build pins is
// in deps/abap2ui5, so the figures are the ones of the release the playground
// runs. A README without the block costs the line, never the build. Left out:
// the workflow count (a maintainer's figure), the release span (the tagline
// says it) and the trailing "counted from …".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP = /workflows|→|counted/;

export function factsIn(readme) {
  const block = String(readme).match(/<!-- facts:start -->([\s\S]*?)<!-- facts:end -->/);
  if (!block) return [];
  const text = block[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.split(/\s·\s/).map((s) => s.trim()).filter((s) => s && !SKIP.test(s));
}

/* Where the README is. Named by tools/evaluate-page.mjs in EVALUATE_README
 * when it builds the page, because Astro bundles this module into its
 * prerender directory and import.meta.url says nothing about deps/ from
 * there; the fallback is right for a test that imports this file as it is. */
export const README = process.env.EVALUATE_README
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "deps", "abap2ui5", "README.md");

export function readFacts(file = README) {
  return fs.existsSync(file) ? factsIn(fs.readFileSync(file, "utf8")) : [];
}
