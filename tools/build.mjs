#!/usr/bin/env node
// The build, arranged the way the steps actually depend on one another.
//
// There are four: fetch the pinned sources, build the framework, build the UI5
// frontend, assemble the site. The middle two are the slow ones - a downport of
// nine hundred ABAP files that takes about three minutes, and a UI5 build that
// takes about two - and they have nothing whatever to do with each other. They
// read different sources, they write to different places (build/downport and
// dist/runtime for one, build/ui5dist and dist/app for the other), and neither
// reads a line of what the other produced. Only build-site does, which is why
// it goes last and on its own.
//
// So the two of them run together and a cold build costs the longer of them
// rather than the sum of both. With the caches warm this changes nothing -
// both return at once, having done nothing - but on a fresh clone, and in the
// CI job whose cache missed, it is the difference between about five minutes
// and about three.
//
// Their output is streamed with the step's name in front of every line rather
// than collected and printed at the end. Two silent processes for three minutes
// is indistinguishable from two hung ones, and the whole reason anybody watches
// a build this long is to see that it is still moving.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const STEPS = {
  deps: "tools/fetch-deps.mjs",
  framework: "tools/build-framework.mjs",
  ui5: "tools/build-ui5.mjs",
  site: "tools/build-site.mjs",
  catalogue: "tools/build-catalogue.mjs",
};

// `label` is what turns a step's output into something readable next to another
// step's. A step running on its own writes straight through instead, so what it
// prints is exactly what it prints when it is run by name.
function run(name, label = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, STEPS[name])], {
      cwd: ROOT,
      stdio: label ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (label) {
      tag(child.stdout, name, process.stdout);
      tag(child.stderr, name, process.stderr);
    }
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${name} failed (exit ${code})`)),
    );
  });
}

// A chunk off a pipe is not a line - it can end in the middle of one - so the
// remainder is carried to the next chunk rather than printed with a prefix in
// the middle of it.
function tag(stream, name, out) {
  let rest = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop();
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  });
  stream.on("end", () => {
    if (rest !== "") out.write(`[${name}] ${rest}\n`);
  });
}

try {
  await run("deps");

  // Settled rather than raced: if one of them fails, the other is still a live
  // process writing into dist/, and walking away from it would leave the tree
  // half built by something nobody is watching any more.
  const both = await Promise.allSettled([run("framework", true), run("ui5", true)]);
  const failed = both.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    for (const f of failed) console.error(`build: ${f.reason.message}`);
    process.exit(1);
  }

  // The sample catalogue's index, before the site that copies its page in.
  // It is the one step that talks to the network at build time and the one
  // whose failure is survivable by design: no catalogue means a page that says
  // so, not a broken build (tools/build-catalogue.mjs says why at length).
  await run("catalogue");
  await run("site");
} catch (e) {
  console.error(`build: ${e.message}`);
  process.exit(1);
}
