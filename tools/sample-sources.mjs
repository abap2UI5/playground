// The ABAP itself, for the pages that print it.
//
// A sample page that describes a class and does not show it sends its reader
// to GitHub to find out what the sample actually does - and sends a search
// engine nothing but a description. The class IS the sample, so the class is
// on the page (tools/sample-pages.mjs prints it, tools/abap-highlight.mjs
// colours it), and this is where it comes from.
//
// ONE TARBALL PER REF, not one request per class. The index names 770 samples
// in three repositories, and 770 requests to raw.githubusercontent.com on
// every deploy is a way of being rate-limited rather than a way of building a
// site. codeload serves the whole tree of a ref in one response, so the fetch
// is a dozen requests - main for each repository, plus the branch each
// samples-stack sample is delivered on - and the ones already on disk are not
// re-fetched at all.
//
// SURVIVABLE, per ref, like every other network step in this build
// (tools/build-catalogue.mjs): a tarball that does not arrive costs the code
// block on the pages of that ref and nothing else. The pages are still
// written, still carry every fact the catalogue knows, and still link to the
// class on GitHub. A build with no network at all is still a build.
//
// The tar reader below is forty lines rather than a dependency, which is the
// same trade src/shell/zip.mjs makes for the abapGit export. It reads the one
// shape it is given - ustar, as git writes it - and skips everything that is
// not a regular file.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "build", "sources");
const DAY = 24 * 60 * 60 * 1000;

const log = (m) => console.log(`build-catalogue: ${m}`);

/* Where a row's ABAP lives, out of the raw URL the catalogue built. Nothing
 * else is trusted: the repository, the ref and the path all have to look like
 * what tools/build-catalogue.mjs writes, or this row simply has no source. */
const RAW = /^https:\/\/raw\.githubusercontent\.com\/([\w.-]+\/[\w.-]+)\/([\w.-]+)\/([\w./-]+\.clas\.abap)$/;

const text = (block, from, length) => {
  const end = block.indexOf(0, from);
  return block.toString("utf8", from, end === -1 || end > from + length ? from + length : end);
};

/** The regular files in an uncompressed tar, in the order they stand in it. */
function* files(tar) {
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header[0] === 0) break; // the two zero blocks that end an archive
    const name = text(header, 0, 100);
    const prefix = text(header, 345, 155);
    const size = parseInt(text(header, 124, 12).trim(), 8) || 0;
    const type = String.fromCharCode(header[156]);
    at += 512;
    if (type === "0" || type === "\0") {
      yield { name: prefix ? `${prefix}/${name}` : name, body: tar.subarray(at, at + size) };
    }
    at += Math.ceil(size / 512) * 512;
  }
}

/* One ref's tree, cached on disk for a day. The cache is for the rebuilds
 * somebody does while working on these pages, not for CI - a fresh runner has
 * no build/ at all, so a deploy always fetches. `--fresh` forces it here too,
 * the same flag the catalogue fetch reads. */
async function tarball(repo, ref) {
  const cached = path.join(CACHE, `${repo.replace("/", "-")}-${ref}.tar.gz`);
  const fresh = process.argv.includes("--fresh");
  if (!fresh && fs.existsSync(cached) && Date.now() - fs.statSync(cached).mtimeMs < DAY) {
    return fs.readFileSync(cached);
  }
  try {
    const response = await fetch(`https://codeload.github.com/${repo}/tar.gz/${ref}`, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(cached, body);
    return body;
  } catch (err) {
    /* A stale copy beats no code at all - the same trade the catalogue fetch
     * makes, and for the same reason: the page would rather be a day old than
     * be missing the thing it is about. */
    if (fs.existsSync(cached)) {
      log(`${repo}@${ref}: ${err.message} - using the tarball already on disk`);
      return fs.readFileSync(cached);
    }
    log(`${repo}@${ref}: ${err.message} - its samples are listed without their ABAP`);
    return undefined;
  }
}

/**
 * The ABAP of every row that has a usable raw URL, keyed by that URL.
 * A row this cannot resolve is simply not in the map, and its page prints
 * everything else it knows.
 */
export async function fetchSampleSources(rows) {
  /* Grouped by the ref the code is on: one tarball answers every row that
   * shares one, and samples-stack delivers each of its samples on a branch of
   * its own. */
  const refs = new Map();
  for (const row of rows) {
    const parts = RAW.exec(String(row.raw ?? ""));
    if (parts === null) continue;
    const [, repo, ref, file] = parts;
    const key = `${repo} ${ref}`;
    if (!refs.has(key)) refs.set(key, { repo, ref, wanted: new Map() });
    refs.get(key).wanted.set(file, row.raw);
  }

  const sources = new Map();
  /* In sequence rather than at once: a dozen refs is not worth the parallelism
   * and codeload is somebody else's server. The largest of them is one
   * response of a few megabytes. */
  for (const { repo, ref, wanted } of refs.values()) {
    const gz = await tarball(repo, ref);
    if (gz === undefined) continue;
    let tar;
    try {
      tar = zlib.gunzipSync(gz);
    } catch (err) {
      log(`${repo}@${ref}: the tarball did not decompress (${err.message}) - listed without their ABAP`);
      continue;
    }
    let found = 0;
    for (const file of files(tar)) {
      // codeload wraps the tree in one directory named for the repo and the ref.
      const at = file.name.indexOf("/");
      const inRepo = at === -1 ? file.name : file.name.slice(at + 1);
      const url = wanted.get(inRepo);
      if (url === undefined) continue;
      sources.set(url, file.body.toString("utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n"));
      found += 1;
    }
    log(`${repo}@${ref}: ${found}/${wanted.size} classes read out of the tarball`);
  }
  return sources;
}
