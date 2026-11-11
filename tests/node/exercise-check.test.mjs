// A lesson's exercise (src/shell/exercise-check.mjs): what the build keeps of
// abap2UI5/samples' exercises.json, and how a Check decides.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkExercise, exercisesFrom } from "../../src/shell/exercise-check.mjs";

test("the build keeps what it can check, by lower-case class, and drops a broken pattern", () => {
  const said = [];
  const kept = exercisesFrom({
    exercises: {
      Z2UI5_CL_A: { task: " Do it. ", hint: "Like this.", check: { view: ["<Button"], tests: 2 } },
      z2ui5_cl_b: { task: "Do it.", check: { source: ["(unclosed"] } },
      z2ui5_cl_c: { task: "Do it.", check: {} },
      z2ui5_cl_d: { check: { view: ["x"] } },
    },
  }, (line) => said.push(line));
  assert.deepEqual(kept, { z2ui5_cl_a: { task: "Do it.", hint: "Like this.", check: { view: ["<Button"], tests: 2 } } });
  assert.equal(said.length, 2);
  assert.deepEqual(exercisesFrom(undefined), {});
});

const NOW = { views: ['<Page><Button text="Clear"/></Page>'], sources: ["IF client->check_on_event( `CLEAR` ). CLEAR t_log."], tests: [], errors: 0 };

test("every condition met is done", () => {
  const check = { view: ['<Button\\b[^>]*text="clear"'], source: ["check_on_event\\(\\s*`CLEAR`", "clear\\s+t_log"] };
  assert.deepEqual(checkExercise(check, NOW), { done: true, missing: [] });
});

test("what is missing is said in words, one line per kind", () => {
  const check = { view: ["<Input"], source: ["message_toast_display"], sourceNot: ["CLEAR t_log"], tests: 3 };
  const { done, missing } = checkExercise(check, { ...NOW, tests: [{ passed: true }], errors: 2 });
  assert.equal(done, false);
  assert.deepEqual(missing, [
    "the code has 2 errors - fix them first",
    "the view does not show it yet - Run, and look in the View tab",
    "the ABAP does not do it yet",
    "the old version is still there",
    "1 test ran, 3 are asked for",
  ]);
  assert.deepEqual(checkExercise({ tests: 1 }, { ...NOW, tests: [{ passed: false }, { passed: true }] }).missing, ["1 test failed"]);
});
