// The Evaluate page is an Astro project of one page (tools/evaluate-page.mjs
// builds it; docs/design/sample-catalogue.md says why it is Astro). Static
// output only: no client component, no island, no script of Astro's own - the
// page carries the same two inline scripts every page of this deployment
// carries (the theme before the first paint, the bar's menu) and the shared
// samples/page.mjs, all of them written by tools/sample-frame.mjs.
//
// It builds into build/evaluate/, never into dist/ directly: the writer copies
// the result over and sends every document out through withPolicy( ), the CSP
// every page here is published under.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import { BASE, SITE } from "../../tools/sample-frame.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: HERE,
  srcDir: HERE,
  publicDir: path.join(HERE, "public"),
  outDir: path.join(HERE, "..", "..", "build", "evaluate"),
  cacheDir: path.join(HERE, "..", "..", "build", "evaluate-cache"),
  site: SITE,
  base: `${BASE}evaluate/`,
  trailingSlash: "ignore",
  build: {
    format: "directory",
    assets: "assets",
    // one stylesheet file rather than a <style> per page: it is cached, and
    // the policy's style-src is about inline styles the page does not need
    inlineStylesheets: "never",
  },
  // the build strips the comments itself (tools/html.mjs), after the policy
  // hashes are taken; Astro's own minifier would change the inline scripts
  compressHTML: false,
  devToolbar: { enabled: false },
  markdown: { syntaxHighlight: false },
  // The prerender step runs a bundle Astro writes into outDir, and a bare
  // import in it resolves from this repository's node_modules - where `cookie`
  // is express's 0.7 (through @ui5/cli), not the 2.x Astro brings nested. So
  // Astro's own copy is bundled in rather than looked up.
  // Vite's dependency cache goes beside Astro's, under build/, not into a
  // node_modules/ of its own in this directory.
  vite: { resolve: { noExternal: ["cookie"] }, cacheDir: path.join(HERE, "..", "..", "build", "evaluate-cache", "vite") },
});
