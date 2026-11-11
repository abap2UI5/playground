// "Lesson n of m", with the lesson before and after it a click away, while
// the app in the editor is one of abap2UI5/samples' "Start here" - the
// learning path's first stage, which that repository reads in order
// (writeLessons( ) in tools/build-site.mjs says why only that stage). A
// chunk, asked for by guides.mjs after the first run, on the playground
// proper only.
//
// Which lesson it is comes from the app - the first file - and nothing else:
// a lesson opened from the samples browser, from the catalogue, from a link or
// with these buttons is the same lesson, and so is one somebody has started
// changing. Any other app and the bar is gone.
//
// A neighbour opens exactly the way the samples browser opens it: the copy the
// page carries where there is one (loadSample( ) in file-sets.mjs), the class
// in abap2UI5/samples over `?src=` where there is not (loadLinked( )) - so the
// draft it replaces is kept and said the same way, and it runs.
//
// The bar sits over the right-hand end of the file strip, hung off a
// zero-height anchor below it, and the strip makes room with padding of its
// own - so it appearing or going never moves the editor. What it needs of
// the page is handed in by guides.mjs, which says why.
//
// A lesson with an exercise (abap2UI5/samples, scripts/lib/exercises.json,
// carried in lessons.json by the build) adds a Task button to the bar: a card
// under it with the task, a Hint and a Check. Check runs the code and decides
// offline (checkExercise( ) in exercise-check.mjs) - the view the linter
// rebuilt, the ABAP, the unit tests of that Run. A solved lesson is marked in
// the bar and remembered (handed-in storage, never on an embed: guides.mjs
// does not start on one). The card opens by itself once per lesson and visit
// when the reader moves to an unsolved lesson (not on the one the page opened on), and hangs over the editor like the bar does -
// it never moves the code.
import PATH from "../../build/samples/lessons.json";
import { checkExercise } from "./exercise-check.mjs";

const LESSONS = PATH.lessons;
const fileOf = (lesson) => `${lesson.class}.clas.abap`;

let anchor;
let label;
let previous;
let next;
let at = -1;
let filesNow = () => [];
let taskButton;
let card;
let exerciseNow = async () => ({ views: [], sources: [], tests: [], errors: 0 });
let solved = new Set();
let keepSolved = () => {};
// The lessons whose card was shown or closed in this visit: it opens by
// itself once, and a reader who closed it is not asked again. Not for the
// lesson the page opened on: there the first-steps strip is the guide, and a
// card over the code before anything was asked for is one thing too many -
// the Task button in the bar says the lesson has one.
const offered = new Set();
let opening = true;

export function setUpLearnPath({ openSample, openLinked, getFiles, samples, exercise, readSolved, writeSolved }) {
  const files = document.getElementById("files");
  if (LESSONS.length < 2 || !files || anchor) return;
  filesNow = getFiles;
  if (exercise) exerciseNow = exercise;
  solved = new Set(validSolved(readSolved?.()));
  keepSolved = () => writeSolved?.(solved.size ? JSON.stringify([...solved]) : null);

  const open = (lesson) => {
    if (!lesson) return;
    const carried = samples.find((s) => s.files[0] === fileOf(lesson));
    if (carried) openSample(carried.id);
    else openLinked(lesson.raw);
  };

  anchor = document.createElement("div");
  anchor.className = "lesson-anchor";
  anchor.hidden = true;
  const bar = document.createElement("nav");
  bar.className = "lesson";
  bar.setAttribute("aria-label", `Learning path: ${PATH.stage}`);
  const button = (glyph, step) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghost lesson-step";
    b.textContent = glyph;
    b.addEventListener("click", () => open(LESSONS[at + step]));
    return b;
  };
  previous = button("‹", -1);
  next = button("›", 1);
  label = document.createElement("span");
  label.className = "lesson-label";
  taskButton = document.createElement("button");
  taskButton.type = "button";
  taskButton.className = "ghost lesson-task";
  taskButton.setAttribute("aria-expanded", "false");
  taskButton.addEventListener("click", () => showCard(card.hidden));
  card = buildCard();
  bar.append(previous, label, next, taskButton);
  anchor.append(bar, card);
  files.after(anchor);
  reflectLesson();
  opening = false;
}

// Only class names of the lessons there are: a stored list is read like a
// typed one, and anything else in it is dropped.
function validSolved(text) {
  try {
    const list = JSON.parse(String(text ?? "[]"));
    return Array.isArray(list) ? list.filter((c) => LESSONS.some((l) => l.class === c)) : [];
  } catch {
    return [];
  }
}

let taskText;
let hintText;
let hintButton;
let checkButton;
let verdict;

function buildCard() {
  const box = document.createElement("section");
  box.className = "lesson-card";
  box.id = "lesson-card";
  box.hidden = true;
  box.setAttribute("aria-label", "This lesson's task");
  taskButton.setAttribute("aria-controls", box.id);
  const head = document.createElement("div");
  head.className = "lesson-card-head";
  const title = document.createElement("strong");
  title.textContent = "Your task";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ghost lesson-card-close";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close the task");
  close.addEventListener("click", () => showCard(false));
  head.append(title, close);
  taskText = document.createElement("p");
  taskText.className = "lesson-card-task";
  hintText = document.createElement("p");
  hintText.className = "lesson-card-hint";
  hintText.hidden = true;
  const row = document.createElement("div");
  row.className = "lesson-card-row";
  checkButton = document.createElement("button");
  checkButton.type = "button";
  checkButton.className = "primary";
  checkButton.textContent = "Check";
  checkButton.title = "Run the code and see whether the task is done";
  checkButton.addEventListener("click", check);
  hintButton = document.createElement("button");
  hintButton.type = "button";
  hintButton.textContent = "Hint";
  hintButton.addEventListener("click", () => {
    hintText.hidden = false;
    hintButton.hidden = true;
  });
  row.append(checkButton, hintButton);
  verdict = document.createElement("p");
  verdict.className = "lesson-card-verdict";
  verdict.setAttribute("role", "status");
  verdict.setAttribute("aria-live", "polite");
  box.append(head, taskText, hintText, row, verdict);
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      showCard(false);
      taskButton.focus();
    }
  });
  return box;
}

function showCard(open) {
  const lesson = LESSONS[at];
  if (!lesson?.exercise) open = false;
  card.hidden = !open;
  taskButton.setAttribute("aria-expanded", String(open));
  if (lesson) offered.add(lesson.class);
}

async function check() {
  const lesson = LESSONS[at];
  if (!lesson?.exercise) return;
  checkButton.disabled = true;
  verdict.className = "lesson-card-verdict";
  verdict.textContent = "Running and checking…";
  try {
    const now = await exerciseNow();
    // The reader may have moved on while the Run was under way.
    if (LESSONS[at] !== lesson) return;
    const { done, missing } = checkExercise(lesson.exercise.check, now);
    if (done) {
      solved.add(lesson.class);
      keepSolved();
      verdict.classList.add("is-done");
      verdict.textContent = LESSONS[at + 1] ? "Solved. On to the next lesson with ›" : "Solved - that was the last lesson of Start here.";
      reflectLesson();
    } else {
      verdict.classList.add("is-open");
      verdict.textContent = `Not yet: ${missing.join("; ")}.`;
    }
  } catch (e) {
    verdict.classList.add("is-open");
    verdict.textContent = `The check could not run: ${String(e?.message ?? e)}`;
  } finally {
    checkButton.disabled = false;
  }
}

const nameOf = (lesson) => (lesson ? lesson.title : "");

/** Shown, numbered and pointed at its neighbours - or hidden - for the app
 *  that is first in the editor now. */
export function reflectLesson() {
  if (!anchor) return;
  const first = filesNow()[0]?.name;
  at = LESSONS.findIndex((l) => fileOf(l) === first);
  const on = at >= 0;
  anchor.hidden = !on;
  document.getElementById("files")?.classList.toggle("has-lesson", on);
  if (!on) {
    if (card) card.hidden = true;
    return;
  }
  const lesson = LESSONS[at];
  const done = solved.has(lesson.class);
  label.textContent = `Lesson ${at + 1} of ${LESSONS.length}${done ? " ✓" : ""}`;
  taskButton.hidden = !lesson.exercise;
  taskButton.textContent = done ? "Task ✓" : "Task";
  taskButton.title = lesson.exercise ? `${done ? "Solved - " : ""}${lesson.exercise.task}` : "";
  if (taskText.dataset.lesson !== lesson.class) {
    // A different lesson: its own task, the hint folded, no verdict.
    taskText.dataset.lesson = lesson.class;
    taskText.textContent = lesson.exercise?.task ?? "";
    hintText.textContent = lesson.exercise?.hint ?? "";
    hintText.hidden = true;
    hintButton.hidden = !lesson.exercise?.hint;
    verdict.textContent = "";
    verdict.className = "lesson-card-verdict";
    if (opening) offered.add(lesson.class);
    if (lesson.exercise && !done && !offered.has(lesson.class)) showCard(true);
    else showCard(false);
  }
  label.title = `${PATH.stage}, the learning path of ${PATH.repo}: ${nameOf(LESSONS[at])}`;
  for (const [b, lesson, word] of [[previous, LESSONS[at - 1], "Previous"], [next, LESSONS[at + 1], "Next"]]) {
    b.disabled = !lesson;
    const said = lesson ? `${word} lesson: ${nameOf(lesson)}` : `No ${word.toLowerCase()} lesson`;
    b.title = said;
    b.setAttribute("aria-label", said);
  }
}
