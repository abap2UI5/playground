import { test, expect } from "@playwright/test";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

// How well the AI Studio builds apps - a measurement against a real model,
// not part of `npm test`: without a key this file holds no tests at all.
// tests/ai.spec.js holds the studio's mechanics with the API answered by the
// test; this holds what those cannot - whether the model, with the rules and
// the guide the page gives it, ends on an app that runs clean.
//
//   AI_EVAL_KEY=sk-ant-... npm test -- ai-eval
//
// Optional: AI_EVAL_SPEED (fast, balanced, thorough - the header's select),
// AI_EVAL_ONLY (a task id, or several separated by commas), AI_EVAL_OUT (the
// results file, one JSON line per task; test-results/ai-eval.jsonl by
// default). Every task is a message the reader could type
// (tests/fixtures/ai-eval-tasks.json), optionally with the target system the
// header would be set to, and the texts the running app must show.
//
// Per task the line holds: whether the last run was clean (it started, no
// error or warning), the requests sent (each is one model turn), the tool
// calls, how many of them were runs that stopped or had problems, the
// TODO(system) lines left in the code, the header's token count, and the
// seconds it took. The test fails on a task that did not end clean, so the
// report shows which; the line is written either way. Usage is billed to
// the key - eight tasks at Balanced cost a few dollars.
//
// Compare two lines of the file, not two numbers: a model's answer varies
// from run to run, so a change to the rules is measured over several runs
// of the set (AI_EVAL_OUT names the file each lands in).

const KEY = process.env.AI_EVAL_KEY ?? "";
const SPEED = process.env.AI_EVAL_SPEED ?? "balanced";
const OUT = process.env.AI_EVAL_OUT ?? "test-results/ai-eval.jsonl";
const ONLY = (process.env.AI_EVAL_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// A task gets ten minutes: a model at Thorough that iterates on its run
// reports takes several.
const TASK_TIMEOUT = 10 * 60 * 1000;

const TASKS = KEY
  ? JSON.parse(readFileSync(new URL("./fixtures/ai-eval-tasks.json", import.meta.url), "utf8"))
    .filter((t) => ONLY.length === 0 || ONLY.includes(t.id))
  : [];

// One task after the other: the requests go to one key, and two tasks at
// once measure the rate limit rather than the studio. Not "serial", which
// skips every task after the first that fails - a measurement runs them all.
test.describe.configure({ mode: "default" });

for (const task of TASKS) {
  test(`${task.id}${task.target ? ` (${task.target})` : ""}`, async ({ page }) => {
    test.setTimeout(TASK_TIMEOUT + 3 * 60 * 1000);
    let requests = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().startsWith("https://api.anthropic.com/")) requests += 1;
    });

    await page.goto("/ai/");
    await expect(page.locator("#status")).toHaveText("ready - describe the app you want", { timeout: 120000 });
    await page.locator("#chat-key-input").fill(KEY);
    await page.locator("#chat-key button[type=submit]").click();
    await expect(page.locator("#chat-key")).toBeHidden();
    await page.locator("#chat-speed").selectOption(SPEED);
    if (task.target && (await page.locator("#chat-target").inputValue()) !== task.target) {
      await page.locator("#chat-target").selectOption(task.target);
      await expect(page.locator("#chat-target")).toBeEnabled({ timeout: 120000 });
    }

    const started = Date.now();
    await page.locator("#chat-input").fill(task.prompt);
    await page.locator("#chat-input").press("Enter");
    await expect(page.locator("#chat")).toHaveClass(/is-busy/);
    await expect(page.locator("#chat")).not.toHaveClass(/is-busy/, { timeout: TASK_TIMEOUT });
    const seconds = Math.round((Date.now() - started) / 1000);

    const rows = await page.locator(".chat-tool").allTextContents();
    const runs = rows.filter((r) => /^(ran: |run stopped: )/.test(r.trim()));
    const last = runs.at(-1)?.trim() ?? "";
    const clean = last.startsWith("ran: ") && !/\bproblems?\b/.test(last);
    const files = await page.evaluate(() =>
      window.monaco.editor.getModels().map((m) => ({ name: m.uri.path.slice(1), source: m.getValue() })));
    const todos = files.reduce((n, f) => n + (f.source.match(/"\s*todo\(system\):/gi) ?? []).length, 0);
    const shows = [];
    for (const text of task.expect ?? []) {
      shows.push({ text, seen: await page.frameLocator("#app").getByText(text).first().isVisible().catch(() => false) });
    }
    const errors = await page.locator(".chat-notice.is-error").allTextContents();

    const result = {
      task: task.id,
      target: task.target ?? "v750",
      speed: SPEED,
      clean,
      last,
      requests,
      tools: rows.length,
      runs: runs.length,
      failedRuns: runs.filter((r) => !/^ran: /.test(r.trim()) || /\bproblems?\b/.test(r)).length,
      todos,
      shows,
      errors,
      usage: (await page.locator("#chat-usage").textContent())?.trim() ?? "",
      seconds,
      at: new Date().toISOString(),
    };
    mkdirSync(dirname(OUT), { recursive: true });
    appendFileSync(OUT, `${JSON.stringify(result)}\n`);
    console.log(`${task.id}: ${clean ? "clean" : "NOT clean"} - ${requests} turns, ${rows.length} tools, ${result.usage}, ${seconds}s`);

    expect(errors, "the chat said an error").toEqual([]);
    expect(clean, `the last run: ${last || "none"}`).toBe(true);
    for (const s of shows) expect(s.seen, `the app shows "${s.text}"`).toBe(true);
  });
}
