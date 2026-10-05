#!/usr/bin/env node
/*
 * vendor-agent - copies the agent-snapshot code of abap2UI5/mcp-server into
 * the playground, where the AI Pilot (src/shell/pilot.mjs) runs it: the three
 * pure modules behind that server's app_start / app_describe / app_act tools.
 *
 *   lib/viewxml.mjs   -> src/vendor/agent/viewxml.mjs
 *   lib/snapshot.mjs  -> src/vendor/agent/snapshot.mjs
 *   lib/appclient.mjs -> src/vendor/agent/appclient.mjs
 *
 * Copied, not depended on, and copied UNCHANGED, the way the VS Code
 * extension and cap2UI5 carry the same three files: the agent snapshot is a
 * contract (docs/agent-snapshot.md upstream) every implementation describes a
 * screen by, and a second implementation here is how they would drift. A
 * change goes upstream first and is vendored again.
 *
 *   node tools/vendor-agent.mjs /path/to/mcp-server [--ref <rev>]   copy, record
 *   node tools/vendor-agent.mjs --check                             the copies
 *        still hash to src/vendor/agent/source.json (offline; tests/pilot.spec.js
 *        runs the same check)
 *
 * A checkout is read through `git show <commit>:<path>`, so its working tree
 * does not matter - only that it has the commit.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "abap2UI5/mcp-server";
const VENDOR_DIR = "src/vendor/agent";
const RECORD = `${VENDOR_DIR}/source.json`;
const MODULES = {
  "lib/viewxml.mjs": `${VENDOR_DIR}/viewxml.mjs`,
  "lib/snapshot.mjs": `${VENDOR_DIR}/snapshot.mjs`,
  "lib/appclient.mjs": `${VENDOR_DIR}/appclient.mjs`,
};

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const header = (from, commit) =>
  "/*\n" +
  ` * VENDORED - do not edit. ${REPO} ${from}\n` +
  ` * at commit ${commit}, copied unchanged by tools/vendor-agent.mjs.\n` +
  " * Change it upstream, then vendor it again.\n" +
  " */\n";

function check() {
  const record = JSON.parse(fs.readFileSync(path.join(ROOT, RECORD), "utf8"));
  const drifted = Object.entries(record.files).filter(
    ([to, { sha256: want }]) => sha256(fs.readFileSync(path.join(ROOT, to), "utf8")) !== want,
  );
  if (drifted.length > 0) {
    console.error(`vendor-agent: ${drifted.map(([to]) => to).join(", ")} no longer match ${RECORD} - edited by hand?`);
    process.exit(1);
  }
  console.log(`vendor-agent: ${Object.keys(record.files).length} copies match ${REPO}@${record.commit.slice(0, 12)}`);
}

function vendor(checkout, ref) {
  const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  const commit = git("rev-parse", `${ref}^{commit}`).trim();
  const files = {};
  for (const [from, to] of Object.entries(MODULES)) {
    const text = header(from, commit) + git("show", `${commit}:${from}`).replace(/\r\n/g, "\n");
    fs.mkdirSync(path.dirname(path.join(ROOT, to)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, to), text);
    files[to] = { from, sha256: sha256(text) };
  }
  const record = {
    note: "What tools/vendor-agent.mjs copied from abap2UI5/mcp-server, at which commit, and the sha256 of every file it wrote. Generated - do not edit.",
    repository: REPO,
    commit,
    files,
  };
  fs.writeFileSync(path.join(ROOT, RECORD), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`vendor-agent: ${Object.keys(files).length} modules from ${REPO}@${commit.slice(0, 12)}`);
}

const args = process.argv.slice(2);
if (args.includes("--check")) {
  check();
} else {
  const checkout = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--ref");
  const at = args.indexOf("--ref");
  if (!checkout) {
    console.error("usage: node tools/vendor-agent.mjs /path/to/mcp-server [--ref <rev>] | --check");
    process.exit(2);
  }
  vendor(path.resolve(checkout), at === -1 ? "HEAD" : args[at + 1]);
}
