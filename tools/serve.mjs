#!/usr/bin/env node
// Static file server for dist/ - used by the Playwright tests and for local
// development. GitHub Pages serves the same tree, so anything that needs a
// server header to work would work here and break there; this deliberately
// sets nothing beyond content types.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".abap": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".properties": "text/plain; charset=utf-8",
};

// GitHub Pages serves a project site under /<repo>/, never at the root, so the
// same tree is mounted twice here: at / for convenience and under a prefix so
// the tests can prove that nothing in the page assumes it is at the root.
const SUBPATH = "/under-a-subpath";

const server = http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    // A malformed percent-sequence would otherwise throw out of the request
    // listener and take the whole server down - mid-test-run, with every
    // failure after it pointing at a connection instead of at this line.
    res.writeHead(400).end("bad request");
    return;
  }
  if (url === SUBPATH) {
    res.writeHead(301, { location: `${SUBPATH}/` }).end();
    return;
  }
  if (url.startsWith(`${SUBPATH}/`)) url = url.slice(SUBPATH.length);
  // Resolve inside ROOT - a request may not escape dist/ via ../
  let file = path.join(ROOT, path.normalize(url).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  } catch {
    res.writeHead(404).end("not found");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`serving dist/ on http://localhost:${PORT}`));
