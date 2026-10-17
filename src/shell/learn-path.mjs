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
import PATH from "../../build/samples/lessons.json";

const LESSONS = PATH.lessons;
const fileOf = (lesson) => `${lesson.class}.clas.abap`;

let anchor;
let label;
let previous;
let next;
let at = -1;
let filesNow = () => [];

export function setUpLearnPath({ openSample, openLinked, getFiles, samples }) {
  const files = document.getElementById("files");
  if (LESSONS.length < 2 || !files || anchor) return;
  filesNow = getFiles;

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
  bar.append(previous, label, next);
  anchor.append(bar);
  files.after(anchor);
  reflectLesson();
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
  if (!on) return;
  label.textContent = `Lesson ${at + 1} of ${LESSONS.length}`;
  label.title = `${PATH.stage}, the learning path of ${PATH.repo}: ${nameOf(LESSONS[at])}`;
  for (const [b, lesson, word] of [[previous, LESSONS[at - 1], "Previous"], [next, LESSONS[at + 1], "Next"]]) {
    b.disabled = !lesson;
    const said = lesson ? `${word} lesson: ${nameOf(lesson)}` : `No ${word.toLowerCase()} lesson`;
    b.title = said;
    b.setAttribute("aria-label", said);
  }
}
