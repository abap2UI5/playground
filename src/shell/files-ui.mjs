// The strip of file tabs above the editor.
//
// Always visible, even over a single file: the one tab is what tells a reader
// that files have abapGit names and that "+" exists at all. It starts hidden in
// the markup only so nothing flashes before boot puts real tabs into it.
import { addFile, closeFile, currentFile, getFiles, openFile } from "../editor/editor.mjs";
import { nameProblem, skeletonFor } from "../editor/files.mjs";

let strip;
let onChanged;
// Opening a different file changes nothing about the file set, so it is not a
// change - but it does change what several things on the page are about: the
// outline below the editor, and the link to where this file came from.
let onOpened;

export function setUpFiles(options = {}) {
  strip = document.getElementById("files");
  onChanged = options.onChanged;
  onOpened = options.onOpened;

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
      onOpened?.();
    }
  });

  render();
}

export function render() {
  const files = getFiles();
  const open = currentFile();

  strip.hidden = false;
  strip.replaceChildren(
    ...files.map((file, index) => {
      const tab = document.createElement("button");
      tab.className = `file-tab${file.name === open ? " is-active" : ""}`;
      tab.dataset.file = file.name;
      tab.type = "button";
      tab.append(file.name);
      // The first file is what the playground starts, so it is not closable -
      // closing it would silently change which class Run begins with. Keyed on
      // the position rather than on a name, because a linked or shared file set
      // can begin with anything.
      if (index > 0) {
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
