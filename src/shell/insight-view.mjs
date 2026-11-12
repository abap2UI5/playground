// The View tab: the XML the builder chain in the open file produces, as the
// abap2UI5 linter reconstructs it - without running a line of ABAP, so it
// follows the typing. Not the view the app rendered: that one is in the
// Roundtrips tab, where it arrived. This is the answer to "what does this
// chain make", one element per line, which is the fastest way to learn the
// builder.
//
// And, with Edit, the other direction: change the XML and the chain is
// written again to build it (src/shell/view-edit.mjs). It is the shortest way
// there is to learn the builder - move a control, see the ABAP that moves it -
// and the fastest way to try a property on a control without looking up which
// call sets it.
//
// Properties is the same direction without typing XML - the first cut of the
// visual builder (docs/concepts/visual-builder.md in abap2UI5/abap2UI5): the
// view's controls as a tree, one picked, its attributes in a sheet. A value
// changed or added there is put into the XML that was shown and goes through
// exactly the path Save takes (sourceWithView( ): chain-patch writes over that
// value alone), so a value left alone keeps its ABAP and a bind stays a bind.
import { currentFile, getSource, lintViewsFor, setEditorReadOnly, setSourceOf } from "../editor/editor.mjs";
import { copyToClipboard } from "./share.mjs";
import { prettyXml } from "./xml-pretty.mjs";
import { highlighted } from "./highlight.mjs";
import { abapValue, sourceWithView, viewEditable } from "./view-edit.mjs";
import * as bind from "./bind-options.mjs";
import { blockHead, empty, redraw } from "./insight-common.mjs";
import { setStatus } from "./ui.mjs";
import { frame } from "./page.mjs";
import { linkOf, onFrameMessage } from "./frame-link.mjs";
import { controlInfo } from "../editor/registry.mjs";
import { onLinterSettings } from "../editor/abap2ui5-lint.mjs";

export function viewTab() {
  const file = currentFile();
  const source = file ? getSource(file) : undefined;
  if (source === undefined) return empty("Nothing to show yet.");
  // The edit is about one file's chain. Switching to another one ends it
  // rather than writing this XML into that file.
  if (editing && editing.file !== file) stopEditing();

  // Off the kept analysis - the worker reconstructed it for the findings, and
  // this tab is drawn again whenever a fresh one lands.
  const { docs, notes, loaded } = lintViewsFor(file);
  if (!loaded) return empty("The abap2UI5 linter has not looked at this file yet - the view appears when it has.");
  if (docs.length === 0) {
    return empty("This file builds no view with z2ui5_cl_ui5_view_builder - nothing to reconstruct.");
  }
  // The same element, kept across a re-render: half-typed XML and where the
  // caret is in it are not things to rebuild from the source, which is exactly
  // what everything else in this panel is.
  if (editing) return editing.element;
  // The Properties sheet, when it is open for this file (view-sheet.mjs).
  const drawn = sheetChunk?.render(file, source, docs);
  if (drawn) return drawn;

  const wrap = document.createElement("div");
  wrap.className = "view-preview";
  docs.forEach((doc, i) => {
    const pretty = prettyXml(doc);
    const actions = document.createElement("span");
    actions.className = "log-actions";
    // One view per file is what can be edited: with two, which chain a change
    // belongs to is a guess, and the reader is one click from the ABAP anyway.
    if (docs.length === 1) actions.append(sheetButton(source, doc), editButton(source, doc, pretty));
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ghost";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      copy.textContent = (await copyToClipboard(pretty)) ? "copied" : "Copy";
    });
    actions.append(copy);
    const head = blockHead(docs.length === 1 ? "The view this file builds" : `View ${i + 1} of ${docs.length}`, actions);
    const body = document.createElement("pre");
    body.className = "log-body view-xml";
    body.append(highlighted(pretty, "xml"));
    wrap.append(head, body);
  });
  if (notes.length > 0) {
    const said = document.createElement("p");
    said.className = "config-blurb view-notes";
    said.textContent = notes.join(" · ");
    wrap.append(said);
  }
  return wrap;
}

// The edit is about one file's chain, and it makes the ABAP editor read-only
// while it is open. Showing another file ends it - called by the panel on the
// switch itself, and not only when this tab next renders: with Problems in
// front, the other file arrived read-only with nothing on screen to say why.
export function fileShown(file) {
  if (editing && editing.file !== file) stopEditing();
}

// Edit, or the reason it is off. A chain this cannot rewrite is the normal
// case rather than the exceptional one - a view filled from a LOOP, a control
// name held in a variable, a second view in the same method - and the button
// says which of those it is instead of being missing.
function editButton(source, doc, pretty) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost";
  button.id = "view-edit";
  button.textContent = "Edit";
  const can = viewEditable(source, doc);
  if (can.ok) {
    button.title = "Change the view here; the builder chain is written again from it";
    button.addEventListener("click", () => startEditing(currentFile(), doc, pretty));
  } else {
    button.disabled = true;
    button.title = can.why;
  }
  return button;
}

// What is open in the View tab's editor, or nothing. The draft lives here
// rather than in the textarea alone so that a re-render - a roundtrip
// landing, a tab going away and coming back - cannot lose what was typed.
let editing;

function startEditing(file, xml, pretty) {
  editing = { file, xml, draft: pretty };
  editing.element = buildViewEditor();
  // The ABAP is derived from this XML while it is open, so it stops being
  // typed into: two editable copies of one view means deciding which of them
  // is the truth on every keystroke, and neither answer is a good one.
  setEditorReadOnly(true);
  redraw();
  // The render took the Edit button away with the focus on it; the focus goes
  // to what replaced it rather than to <body>.
  document.getElementById("view-editor")?.focus();
}

function stopEditing() {
  editing = undefined;
  setEditorReadOnly(false);
}

function buildViewEditor() {
  const wrap = document.createElement("div");
  wrap.className = "view-preview is-editing";

  const actions = document.createElement("span");
  actions.className = "log-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.id = "view-save";
  save.textContent = "Save";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ghost";
  cancel.id = "view-cancel";
  cancel.textContent = "Cancel";
  actions.append(save, cancel);
  const head = blockHead("Editing the view", actions);

  const area = document.createElement("textarea");
  area.className = "config-text view-editor";
  area.id = "view-editor";
  area.setAttribute("aria-label", "Editing the view: XML");
  area.spellcheck = false;
  area.value = editing.draft;
  area.addEventListener("input", () => {
    editing.draft = area.value;
  });

  const said = document.createElement("p");
  said.className = "config-said view-said";
  said.id = "view-said";
  // Said aloud when it changes - a refused Save is the one thing here a
  // screen reader user must not miss.
  said.setAttribute("role", "status");
  const explain = () => {
    said.classList.remove("is-error");
    said.textContent =
      "The ABAP editor is read-only until this is saved or cancelled. A value you leave alone keeps the " +
      "ABAP that produced it, so a bind stays a bind.";
  };
  explain();

  save.addEventListener("click", () => {
    const file = editing.file;
    const written = sourceWithView(getSource(file), editing.xml, editing.draft);
    if (!written.ok) {
      said.classList.add("is-error");
      said.textContent = written.why;
      return;
    }
    stopEditing();
    setSourceOf(file, written.source);
    setStatus("the builder chain was written again from the view");
    redraw();
    document.getElementById("view-edit")?.focus();
  });

  cancel.addEventListener("click", () => {
    stopEditing();
    redraw();
    // Back to Edit, which the render put where Cancel was - not to <body>.
    document.getElementById("view-edit")?.focus();
  });

  wrap.append(head, area, said);
  return wrap;
}

// ------------------------------------------------------------ Properties

// The sheet is a chunk of its own (view-sheet.mjs), loaded the first time
// Properties is pressed: most visits never open it, and the shell is on
// every page (tools/check-size.mjs holds it to its budget). What it needs of
// the shell is handed to it here - a chunk imports no shell module.
let sheetChunk;
let sheetLoading;
function loadSheet() {
  sheetLoading ??= import("./view-sheet.mjs").then((mod) => {
    sheetChunk = mod.setUpSheet({
      getSource, setSourceOf, redraw, setStatus, blockHead, frame, linkOf, onFrameMessage,
      controlInfo, onLinterSettings, sourceWithView, abapValue, bind,
    });
    return sheetChunk;
  });
  return sheetLoading;
}

function sheetButton(source, doc) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost";
  button.id = "view-properties";
  button.textContent = "Properties";
  const can = viewEditable(source, doc);
  if (can.ok) {
    button.title = "Pick a control and change its properties; the builder chain is patched where the value is";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        (await loadSheet()).open(currentFile());
      } catch (e) {
        setStatus(`the Properties sheet could not be loaded: ${String(e?.message ?? e)}`, true);
      } finally {
        button.disabled = false;
      }
      redraw();
      document.querySelector(".view-tree button")?.focus();
    });
  } else {
    button.disabled = true;
    button.title = can.why;
  }
  return button;
}
