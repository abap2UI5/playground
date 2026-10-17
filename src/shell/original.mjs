// Compare with the original, and Reset to it - the bar's two buttons over
// files that were opened from something: a sample, a ?src= or ?gist= link, a
// shared link, a named draft (file-sets.mjs keeps the text they were opened
// as). Over a restored draft or the AI's writes there is nothing to compare
// with, and both say so instead of disappearing.
//
// Compare is a dialog with Monaco's own diff editor in it - in a chunk
// (compare-dialog.mjs), and the diff editor itself in Monaco's chunk
// (showDiff( ) in src/editor/monaco-editor.mjs), so the shell carries only
// these few lines. Reset is replaceWith( ): a file still open is rewritten in
// its model as one edit - Ctrl+Z takes it back, the way it takes back Format
// and Fix them - and a file added since goes to Your drafts with the rest of
// the work, like any other set of files opened over the reader's.
import { closeDiff, currentFile, getFiles, openFile, showDiff } from "../editor/editor.mjs";
import { originOf, rawFor } from "./deep-link.mjs";
import { isAsOpened, onOpenedChange, openedFiles, replaceWith } from "./file-sets.mjs";
import { setStatus, showOutput } from "./ui.mjs";

const NO_ORIGINAL = "nothing to compare with - only a sample or a link has an original";
const UNCHANGED = "nothing changed since it was opened";

let compareButton;
let resetButton;
let ready = false;

/** Whether there is an original, and whether the files moved away from it. */
function where() {
  const original = openedFiles();
  if (!original) return { original, why: NO_ORIGINAL };
  if (isAsOpened(getFiles())) return { original, why: UNCHANGED };
  return { original };
}

// Both buttons inactive with the reason as their title, or live - after
// every change to the files and whenever what counts as the original moves.
export function reflectOriginal() {
  if (!ready) return;
  const { why } = where();
  compareButton.disabled = resetButton.disabled = Boolean(why);
  compareButton.title = why ? `Compare with the original: ${why}` : "Compare the files with the original they were opened from";
  resetButton.title = why ? `Reset to the original: ${why}` : "Reset to the original - every file as it was opened (Ctrl+Z takes it back)";
}

export function resetToOriginal() {
  const { original, why } = where();
  if (why) return;
  const shown = currentFile();
  const kept = replaceWith(original);
  // Back on the file that was being read, where it is still there.
  if (original.some((f) => f.name === shown)) openFile(shown);
  setStatus(
    kept?.how === "drafts"
      ? `reset to the original - your changes are kept in Samples, under Your drafts, as "${kept.name}"`
      : kept?.how === "reload"
        ? "reset to the original - your changes come back if you reload"
        : "reset to the original - Ctrl+Z takes it back",
  );
}

// The hosts the layout editor's ?src= reads from (sourceUrl( ) in its
// src/clas.js) - the same two this page's own ?src= does.
const LAYOUT_EDITOR_READS = ["raw.githubusercontent.com", "gist.githubusercontent.com"];

/** For Open in Layout Editor (layout-editor.mjs, via the Share dialog): the
 *  raw URL a file can be fetched from exactly as it is on screen - opened
 *  from GitHub and unchanged since - or undefined. */
export function unchangedRawUrl(file) {
  const origin = originOf(file.name);
  const original = openedFiles()?.find((f) => f.name === file.name)?.source;
  if (!origin || original !== file.source) return undefined;
  try {
    const raw = rawFor(new URL(origin));
    return raw.protocol === "https:" && LAYOUT_EDITOR_READS.includes(raw.hostname) ? raw.href : undefined;
  } catch {
    return undefined;
  }
}

let compareChunk;
function compare() {
  compareChunk ??= import("./compare-dialog.mjs").then((m) => {
    m.setUpCompare({ reset: resetToOriginal, openedFiles, getFiles, currentFile, showDiff, closeDiff });
    return m;
  });
  compareChunk
    .then((m) => m.openCompare())
    .catch((e) => {
      compareChunk = undefined;
      setStatus("the comparison could not be opened", true);
      showOutput("Compare", String(e?.message ?? e));
    });
}

// Called once the page has started, with the bar's other controls.
export function setUpOriginal() {
  compareButton = document.getElementById("compare");
  resetButton = document.getElementById("reset-original");
  if (!compareButton || !resetButton) return;
  ready = true;
  compareButton.addEventListener("click", compare);
  resetButton.addEventListener("click", resetToOriginal);
  onOpenedChange(reflectOriginal);
  reflectOriginal();
}
