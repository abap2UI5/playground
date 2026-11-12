// @ts-check
// HANDOVER.md - the record that goes into the AI App Builder's download
// beside the class (src/shell/chat.mjs), so the developer who imports it
// reads it like a pull request from a colleague: what was asked for, what
// came out, which checks ran and what they said, what was tried in the
// running app, and what is left to connect on the real system.
//
// docs/concepts/ai-package.md in abap2UI5/abap2UI5 asks for exactly this
// ("Hand over - the class, its test class and a short record"), and for one
// thing above all: "checked" means the checks named here ran and found
// nothing, never "correct". The record says which ran, at which release,
// and what this page could not check at all.
//
// Pure - no DOM, no page state - so tests/node can hold it.

/**
 * @typedef {{ file: string, line: number, text: string }} Todo
 * @typedef {{ severity: number, source?: string, rule?: string, message: string, file: string, range?: { start: { line: number } } }} Problem
 * @typedef {{ testclass: string, method: string, passed: boolean, message?: string }} TestResult
 */

const kindOf = (/** @type {Problem} */ p) => (p.severity === 1 ? "error" : p.severity === 2 ? "warning" : "hint");
const lineOf = (/** @type {Problem} */ p) => (p.range?.start ? p.range.start.line + 1 : "?");
const esc = (/** @type {string} */ t) => String(t).replace(/\r?\n/g, " ").trim();

/**
 * The record, as markdown. `app` is the app class; `files` what the zip
 * carries; `requests` the reader's messages in order; `release` the ABAP
 * release abaplint checked against, as the header names it; `ui5` the floor
 * the abap2UI5 linter checked against; `status` the last run's status line;
 * `problems` abaplint's and the linter's findings as they are now; `tests`
 * the last run's unit tests; `tried` what was done in the running app (the
 * act rows); `todos` the TODO(system) lines and unmarked CALL FUNCTIONs;
 * `model` which model built it.
 *
 * @param {{
 *   app: string, files: { name: string }[], requests: string[], release: string, ui5: string,
 *   status: string, problems: Problem[], tests: TestResult[], tried: string[], todos: Todo[],
 *   model?: string, date?: Date,
 * }} input
 * @returns {string}
 */
export function handoverMarkdown(input) {
  const { app, files, requests, release, ui5, status, problems, tests, tried, todos, model, date = new Date() } = input;
  const out = [];
  out.push(`# Handover: ${app}`, "");
  out.push(
    `Built in the abap2UI5 AI App Builder${model ? ` with ${model}` : ""} on ${date.toISOString().slice(0, 10)}. ` +
      "Nothing of it has been imported into a system - that, the activation and the transport are yours. " +
      "Read it like a pull request from a colleague.",
    "",
  );

  out.push("## What was asked for", "");
  if (requests.length === 0) out.push("_(no message - the files were written by hand)_");
  for (const r of requests) out.push(`> ${esc(r)}`, "");
  if (requests.length) out.pop();
  out.push("");

  out.push("## What is in it", "");
  for (const f of files) out.push(`- \`${f.name}\``);
  out.push("");

  out.push("## Checks that ran", "");
  out.push(`The last run: **${esc(status)}**.`, "");
  const errors = problems.filter((p) => p.severity === 1);
  const warnings = problems.filter((p) => p.severity === 2);
  const hints = problems.filter((p) => p.severity !== 1 && p.severity !== 2);
  const by = (/** @type {string} */ source) => problems.filter((p) => (p.source ?? "").startsWith(source));
  out.push(`| Check | Against | Errors | Warnings | Hints |`, `| --- | --- | --- | --- | --- |`);
  for (const [name, source, against] of [["abaplint (syntax)", "abaplint", release], ["abap2UI5 linter (view, lifecycle)", "abap2UI5", `UI5 ${ui5}`]]) {
    const own = by(source);
    out.push(`| ${name} | ${against} | ${own.filter((p) => p.severity === 1).length} | ${own.filter((p) => p.severity === 2).length} | ${own.filter((p) => p.severity !== 1 && p.severity !== 2).length} |`);
  }
  out.push("");
  if (errors.length + warnings.length > 0) {
    out.push("Still open:", "");
    for (const p of [...errors, ...warnings].slice(0, 40)) {
      out.push(`- ${p.file}:${lineOf(p)} - ${kindOf(p)}${p.rule ? ` \`${p.rule}\`` : ""}: ${esc(p.message)}`);
    }
    out.push("");
  }
  if (hints.length > 0) out.push(`${hints.length} hint${hints.length === 1 ? "" : "s"} (advice, not checked off) - open the class in the playground to see them.`, "");

  out.push("## Unit tests", "");
  if (tests.length === 0) {
    out.push("None ran. A view with no logic of its own needs none; anything that computes, validates or filters should have one before it goes to production.");
  } else {
    const failed = tests.filter((t) => !t.passed);
    out.push(`${tests.length - failed.length} of ${tests.length} passed in the last run.`);
    for (const t of failed) out.push(`- FAILED \`${t.testclass}->${t.method}\`: ${esc(t.message ?? "")}`);
  }
  out.push("");

  out.push("## Tried in the running app", "");
  if (tried.length === 0) out.push("Nothing was typed or pressed in the app - it started, nobody tried its main path here.");
  for (const t of tried) out.push(`- ${esc(t)}`);
  out.push("");

  out.push("## Left to connect on your system", "");
  if (todos.length === 0) {
    out.push("Nothing is marked. What stands in for SAP data or objects would carry a `\" TODO(system):` comment.");
  } else {
    for (const t of todos) out.push(`- ${t.file}:${t.line} - ${esc(t.text || "(no note)")}`);
  }
  out.push("");

  out.push("## What this does not say", "");
  out.push(
    "- It ran in a browser: abaplint's check, the transpiled ABAP and the real abap2UI5 framework on an in-memory " +
      "database, OpenUI5. It does not know your system's tables, function modules, authorisations or SAPUI5-only controls.",
    "- abaplint at a release checks the language, not whether an SAP object is released or exists on your system.",
    "- No ATC, no code inspector, no performance check - those run on your system, as for any class.",
    "",
  );
  return out.join("\n");
}
