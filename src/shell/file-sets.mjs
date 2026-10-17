// What goes into the editor in place of what is there - a sample, a named
// draft, a catalogued class picked in the samples browser - and what is kept
// of the reader's own work when it does: the draft stored between visits
// (persistence.mjs) and, where Undo cannot reach it, the Drafts list
// (drafts.mjs). The status line's word about it is said here too, after the
// run that every pick starts.
import { getFiles, setFiles } from "../editor/editor.mjs";
import { checkFileSet } from "../editor/files.mjs";
import { isSample, loadSampleFiles, sampleById } from "../editor/samples.mjs";
import { fetchLinkedFiles, followNavigation, forgetOrigins } from "./deep-link.mjs";
import { render as renderFiles } from "./files-ui.mjs";
import { keepReplaced } from "./drafts.mjs";
import { keepsDrafts } from "./page.mjs";
import { writeDraft } from "./persistence.mjs";
import { runWhenFree } from "./run.mjs";
import { rememberSampleOrigins } from "./starting-files.mjs";
import { setStatus, showOutput } from "./ui.mjs";

// The files as the last load put them in, as text - a sample, a catalogued
// class, a named draft, a link. Until they are changed they are not a draft
// of the reader's, and keepDraft( ) does not store them over the one there is.
let opened;
// Set while replaceWith( ) writes files that are "as opened" into the
// editor - see keepDraft( ).
let openingAsOpened = false;

/** What the editor holds now is as it was opened - a link, the sample - and
 *  not the reader's work until they change it. */
export const markOpened = () => {
  opened = JSON.stringify(getFiles());
};

// Which pick in the samples browser is the latest. A catalogue example is
// fetched, so a slow one picked first could land AFTER a sample picked
// second - and replace it in the editor and run it, the reader having asked
// for the other. Each pick takes a number; a fetch that comes back to find a
// newer one drops what it fetched.
let latestPick = 0;

// The draft that is stored between visits, from the editor's change handler
// (remember( ) in main.mjs) - the playground's own page only.
//
// A sample that was picked and read is not a draft, and is forgotten rather
// than stored - the rule the checker settings already follow. Kept, it pinned
// the reader to a frozen copy: the sample was improved in a later deploy and
// they went on being opened on the old one, findings and all, labelled as
// their own last session. One keystroke makes it a draft again.
//
// What was stored BEFORE it is left where it is: a sample brings its own class
// name now, so opening one disposes the model the reader's work was in and
// Undo cannot reach it any more. The stored copy is then one way back, and
// deleting it here threw away the very thing the status line promised.
// Nor are files exactly as a link or the samples browser put them in: a
// catalogued sample is not one isSample( ) knows, and opening one from the
// browser used to write it straight over the stored draft - while the
// status line promised that draft would come back.
// While replaceWith( ) is putting them in: setFiles( ) reports the change
// before `opened` can be set to what it put there, and a catalogued sample
// or a named draft was stored over the draft in that one call.
export function keepDraft(current) {
  const pristine = openingAsOpened || (opened !== undefined && JSON.stringify(current) === opened);
  if (!isSample(current) && !pristine) writeDraft(current);
}

// Puts a set of files in the editor in place of what is there, and answers what
// happened to what was there: whether it was somebody's own work - a draft
// rather than a sample as it was opened - and how it can be had back.
//
// Undo can only reach a file that is still open. setFiles( ) writes the new
// source into a model whose file it can reuse, which is an undoable edit; a
// file that is not in the new set is disposed, and its history with it. That
// used to be the rare case, because every sample the playground carried was
// called zcl_playground.clas.abap. The samples come out of abap2UI5/samples
// now and bring their own class names, so it is the ordinary one - and the
// work is kept in the Drafts list then (drafts.mjs), which is where the
// status line can point: it used to say the draft "comes back if you
// reload", which was true and read as advice to reload the page.
//
// Answers undefined (nothing of the reader's was there), { how: "undo" },
// { how: "drafts", name } or { how: "reload" } when the list could not
// keep it and the stored draft is the only copy.
export function replaceWith(files, { asOpened = true } = {}) {
  const before = getFiles();
  // Somebody's own work - not a sample, and not files left exactly as they
  // were opened.
  const hadDraft = !isSample(before) && JSON.stringify(before) !== opened;
  const undoable = before.every((f) => files.some((n) => n.name === f.name));
  const kept = hadDraft && !undoable && keepsDrafts ? keepReplaced(before) : undefined;
  openingAsOpened = asOpened;
  try {
    setFiles(files.map((f) => ({ ...f })));
  } finally {
    openingAsOpened = false;
  }
  opened = asOpened ? JSON.stringify(getFiles()) : undefined;
  renderFiles();
  if (!hadDraft) return undefined;
  if (undoable) return { how: "undo" };
  return kept ? { how: "drafts", name: kept } : { how: "reload" };
}

// Said after the run, because run( ) ends by writing "running" over the
// status line - and said at all because a click that replaced an hour's work
// is the one moment the reader has to be told the work is not gone. Only
// after a run that started: one that stopped on an abaplint error or a
// transpiler refusal has said so in red, and "running - ..." over it was
// both untrue and the end of the only sentence that mattered.
function sayDraftIsKept(kept) {
  if (!kept) return;
  setStatus(
    kept.how === "undo"
      ? "running - your draft is one Undo away"
      : kept.how === "drafts"
        ? `running - your draft is kept in Samples, under Your drafts, as "${kept.name}"`
        : "running - your draft comes back if you reload",
  );
}

// Run what was just put in, and on a narrow screen bring the app forward -
// the same move Run makes - then say what became of the draft.
function runPicked(kept, tabs) {
  return runWhenFree().then((started) => {
    if (!started) return;
    tabs.show("right");
    sayDraftIsKept(kept);
  });
}

// One of the samples the page carries, chosen in the samples browser. Its
// files are a chunk (src/editor/samples.mjs), so this waits for them - and a
// newer pick made meanwhile wins, like a linked class that arrives late.
export async function loadSample(id, tabs) {
  const pick = ++latestPick;
  let files;
  try {
    files = await loadSampleFiles(id);
  } catch (e) {
    setStatus("the sample could not be loaded", true);
    showOutput("Samples", String(e?.message ?? e));
    return;
  }
  if (!files || pick !== latestPick) return;
  forgetOrigins();
  // A sample the page carries is a file in abap2UI5/samples, and the bar's
  // Source link goes there like it does for a linked one.
  rememberSampleOrigins(sampleById(id), files);
  const kept = replaceWith(files);
  // Picking a sample is a request to see it, so it runs without a second click.
  await runPicked(kept, tabs);
}

// A named draft, chosen in the samples browser - the same move as a sample,
// with the same word about the draft it replaced.
export async function loadDraft(files, tabs) {
  let checked;
  try {
    checked = checkFileSet(files);
  } catch (e) {
    setStatus("the draft could not be opened", true);
    showOutput("Drafts", String(e.message || e));
    return;
  }
  latestPick++;
  forgetOrigins();
  const kept = replaceWith(checked);
  await runPicked(kept, tabs);
}

// A catalogued example, chosen in the examples browser. The URL goes down the
// same path a ?src= link goes down - fetched and checked by deep-link.mjs, the
// classes it needs looked for beside it, the first file the app - just without
// the page reload a link would cost, because the registry this page has
// already built serves the new files as well as it served the old.
export async function loadLinked(url, tabs) {
  const pick = ++latestPick;
  try {
    setStatus("fetching the example…");
    const linked = checkFileSet(await fetchLinkedFiles(new URLSearchParams([["src", url]])));
    const alongside = await followNavigation(linked);
    if (pick !== latestPick) return;
    const kept = replaceWith(checkFileSet([...linked, ...alongside]));
    await runPicked(kept, tabs);
  } catch (e) {
    if (pick !== latestPick) return;
    // The catalogue said the class is there and it was not, or the fetch
    // failed under way. Somebody clicked expecting particular code, so this
    // failure is said out loud - unlike a catalogue that never loaded.
    setStatus("the example could not be opened", true);
    showOutput("Samples", String(e.message || e));
  }
}

// A catalogued class by its raw URL and the classes it needs beside it, as
// files - the ?src= path without the run.
export async function linkedFiles(url) {
  const linked = checkFileSet(await fetchLinkedFiles(new URLSearchParams([["src", url]])));
  return checkFileSet([...linked, ...(await followNavigation(linked))]);
}
