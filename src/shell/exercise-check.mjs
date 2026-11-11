// @ts-check
// A lesson's exercise (abap2UI5/samples, scripts/lib/exercises.json), read and
// decided. Pure: the build reads the file with exercisesFrom( ), the lesson
// bar (learn-path.mjs) decides a Check with checkExercise( ), and
// tests/node/exercise-check.test.mjs holds both.
//
// A check is the conjunction of
//   view       patterns the view XML must match - the XML the abap2UI5 linter
//              rebuilds from the builder chain, what the View tab shows,
//   source     patterns the ABAP of the open files must match,
//   sourceNot  patterns it must no longer match,
//   tests      the least number of unit tests in the last Run, all passing.
// Every pattern is a regular expression matched case-insensitively. Offline
// and deterministic: no app is driven, no button pressed.

const LISTS = ["view", "source", "sourceNot"];

/**
 * The exercises the page knows how to check, by lower-case class name. A
 * broken pattern drops its exercise with a line in the log rather than
 * making a Check throw later.
 * @param {any} json
 * @param {(line: string) => void} [log]
 */
export function exercisesFrom(json, log = () => {}) {
  /** @type {Record<string, { task: string, hint?: string, check: Record<string, any> }>} */
  const out = {};
  for (const [cls, e] of Object.entries(json?.exercises ?? {})) {
    if (typeof e?.task !== "string" || !e.task.trim()) continue;
    /** @type {Record<string, any>} */
    const check = {};
    let broken = false;
    for (const key of LISTS) {
      const list = e.check?.[key];
      if (list === undefined) continue;
      if (!Array.isArray(list) || !list.every((p) => typeof p === "string")) {
        broken = true;
        continue;
      }
      for (const p of list) {
        try {
          new RegExp(p, "i");
        } catch {
          broken = true;
        }
      }
      check[key] = list;
    }
    if (Number.isInteger(e.check?.tests) && e.check.tests > 0) check.tests = e.check.tests;
    if (broken || Object.keys(check).length === 0) {
      log(`samples: the exercise of ${cls} has a check this page cannot decide - left out`);
      continue;
    }
    const hint = typeof e.hint === "string" && e.hint.trim() ? { hint: e.hint.trim() } : {};
    out[cls.toLowerCase()] = { task: e.task.trim(), ...hint, check };
  }
  return out;
}

/**
 * Whether the files as they are now solve the exercise, and if not, what is
 * still missing - in words a learner can act on, not the patterns.
 * @param {Record<string, any>} check
 * @param {{ views: string[], sources: string[], tests: { passed: boolean }[], errors: number }} now
 */
export function checkExercise(check, { views, sources, tests, errors }) {
  /** @type {string[]} */
  const missing = [];
  if (errors > 0) missing.push(`the code has ${errors} error${errors === 1 ? "" : "s"} - fix ${errors === 1 ? "it" : "them"} first`);
  const view = views.join("\n");
  const source = sources.join("\n");
  const hits = (p, text) => new RegExp(p, "i").test(text);
  if ((check.view ?? []).some((p) => !hits(p, view))) missing.push("the view does not show it yet - Run, and look in the View tab");
  if ((check.source ?? []).some((p) => !hits(p, source))) missing.push("the ABAP does not do it yet");
  if ((check.sourceNot ?? []).some((p) => hits(p, source))) missing.push("the old version is still there");
  if (check.tests) {
    const failed = tests.filter((t) => !t.passed).length;
    if (failed > 0) missing.push(`${failed} test${failed === 1 ? "" : "s"} failed`);
    else if (tests.length < check.tests) missing.push(`${tests.length} test${tests.length === 1 ? "" : "s"} ran, ${check.tests} are asked for`);
  }
  return { done: missing.length === 0, missing };
}
