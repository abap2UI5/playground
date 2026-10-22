// The AI Studio's measurement as a markdown table - what ai-eval.yml writes
// into the job summary from the lines tests/ai-eval.spec.js appended, one per
// task. Fails when a task of the set has no line: then the measurement broke
// (the page did not boot, the key was refused), which is not the same as a
// model that did badly.
//
//   node tools/ai-eval-summary.mjs test-results/ai-eval.jsonl
import { existsSync, readFileSync } from "node:fs";

const file = process.argv[2] ?? "test-results/ai-eval.jsonl";
const only = (process.env.AI_EVAL_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const tasks = JSON.parse(readFileSync(new URL("../tests/fixtures/ai-eval-tasks.json", import.meta.url), "utf8"))
  .filter((t) => only.length === 0 || only.includes(t.id));
const lines = existsSync(file)
  ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];

const cell = (s) => String(s).replace(/\|/g, "\\|");
const out = [];
const clean = lines.filter((l) => l.clean).length;
out.push(`### AI Studio: ${clean} of ${lines.length} tasks ended clean${lines[0] ? ` (${lines[0].speed})` : ""}`, "");
out.push("| task | target | clean | turns | tools | failed runs | TODO(system) | usage | seconds | last run |");
out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const l of lines) {
  out.push(`| ${cell(l.task)} | ${cell(l.target)} | ${l.clean ? "yes" : "**no**"} | ${l.requests} | ${l.tools} | ${l.failedRuns} | ${l.todos} | ${cell(l.usage)} | ${l.seconds} | ${cell(l.last || "none")} |`);
}
const missing = tasks.filter((t) => !lines.some((l) => l.task === t.id)).map((t) => t.id);
if (missing.length) out.push("", `**No result for:** ${missing.join(", ")} - the measurement broke there; see the Playwright report.`);
console.log(out.join("\n"));
if (missing.length) process.exitCode = 1;
