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
import { bindingAbap, clientOf, editableByDefault, EVENT_NAME, eventAbap, publicAttributes, withEventArm } from "./bind-options.mjs";
import { blockHead, empty, redraw } from "./insight-common.mjs";
import { setStatus } from "./ui.mjs";
import { frame } from "./page.mjs";
import { linkOf, onFrameMessage } from "./frame-link.mjs";

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
    if (sheet.element && sheet.xml === docs[0] && sheet.drawn === sheet.index && !sheet.want) return sheet.element;
    sheet.xml = docs[0];
    sheet.element = propertySheet(file, source, docs[0]);
    sheet.drawn = sheet.index;
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
  // A control just added, found in the view as reconstructed now. Until the
  // reconstruction has it, the pick stays where it was.
  if (sheet.want) {
    const at = elementForPick(elements, sheet.want);
    if (at !== -1) {
      sheet.index = at;
      sheet.want = undefined;
    }
  }
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
    if (picking) {
      picking = false;
      linkOf(frame).call("pick", [false], 3000).catch(() => {});
    }
    sheet = undefined;
    redraw();
    document.getElementById("view-properties")?.focus();
  });
  // Pick by clicking the control in the running app (the bridge's pick( ),
  // frontend-bridge.js): its next click picks instead of pressing.
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "ghost";
  pick.id = "view-pick";
  pick.textContent = picking ? "Click a control in the app… (Esc)" : "Pick in app";
  pick.setAttribute("aria-pressed", String(picking));
  pick.title = "The next click in the app picks the control under it here, instead of pressing it";
  pick.addEventListener("click", () => {
    picking = !picking;
    linkOf(frame).call("pick", [picking], 3000).catch(() => {
      picking = false;
      setStatus("the app frame did not answer - run the app first", true);
      sheet.element = undefined;
      redraw();
    });
    sheet.element = undefined;
    redraw();
  });
  actions.append(pick, done);
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
  // Bind instead of type: the app's public attributes, and the ABAP that
  // binds one in the shape the chain already calls the client by.
  const attributes = publicAttributes(source);
  const said = document.createElement("span");
  said.className = "config-said view-said";
  said.id = "view-props-said";
  said.setAttribute("role", "status");
  const client = clientOf(source);
  const bindSelect = (property, input) => {
    const select = document.createElement("select");
    select.className = "view-prop-bind";
    select.setAttribute("aria-label", `Bind ${property || "the new property"} to an attribute`);
    select.append(new Option("bind…", ""));
    // For a property the user types into (value, selected) the editable bind
    // comes first - what they type has to reach the attribute.
    const editFirst = editableByDefault(property);
    for (const a of attributes) {
      const show = new Option(a.name, `${a.name}|show`);
      const edit = new Option(`${a.name} (editable)`, `${a.name}|edit`);
      select.append(...(editFirst ? [edit, show] : [show, edit]));
    }
    // An event: the name typed into the field, raised by this property, and
    // an empty arm for it in main( ) (withEventArm( ) in bind-options.mjs).
    select.append(new Option("event - the name in the field", "|event"));
    select.title = "Bind to a public attribute of the app, or raise the event named in the field";
    select.addEventListener("change", () => {
      if (!select.value) return;
      const [name, how] = select.value.split("|");
      said.classList.remove("is-error");
      if (how === "event") {
        const event = input.value.trim().toUpperCase();
        if (!EVENT_NAME.test(event)) {
          said.classList.add("is-error");
          said.textContent = "Type the event's name into the field first - letters, digits and _, e.g. SAVE.";
          select.value = "";
          return;
        }
        input.dataset.event = event;
        input.dataset.abap = eventAbap(client, event);
      } else {
        delete input.dataset.event;
        input.dataset.abap = bindingAbap(client, name, how === "edit");
      }
      input.value = input.dataset.abap;
      input.classList.add("is-abap");
      select.value = "";
    });
    input.addEventListener("input", () => {
      delete input.dataset.abap;
      delete input.dataset.event;
      input.classList.remove("is-abap");
    });
    return select;
  };
  const valueOf = (input) => (input.dataset.abap ? abapValue(input.dataset.abap) : input.value);
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
    row.append(name, input, bindSelect(attr.name, input));
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
  add.append(addName, addValue, bindSelect("", addValue));
  form.append(add);
  const row = document.createElement("div");
  row.className = "config-row";
  const apply = document.createElement("button");
  apply.type = "submit";
  apply.className = "primary";
  apply.id = "view-props-apply";
  apply.textContent = "Apply";
  row.append(apply, said);
  form.append(row);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    said.classList.remove("is-error");
    let changed = false;
    for (const input of inputs) {
      const value = valueOf(input);
      if (value !== picked.getAttribute(input.dataset.attr)) {
        picked.setAttribute(input.dataset.attr, value);
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
      picked.setAttribute(newName, valueOf(addValue));
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
    // A new event gets its arm in main( ), empty, for the developer to fill.
    let next = written.source;
    const missed = [];
    for (const input of [...inputs, addValue]) {
      const event = input.dataset.event;
      if (!event) continue;
      const armed = withEventArm(next, client, event);
      if (armed.ok) next = armed.source;
      else missed.push(armed.why);
    }
    setSourceOf(file, next);
    // In the status line, which outlives the redraw the write sets off.
    setStatus(`${picked.tagName}: written into the builder chain${missed.length ? ` - ${missed.join(" ")}` : ""}`, missed.length > 0);
    redraw();
  });

  // Add from the palette (step 5): a control of PALETTE after the picked
  // one, under the same parent - the one place it is sure to be allowed.
  // The shape of the tree changes, so this takes the full rewrite of the
  // chain that an inserted control in the XML takes.
  if (picked.parentElement) {
    const adding = document.createElement("div");
    adding.className = "config-row view-palette";
    const label = document.createElement("label");
    label.htmlFor = "view-palette";
    label.textContent = "Add after this:";
    const choose = document.createElement("select");
    choose.id = "view-palette";
    for (const [tag] of PALETTE) choose.append(new Option(tag, tag));
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.id = "view-palette-add";
    addButton.textContent = "Add";
    addButton.addEventListener("click", () => {
      said.classList.remove("is-error");
      const entry = PALETTE.find(([tag]) => tag === choose.value);
      if (!entry) return;
      const [tag, attrs] = entry;
      const control = doc.createElementNS("sap.m", tag);
      for (const [name, value] of Object.entries(attrs)) control.setAttribute(name, value);
      picked.after(control);
      const written = sourceWithView(getSource(file), xml, new XMLSerializer().serializeToString(doc));
      if (!written.ok) {
        control.remove();
        said.classList.add("is-error");
        said.textContent = written.why;
        return;
      }
      // The new control is picked once the view has been reconstructed - by
      // its tag and its place among the controls of that tag, as a click in
      // the app is (elementForPick( )): the positions of everything else may
      // shift in the reconstruction, the order of one tag does not.
      const all = elementsOf(doc);
      const same = all.filter((el) => el.tagName.slice(el.tagName.indexOf(":") + 1) === tag);
      sheet.want = { tag, ordinal: same.indexOf(control), count: same.length };
      setSourceOf(file, written.source);
      sheet.element = undefined;
      setStatus(`${tag} added after ${picked.tagName}`);
      redraw();
    });
    adding.append(label, choose, addButton);
    form.append(adding);
  }

  body.append(tree, form);
  wrap.append(head, body);
  return wrap;
}

// The palette: sap.m controls that UI5 1.71 has and that stand on their own
// - no item aggregation to fill before they show anything - each with the
// one property that makes it visible.
const PALETTE = [
  ["Text", { text: "Text" }],
  ["Button", { text: "Button" }],
  ["Input", { value: "" }],
  ["Label", { text: "Label" }],
  ["Title", { text: "Title" }],
  ["CheckBox", { text: "CheckBox" }],
  ["Switch", { state: "false" }],
  ["DatePicker", { value: "" }],
  ["TextArea", { value: "" }],
  ["Link", { text: "Link" }],
  ["MessageStrip", { text: "Message" }],
  ["ObjectStatus", { text: "Status" }],
];

// Whether the app frame is waiting for the click that picks.
let picking = false;

/**
 * The element of the reconstructed view a click in the app picked: the
 * `ordinal`-th element with the control's tag, in document order - the
 * bridge counted the controls of that tag in tree order. `count` is how many
 * it found; when the view here has another number of them, which one is
 * meant cannot be told, and nothing is picked. Pure, for the tests.
 * @param {Element[]} elements
 * @param {{ tag: string, ordinal: number, count: number }} picked
 */
export function elementForPick(elements, picked) {
  const local = (el) => el.tagName.slice(el.tagName.indexOf(":") + 1);
  const same = elements.filter((el) => local(el) === picked.tag);
  if (same.length !== picked.count || picked.ordinal < 0 || picked.ordinal >= same.length) return -1;
  return elements.indexOf(same[picked.ordinal]);
}

// Escape on the page ends picking as well: after pressing Pick the focus is
// here, not in the app, and the frame's own Escape never hears it.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !picking) return;
  picking = false;
  linkOf(frame).call("pick", [false], 3000).catch(() => {});
  if (sheet) sheet.element = undefined;
  setStatus("picking stopped");
  redraw();
});

onFrameMessage("picked", (link, m) => {
  if (link.frame !== frame || !picking) return;
  picking = false;
  if (!sheet || !sheet.xml) return;
  sheet.element = undefined;
  const picked = m.picked;
  if (!picked || typeof picked.tag !== "string") {
    setStatus(picked === null ? "picking stopped" : "nothing pickable there");
    redraw();
    return;
  }
  const doc = new DOMParser().parseFromString(sheet.xml, "application/xml");
  const index = elementForPick(elementsOf(doc), picked);
  if (index === -1) {
    setStatus(`${picked.tag}: the app on screen and the view in the code do not line up - run the app again, then pick`, true);
  } else {
    sheet.index = index;
    setStatus(`${picked.tag} picked`);
  }
  redraw();
  document.querySelector('.view-tree button[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
});
