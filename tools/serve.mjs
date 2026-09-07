#!/usr/bin/env node
// Static file server for dist/ - used by the Playwright tests and for local
// development. GitHub Pages serves the same tree, so anything that needs a
// server header to work would work here and break there; this deliberately
// sets nothing beyond content types.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE } from "./sample-pages.mjs";

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

// ...and once more under the path the site is actually published at, which
// `SITE` names. One page IS tied to it - 404.html is served for any address
// under the deployment, at any depth, so it is the one page here that links
// absolutely - and at the root mount every link on it would point nowhere.
const SITE_PATH = new URL(SITE).pathname;

// ...with ONE exception, and it is not a header: GitHub Pages answers anything
// it cannot find under a project site with that site's own 404.html, at status
// 404. Without the same answer here the page would exist in dist/ and be
// unreachable in every local run and every test - which is how a 404 page
// quietly stops working.
const notFound = (res) => {
  const page = path.join(ROOT, "404.html");
  if (fs.existsSync(page)) {
    res.writeHead(404, { "content-type": TYPES[".html"] }).end(fs.readFileSync(page));
    return;
  }
  res.writeHead(404).end("not found");
};

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
  if (url === SITE_PATH.replace(/\/$/, "") && SITE_PATH !== "/") {
    res.writeHead(301, { location: SITE_PATH }).end();
    return;
  }
  if (url.startsWith(`${SUBPATH}/`)) url = url.slice(SUBPATH.length);
  else if (SITE_PATH !== "/" && url.startsWith(SITE_PATH)) url = url.slice(SITE_PATH.length - 1);
  // Resolve inside ROOT - a request may not escape dist/ via ../
  let file = path.join(ROOT, path.normalize(url).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  } catch {
    notFound(res);
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      notFound(res);
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`serving dist/ on http://localhost:${PORT}`));
