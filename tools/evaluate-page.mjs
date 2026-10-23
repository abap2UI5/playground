// dist/evaluate/ - the page for the person who approves abap2UI5, written
// beside the sample pages and the 404 by tools/build-catalogue.mjs.
//
// It lived in the manual, at /docs/evaluate, drawn like the front door. A
// developer sends this link to the person who decides, and an address under
// /docs/ says "manual" before they have read a word - so it is a page of this
// deployment, beside the catalogue and the AI Studio, and /docs/evaluate
// redirects here (abap2UI5/docs keeps the stub).
//
// THE PAGE IS AN ASTRO PROJECT, src/evaluate/: a layout that wears the frame
// of tools/sample-frame.mjs, three components (the hero, the figures, the
// tiles) and the prose as one markdown file per section. Astro because the
// page is a landing page - sections, a comparison, the objections, four doors
// - and that is the shape its components and its markdown are made for, while
// what it emits is static HTML with no script of its own. It runs here, at
// build time, and nowhere else: nothing of Astro reaches the reader but the
// HTML and one stylesheet.
//
// Astro writes into build/evaluate/; this copies the result into dist/evaluate/
// and sends each document out through withPolicy( ), like every page here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripHtmlComments, withPolicy } from "./html.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EVALUATE_DIR = path.join(ROOT, "src", "evaluate");
const OUT = path.join(ROOT, "build", "evaluate");

/* Every file the page is made of, for build-catalogue.mjs's stamp: a change
 * to any of them is a change to the page. Not what Astro writes beside them
 * itself - its generated types in .astro/ (gitignored) - which would make the
 * stamp differ between a fresh checkout and the second build. */
export function evaluateSources(dir = EVALUATE_DIR) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && !path.relative(dir, e.parentPath).split(path.sep).some((d) => d.startsWith(".") || d === "node_modules"))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}

const log = (m) => console.log(`build-catalogue: ${m}`);

/* Every table the sections' markdown writes goes into a <div class="table-wrap">,
 * so one too wide for a phone scrolls in its own box instead of pushing the
 * page sideways (tests/evaluate.spec.js holds the 320px width). Here, on the
 * written HTML, rather than as a rehype plugin: Astro's markdown processor is
 * Sätteri now, and plugins would need the unified one as a second dependency. */
export const wrapTables = (html) => html
  .replace(/<table(?=[\s>])/g, '<div class="table-wrap"><table')
  .replace(/<\/table>/g, "</table></div>");

/** Builds the Astro project and writes dist/evaluate/. */
export async function writeEvaluatePage(distDir) {
  /* Astro reports anonymous usage to its authors unless told not to; a build
   * of this site sends nothing anywhere it does not have to. */
  process.env.ASTRO_TELEMETRY_DISABLED = "1";
  // the README the counted figures come from (src/evaluate/lib/facts.mjs)
  process.env.EVALUATE_README = path.join(ROOT, "deps", "abap2ui5", "README.md");
  const { build } = await import("astro");
  fs.rmSync(OUT, { recursive: true, force: true });
  await build({ root: EVALUATE_DIR, logLevel: "warn" });

  const dir = path.join(distDir, "evaluate");
  fs.rmSync(dir, { recursive: true, force: true });
  let pages = 0;
  for (const e of fs.readdirSync(OUT, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const from = path.join(e.parentPath, e.name);
    const to = path.join(dir, path.relative(OUT, from));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (e.name.endsWith(".html")) {
      const html = fs.readFileSync(from, "utf8");
      /* Astro adds a script of its own only for a client component or a
       * <script> it parsed; the page has neither, and a page that grew one
       * would go out with a hash nobody reviewed. */
      if (/<script[^>]*type="module"[^>]*src="[^"]*\/assets\//.test(html)) {
        throw new Error("evaluate: Astro bundled a script into the page - the Evaluate page carries none of its own");
      }
      fs.writeFileSync(to, withPolicy(stripHtmlComments(wrapTables(html))));
      pages++;
    } else {
      fs.copyFileSync(from, to);
    }
  }
  if (!fs.existsSync(path.join(dir, "index.html"))) throw new Error("evaluate: Astro wrote no index.html");
  log(`evaluate/ (Astro, ${pages} page)`);
}
