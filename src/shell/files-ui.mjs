// The strip of file tabs above the editor.
//
// Always visible, even over a single file: the one tab is what tells a reader
// that files have abapGit names and that "+" exists at all. It starts hidden in
// the markup only so nothing flashes before boot puts real tabs into it.
import { addFile, closeFile, currentFile, getFiles, openFile } from "../editor/editor.mjs";
import { nameProblem, skeletonFor } from "../editor/files.mjs";
import { setStatus } from "./ui.mjs";

let strip;
let onChanged;
// Opening a different file changes nothing about the file set, so it is not a
// change - but it does change what several things on the page are about: the
// outline below the editor, and the link to where this file came from.
let onOpened;

// Whether the strip is currently asking for a name, so a render provoked by
// something else does not throw the half-typed one away.
let naming = false;

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
  // A name is being typed. Rewriting the strip now would take the input away
  // mid-word - and the strip is rendered on every change to the file set,
  // which includes the ones the editor makes while somebody is still typing.
  if (naming) return;

  const files = getFiles();
  const open = currentFile();

  strip.hidden = false;
  strip.replaceChildren(...files.map((file, index) => fileTab(file, index, open)), addButton());
}

// One tab: the name, and for every file but the first a control to remove it.
//
// A container with two buttons in it rather than one button with a span
// inside. The span was not reachable by keyboard and announced nothing, and it
// could not become a button where it was - a button inside a button is not
// something HTML allows. So the tab itself stopped being the button.
function fileTab(file, index, open) {
  const tab = document.createElement("div");
  tab.className = `file-tab${file.name === open ? " is-active" : ""}`;

  const name = document.createElement("button");
  name.className = "file-name";
  name.type = "button";
  name.dataset.file = file.name;
  name.role = "tab";
  name.setAttribute("aria-selected", String(file.name === open));
  name.append(file.name);
  tab.append(name);

  // The first file is what the playground starts, so it is not closable -
  // closing it would silently change which class Run begins with. Keyed on
  // the position rather than on a name, because a linked or shared file set
  // can begin with anything.
  if (index > 0) {
    const close = document.createElement("button");
    close.className = "file-close";
    close.type = "button";
    close.dataset.close = file.name;
    close.title = `Remove ${file.name}`;
    close.setAttribute("aria-label", `Remove ${file.name}`);
    close.append("✕");
    tab.append(close);
  }
  return tab;
}

function addButton() {
  const add = document.createElement("button");
  add.className = "file-add";
  add.dataset.add = "";
  add.type = "button";
  add.title = "Add a class or an interface";
  add.setAttribute("aria-label", "Add a class or an interface");
  add.append("+");
  return add;
}

// Asking for the name, in the strip itself.
//
// This was window.prompt( ), and window.prompt( ) is not answered at all in a
// cross-origin iframe - Chrome has ignored it there for years. Which is to say
// it worked everywhere except in an embedded playground, where the button
// simply did nothing and said nothing, and an embedded playground on somebody
// else's documentation page is most of what this is. The same goes for the
// alert( ) that used to explain a rejected name; that goes to the status line,
// which is a channel an embedding page can actually see.
function askForNewFile() {
  const existing = getFiles().map((f) => f.name);
  const suggested = "zcl_helper.clas.abap";

  naming = true;

  const input = document.createElement("input");
  input.className = "file-new";
  input.type = "text";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Name of the new file, as abapGit would name it");
  input.placeholder = "zcl_something.clas.abap";
  input.value = existing.includes(suggested) ? "" : suggested;

  const done = () => {
    naming = false;
    render();
  };

  const commit = () => {
    const trimmed = input.value.trim().toLowerCase();
    if (trimmed === "") {
      done();
      return;
    }
    const problem = nameProblem(trimmed, existing);
    if (problem) {
      // Kept open with the offending name still in it: the answer to "that is
      // not a file name" is almost always a small correction, not starting
      // again.
      setStatus(problem, true);
      input.select();
      return;
    }
    naming = false;
    addFile({ name: trimmed, source: skeletonFor(trimmed) });
    render();
    onChanged?.();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      done();
    }
  });

  // Deliberately not cancelled on blur, which is the obvious way to write this
  // and is wrong here. The app in the frame takes the focus away from this page
  // on its own: sap.m calls _applyAutoFocusTo when a page renders, and a
  // roundtrip finishing while somebody is halfway through a file name would
  // then have deleted the name they were typing. Escape is the way out, and it
  // is the only one - an input that is still there is recoverable, a name that
  // vanished because a frame finished rendering is not.

  // The add button becomes the input, so the strip does not jump.
  strip.replaceChildren(...[...strip.children].filter((c) => !c.matches("[data-add]")), input);
  input.focus();
  input.select();
}
