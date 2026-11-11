// @ts-check
// Guided first steps, for somebody who has never seen the page before: the
// hint strip over the editor (first-steps.mjs) and the lesson bar over it
// (learn-path.mjs). This module decides whether either is wanted and asks
// for its chunk; neither travels in the shell, which is budgeted
// (docs/design/load-time.md), and both are asked for after the first run,
// so nothing a visitor waits for at boot waits on them.
//
// What the two chunks need of the page - the editor, the panel, storage, the
// carried samples - is HANDED to them from here rather than imported there.
// esbuild gives every set of entry points that reaches a module a chunk of
// its own, so a chunk importing insight.mjs or editor.mjs moved those out of
// assets/shell.mjs into new shared chunks: more requests at boot, and a
// budget for the shell that measured less than the shell.
//
// Only on the playground proper. An embedded playground is somebody else's
// demo and `?view=app`/`full` is an app with no editor to point at
// (docs/design/public-surfaces.md); the AI Studio and the Pilot have rooms
// of their own. keepsDrafts already says "none of the three"; app-only is
// said here because that view keeps the draft rules of the playground.
import { currentFile, focusProblem, getFiles, getSource, lintViewsFor, refreshNow } from "../editor/editor.mjs";
import { SAMPLES } from "../editor/samples.mjs";
import { showInsight } from "./insight.mjs";
import { lastTests, runWhenFree } from "./run.mjs";
import { readStored, removeStored, writeStored } from "./storage.mjs";
import { appOnly, cameFromCatalogue, keepsDrafts } from "./page.mjs";

/** The lessons whose exercise was solved, as a JSON list of class names. */
export const SOLVED_KEY = "abap2ui5-playground:lessons-solved";

// What a lesson's Check decides on (learn-path.mjs, checkExercise( )): the
// code is Run first - that is what makes the tests run and the views current -
// then the views the linter rebuilt, the ABAP and the Run's tests are read.
async function exerciseNow() {
  await runWhenFree();
  const problems = await refreshNow();
  const files = getFiles();
  return {
    views: files.flatMap((f) => lintViewsFor(f.name).docs),
    sources: files.map((f) => f.source),
    tests: lastTests(),
    errors: problems.filter((p) => p.severity === 1 && p.source === "abaplint").length,
  };
}

/** Set once the strip has been closed; never cleared by the page. */
export const FIRST_STEPS_KEY = "abap2ui5-playground:first-steps";

/** @type {{ reflectLesson: () => void } | null} */
let lessons = null;

/**
 * @param {{ from: string, failure?: unknown, declined?: unknown }} starting what boot( ) opened on
 * @param {{ openSample: (id: string) => unknown, openLinked: (url: string) => unknown, openSamples: () => unknown }} open
 */
export function startGuides(starting, open) {
  if (!keepsDrafts || appOnly) return;
  import("./learn-path.mjs")
    .then((m) => {
      lessons = m;
      m.setUpLearnPath({
        ...open,
        getFiles,
        samples: SAMPLES,
        exercise: exerciseNow,
        readSolved: () => readStored(SOLVED_KEY),
        // Forgotten when empty, like every stored setting.
        writeSolved: (text) => (text === null ? removeStored(SOLVED_KEY) : writeStored(SOLVED_KEY, text)),
      });
    })
    .catch(() => {});
  // The strip is for a FIRST visit, and only the default sample is one: a
  // link (shared, ?src=, a gist, a row of the catalogue) was sent by somebody
  // with something particular to show, a stored draft says the reader has
  // been here before, and a link that failed is still somebody's link.
  const firstVisit = starting.from === "sample" && !starting.failure && !starting.declined && !cameFromCatalogue;
  if (!firstVisit || readStored(FIRST_STEPS_KEY) !== null) return;
  import("./first-steps.mjs")
    .then((m) =>
      m.showFirstSteps({
        openSamples: open.openSamples,
        showView: () => showInsight("view"),
        // The caret in the app's code, on the given line.
        focusLine: (line) => focusProblem(currentFile(), line, 1),
        source: () => getSource(currentFile()) ?? "",
        close: () => writeStored(FIRST_STEPS_KEY, "closed"),
      }),
    )
    .catch(() => {});
}

/** The files changed: the lesson bar follows the app that is now first. */
export const lessonChanged = () => lessons?.reflectLesson();
