#!/usr/bin/env node
// Assembles dist/ - the static site that GitHub Pages serves.
//
// Everything here is a file copy or an esbuild bundle; nothing is fetched at
// page load except the UI5 core from the CDN. The framework bundle is built
// separately by tools/build-framework.mjs (it is the slow half) and is
// expected to be present under dist/runtime/ when this script runs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

fs.mkdirSync(DIST, { recursive: true });

// Placeholder shell - replaced by the real playground in a later phase. It
// exists from the first commit on so the Pages deployment has something to
// publish and the deploy path is never the thing that is untested.
const index = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>abap2UI5 Playground</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 40rem; padding: 0 1rem; }
  code { background: #f0f0f0; padding: .1rem .3rem; border-radius: 3px; }
</style>
</head>
<body>
<h1>abap2UI5 Playground</h1>
<p>Under construction. See <code>PLAYGROUND_PLAN.md</code> in the repository.</p>
</body>
</html>
`;
fs.writeFileSync(path.join(DIST, "index.html"), index);

console.log("build-site: wrote dist/index.html");
