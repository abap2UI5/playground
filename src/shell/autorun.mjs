// Run, pressed for you - and the Run button's own state, which Auto is one
// of three reasons for.
//
// Off by default; the switch beside Run says which it is, and while it is on
// Run itself is inactive - there is nothing left for it to do - and every
// change to the ABAP starts the app again once the typing has stopped.
//
// Off by default because a run is not free and not invisible: a compile, a
// fresh database and a full reload of the app frame, which throws away
// whatever was on screen. Somebody halfway through a form in their own app
// does not want that on a keystroke; somebody watching a view take shape
// wants nothing else. So it is a choice, and it is one click.
//
// Stored only while it differs from the default, and neither restored in nor
// stored from an embedded playground - the rule the theme and the checker
// settings follow (src/shell/theme.mjs), for the same reason: a demo in somebody's
// documentation page has to read the same to every reader.
//
// The run itself is run.mjs's, which imports this module for the button and
// the timer; what this module needs of the run is handed to setUpAutorun( ),
// so the two do not import each other.
import { getFiles } from "../editor/editor.mjs";
import { embedded } from "./page.mjs";
import { readStored, removeStored, writeStored } from "./storage.mjs";

const AUTORUN_KEY = "abap2ui5-playground:autorun";

// Long enough that a word being typed is one run rather than six, short
// enough that a pause reads as "and now show me". The editor's own change
// debounce is 150ms and hangs off the same keystrokes, so what this waits for
// is the analysis having settled as well.
const AUTORUN_DELAY = 700;

const runButton = document.getElementById("run");
const autorunButton = document.getElementById("autorun");

let autorun = false;
let autorunTimer;
// Until boot( ) has finished there is no runtime to run against, and Run has
// been disabled since index.html was parsed. It is one of three reasons the
// button may be inactive, which is why they are decided together below.
let booted = false;
// What the run module answers - see setUpAutorun( ).
let pipeline = {
  run: async () => undefined,
  running: () => false,
  waiting: () => false,
  lastRunText: () => undefined,
};

/**
 * `restore`: whether a stored Auto is switched back on. `pipeline`: the run
 * (`run({ quiet })`), whether one is under way (`running`), whether one is
 * already waiting for it to end (`waiting`), and the text it last started
 * from (`lastRunText`).
 */
export function setUpAutorun({ restore, ...given }) {
  pipeline = { ...pipeline, ...given };
  autorun = restore && readStored(AUTORUN_KEY) === "on";
  autorunButton.addEventListener("click", () => {
    autorun = !autorun;
    // Nor kept from one: the documentation embeds this page on the same
    // origin, and a demo's Auto switched on there was the full playground's
    // Auto on the reader's next visit - the rule checker-settings.mjs keeps.
    if (!embedded) {
      if (autorun) writeStored(AUTORUN_KEY, "on");
      else removeStored(AUTORUN_KEY);
    }
    reflectAutorun();
    // Switching it on is a request to see the code as it stands - whatever was
    // typed while it was off has not been run, and a switch that shows nothing
    // until the next keystroke looks like a switch that does nothing. Off, the
    // change already waiting is dropped rather than run behind the reader's
    // back.
    // During a Run, run( ) only returns - and the change waiting was dropped
    // with Run left disabled ("autorun has the job"). autorunAfterChange( )
    // waits for the Run to end and runs it then.
    if (autorun) {
      if (pipeline.running()) autorunAfterChange();
      else pipeline.run();
    } else clearTimeout(autorunTimer);
  });
  reflectAutorun();
}

/** boot( ) has finished: there is a runtime to run against. */
export function markBooted() {
  booted = true;
  reflectRunButton();
}

function reflectAutorun() {
  autorunButton.setAttribute("aria-checked", String(autorun));
  const said = autorun
    ? "Autorun is on - every change runs by itself"
    : "Autorun: run every change as it is typed";
  autorunButton.title = said;
  autorunButton.setAttribute("aria-label", said);
  runButton.title = autorun ? said : "Run (Ctrl+Enter)";
  reflectRunButton();
}

// Three reasons Run may be inactive - the page has not started, a run is
// already under way, autorun has the job - and one button. Decided in one
// place, because they used to be written by whichever of them moved last: a
// run finishing under autorun handed the button back.
export function reflectRunButton() {
  runButton.disabled = !booted || pipeline.running() || autorun;
}

/** A run supersedes the one autorun was about to start - pressing Run (or
 *  opening a sample, which runs on its own) while the timer is counting down
 *  must not be followed by a second run of the same text. */
export const cancelAutorun = () => clearTimeout(autorunTimer);

// Every debounced change to the ABAP comes through remember( ) in main.mjs,
// which calls this: a keystroke, a file added or closed, a set of files
// opened over the old one.
//
// Not before boot( ) has finished: there is no runtime to run against yet,
// and boot's own first run takes whatever was typed meanwhile. And not for
// text that has just been run - opening a sample or a draft writes the
// models, the editor's change debounce fires during the run that opening
// started, and without the comparison that one change was a second compile,
// database reset and frame reload of the same text 700ms later.
export function autorunAfterChange() {
  if (!autorun || !booted) return;
  clearTimeout(autorunTimer);
  autorunTimer = setTimeout(() => {
    // A run already under way owns the frame and the database, and run( )
    // would answer a second one by returning. So the change that arrived
    // during it is run after it rather than dropped - and so is one a run
    // already waits for (a sample picked during it, runWhenFree( )): this
    // timer firing in the moment between the two used to start the same
    // text first, and the waiting run then started it again.
    if (pipeline.running() || pipeline.waiting()) autorunAfterChange();
    else if (JSON.stringify(getFiles()) !== pipeline.lastRunText()) pipeline.run({ quiet: true });
  }, AUTORUN_DELAY);
}
