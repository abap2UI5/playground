// The strip of file tabs above the editor.
//
// It only appears once there is more than one file, or once somebody has
// pressed "+". A playground that opens with a tab bar over a single class is
// claiming a complexity it does not have.
import { addFile, closeFile, currentFile, getFiles, openFile } from "../editor/editor.mjs";
import { MAIN_FILE, nameProblem, skeletonFor } from "../editor/files.mjs";

let strip;
let onChanged;

export function setUpFiles(options = {}) {
  strip = document.getElementById("files");
  onChanged = options.onChanged;

  strip.addEventListener("click", (e) => {
    const close = e.target.closest("[data-close]");
    if (close) {
      e.stopPropagation();
      closeFile(close.dataset.close);
      render();
      onChanged?.();
      return;
    }
    const add = e.target.closest("[data-add]");
    if (add) {
      askForNewFile();
      return;
    }
    const tab = e.target.closest("[data-file]");
    if (tab) {
      openFile(tab.dataset.file);
      render();
    }
  });

  render();
}

export function render() {
  const files = getFiles();
  const open = currentFile();

  strip.hidden = false;
  strip.replaceChildren(
    ...files.map((file) => {
      const tab = document.createElement("button");
      tab.className = `file-tab${file.name === open ? " is-active" : ""}`;
      tab.dataset.file = file.name;
      tab.type = "button";
      tab.append(file.name);
      // The entry class is what the playground starts, so it is not closable -
      // there would be nothing left to run.
      if (file.name !== MAIN_FILE) {
        const close = document.createElement("span");
        close.className = "file-close";
        close.dataset.close = file.name;
        close.title = `Remove ${file.name}`;
        close.append("✕");
        tab.append(close);
      }
      return tab;
    }),
    addButton(),
  );
}

function addButton() {
  const add = document.createElement("button");
  add.className = "file-add";
  add.dataset.add = "";
  add.type = "button";
  add.title = "Add a class or an interface";
  add.append("+");
  return add;
}

function askForNewFile() {
  const existing = getFiles().map((f) => f.name);
  const suggested = `zcl_helper.clas.abap`;
  const name = window.prompt(
    "Name of the new file, as abapGit would name it:\n" +
      "zcl_something.clas.abap for a class, zif_something.intf.abap for an interface.",
    existing.includes(suggested) ? "" : suggested,
  );
  if (name === null) return;

  const trimmed = name.trim().toLowerCase();
  const problem = nameProblem(trimmed, existing);
  if (problem) {
    window.alert(problem);
    return;
  }

  addFile({ name: trimmed, source: skeletonFor(trimmed) });
  render();
  onChanged?.();
}
