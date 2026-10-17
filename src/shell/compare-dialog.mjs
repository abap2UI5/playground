// The Compare dialog (original.mjs): one file at a time, the original on the
// left and the file as it is now on the right, in Monaco's diff editor -
// read-only, because the place to change the code is the editor behind it.
// A chunk, imported on the first press.
//
// It imports nothing of the shell's but ui.mjs, which the Share dialog's
// chunk shares already: what it needs of the editor and of file-sets.mjs is
// handed to setUpCompare( ) by original.mjs. Imported here, those modules
// would be split out of assets/shell.mjs into a chunk the shell then loads
// as one more request on every page.
import { closeOnBackdrop } from "./ui.mjs";

let dialog;
let picker;
let pane;
let said;
let original = [];
let editor;

export function setUpCompare({ reset, ...hooks }) {
  editor = hooks;
  dialog = document.getElementById("compare-dialog");
  picker = document.getElementById("compare-file");
  pane = document.getElementById("compare-diff");
  said = document.getElementById("compare-said");
  closeOnBackdrop(dialog);
  // The diff editor holds a scratch model and listens to the live one: gone
  // with the dialog, however it was closed.
  dialog.addEventListener("close", () => editor.closeDiff());
  picker.addEventListener("change", () => show(picker.value));
  document.getElementById("compare-reset").addEventListener("click", () => {
    dialog.close();
    reset();
  });
}

const sourceIn = (files, name) => files.find((f) => f.name === name)?.source;

// Every file that differs, in the order the original had them, then the ones
// added since.
function changedFiles() {
  const now = editor.getFiles();
  const names = [...new Set([...original.map((f) => f.name), ...now.map((f) => f.name)])];
  return names
    .filter((name) => sourceIn(original, name) !== sourceIn(now, name))
    .map((name) => ({
      name,
      how: sourceIn(original, name) === undefined ? "added" : sourceIn(now, name) === undefined ? "removed" : "changed",
    }));
}

function show(name) {
  editor.showDiff(pane, name, sourceIn(original, name));
  const how = picker.selectedOptions[0]?.dataset.how;
  said.textContent =
    how === "added"
      ? "not in the original - all of it is new"
      : how === "removed"
        ? "in the original, closed since"
        : "left: as it was opened · right: now";
}

export function openCompare() {
  original = editor.openedFiles() ?? [];
  const changed = changedFiles();
  if (!dialog || changed.length === 0) return;
  picker.replaceChildren(
    ...changed.map(({ name, how }) => {
      const option = new Option(how === "changed" ? name : `${name} (${how})`, name);
      option.dataset.how = how;
      return option;
    }),
  );
  // The file on screen, when it is one of them - that is the one being asked about.
  const shown = editor.currentFile();
  picker.value = changed.some((f) => f.name === shown) ? shown : changed[0].name;
  picker.disabled = changed.length === 1;
  if (!dialog.open) dialog.showModal();
  show(picker.value);
}
