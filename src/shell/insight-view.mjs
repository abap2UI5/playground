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
import { sourceWithView, viewEditable } from "./view-edit.mjs";
import { blockHead, empty, redraw } from "./insight-common.mjs";
import { setStatus } from "./ui.mjs";

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
  if (sheet && sheet.file !== file) sheet = undefined;
  if (sheet && docs.length === 1) {
    // Kept while the view and the pick are what they were: a roundtrip
    // landing redraws the panel, and a value half typed into the sheet is
    // not something to rebuild from the source.
    if (sheet.element && sheet.xml === docs[0] && sheet.drawn === sheet.index) return sheet.element;
    sheet.xml = docs[0];
    sheet.drawn = sheet.index;
    sheet.element = propertySheet(file, source, docs[0]);
    return sheet.element;
  }

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

// The sheet that is open, or nothing: the file it is about and which element
// is picked, by its place in document order - what survives the re-render a
// write sets off, when the linter has reconstructed the view again.
let sheet;

function sheetButton(source, doc) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost";
  button.id = "view-properties";
  button.textContent = "Properties";
  const can = viewEditable(source, doc);
  if (can.ok) {
    button.title = "Pick a control and change its properties; the builder chain is patched where the value is";
    button.addEventListener("click", () => {
      sheet = { file: currentFile(), index: 0 };
      redraw();
      document.querySelector(".view-tree button")?.focus();
    });
  } else {
    button.disabled = true;
    button.title = can.why;
  }
  return button;
}

const elementsOf = (doc) => [...doc.getElementsByTagName("*")];

// A control as the tree names it: its tag, and what tells two of a kind
// apart - an id, a text, a title.
function labelOf(el) {
  const hint = el.getAttribute("id") ?? el.getAttribute("text") ?? el.getAttribute("title") ?? el.getAttribute("label");
  return hint ? `${el.tagName}  ${hint.length > 32 ? `${hint.slice(0, 32)}…` : hint}` : el.tagName;
}

function depthOf(el) {
  let n = 0;
  for (let p = el.parentElement; p; p = p.parentElement) n += 1;
  return n;
}

function propertySheet(file, source, xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const elements = elementsOf(doc);
  if (sheet.index >= elements.length) sheet.index = 0;
  const wrap = document.createElement("div");
  wrap.className = "view-preview view-sheet";

  const actions = document.createElement("span");
  actions.className = "log-actions";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "ghost";
  done.id = "view-properties-done";
  done.textContent = "Done";
  done.addEventListener("click", () => {
    sheet = undefined;
    redraw();
    document.getElementById("view-properties")?.focus();
  });
  actions.append(done);
  const head = blockHead("Properties", actions);

  const body = document.createElement("div");
  body.className = "view-sheet-body";
  const tree = document.createElement("ul");
  tree.className = "view-tree";
  tree.setAttribute("aria-label", "The controls of the view");
  elements.forEach((el, i) => {
    const item = document.createElement("li");
    const pick = document.createElement("button");
    pick.type = "button";
    pick.textContent = labelOf(el);
    pick.style.paddingInlineStart = `${0.4 + depthOf(el) * 0.9}rem`;
    if (i === sheet.index) pick.setAttribute("aria-current", "true");
    pick.addEventListener("click", () => {
      sheet.index = i;
      redraw();
      document.querySelector('.view-tree button[aria-current="true"]')?.focus();
    });
    item.append(pick);
    tree.append(item);
  });

  const picked = elements[sheet.index];
  const form = document.createElement("form");
  form.className = "view-props";
  form.setAttribute("aria-label", `Properties of ${picked.tagName}`);
  const title = document.createElement("p");
  title.className = "view-props-title";
  title.textContent = picked.tagName;
  form.append(title);
  // The attributes the element has, namespace declarations aside - those
  // belong to the document, not to a control.
  const own = [...picked.attributes].filter((a) => a.name !== "xmlns" && !a.name.startsWith("xmlns:"));
  const inputs = [];
  for (const attr of own) {
    const row = document.createElement("label");
    row.className = "view-prop";
    const name = document.createElement("span");
    name.textContent = attr.name;
    const input = document.createElement("input");
    input.type = "text";
    input.value = attr.value;
    input.dataset.attr = attr.name;
    input.spellcheck = false;
    // An expression the reconstruction rendered ({NAME}, .eB(...)) is ABAP
    // in the chain - a bind, an event. Changed here it becomes a literal;
    // left alone it stays what it is, which the sheet says.
    if (/^\{.*\}$|^\.eB\(|^\.eF\(/.test(attr.value)) {
      input.title = "Bound or an event in the ABAP - left alone it stays that; a new value here becomes a literal";
      row.classList.add("is-bound");
    }
    row.append(name, input);
    form.append(row);
    inputs.push(input);
  }
  const add = document.createElement("div");
  add.className = "view-prop view-prop-new";
  const addName = document.createElement("input");
  addName.type = "text";
  addName.placeholder = "new property";
  addName.id = "view-prop-new-name";
  addName.setAttribute("aria-label", "Name of a property to add");
  addName.spellcheck = false;
  const addValue = document.createElement("input");
  addValue.type = "text";
  addValue.placeholder = "value";
  addValue.id = "view-prop-new-value";
  addValue.setAttribute("aria-label", "Its value");
  addValue.spellcheck = false;
  add.append(addName, addValue);
  form.append(add);
  const row = document.createElement("div");
  row.className = "config-row";
  const apply = document.createElement("button");
  apply.type = "submit";
  apply.className = "primary";
  apply.id = "view-props-apply";
  apply.textContent = "Apply";
  const said = document.createElement("span");
  said.className = "config-said view-said";
  said.id = "view-props-said";
  said.setAttribute("role", "status");
  row.append(apply, said);
  form.append(row);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    said.classList.remove("is-error");
    let changed = false;
    for (const input of inputs) {
      if (input.value !== picked.getAttribute(input.dataset.attr)) {
        picked.setAttribute(input.dataset.attr, input.value);
        changed = true;
      }
    }
    const newName = addName.value.trim();
    if (newName !== "") {
      if (!/^[A-Za-z_][\w.:-]*$/.test(newName)) {
        said.classList.add("is-error");
        said.textContent = `${newName} is not a property name.`;
        return;
      }
      if (picked.hasAttribute(newName)) {
        said.classList.add("is-error");
        said.textContent = `${picked.tagName} has ${newName} already - change it above.`;
        return;
      }
      picked.setAttribute(newName, addValue.value);
      changed = true;
    }
    if (!changed) {
      said.textContent = "Nothing changed.";
      return;
    }
    const written = sourceWithView(getSource(file), xml, new XMLSerializer().serializeToString(doc));
    if (!written.ok) {
      said.classList.add("is-error");
      said.textContent = written.why;
      return;
    }
    setSourceOf(file, written.source);
    setStatus(`${picked.tagName}: written into the builder chain`);
    redraw();
  });

  body.append(tree, form);
  wrap.append(head, body);
  return wrap;
}
