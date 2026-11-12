// The View tab's Properties sheet (insight-view.mjs): the view's controls as
// a tree, one picked - from the tree or by a click in the running app - its
// properties in a sheet, bound or typed, an event with its arm in main( ),
// a control from the palette after it. Every write goes through
// sourceWithView( ), the path the XML edit's Save takes. docs/design/panel.md
// has the whole of it.
//
// A chunk of its own, loaded the first time Properties is pressed: the
// shell is on every page and this is for the few who open it. It imports no
// shell module (AGENTS.md, load time); what it needs of the page is `d`,
// handed to setUpSheet( ) by insight-view.mjs.

/** @type {any} */
let d;

/** The sheet's setup, once: the page's half, and the listeners it needs. */
export function setUpSheet(deps) {
  d = deps;
  listen();
  return {
    /** Opens the sheet on `file`, the root of its view picked. */
    open(file) {
      sheet = { file, index: 0 };
    },
    /** The sheet for the View tab, or undefined when it is not open for
     *  `file` (or the file builds more than one view). */
    render(file, source, docs) {
      if (sheet && sheet.file !== file) sheet = undefined;
      if (!sheet || docs.length !== 1) return undefined;
      // Kept while the view and the pick are what they were: a roundtrip
      // landing redraws the panel, and a value half typed into the sheet is
      // not something to rebuild from the source.
      if (sheet.element && sheet.xml === docs[0] && sheet.drawn === sheet.index && !sheet.want) return sheet.element;
      sheet.xml = docs[0];
      sheet.element = propertySheet(file, source, docs[0]);
      sheet.drawn = sheet.index;
      return sheet.element;
    },
  };
}


// The sheet that is open, or nothing: the file it is about and which element
// is picked, by its place in document order - what survives the re-render a
// write sets off, when the linter has reconstructed the view again.
let sheet;

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
      d.linkOf(d.frame).call("pick", [false], 3000).catch(() => {});
    }
    sheet = undefined;
    d.redraw();
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
    d.linkOf(d.frame).call("pick", [picking], 3000).catch(() => {
      picking = false;
      d.setStatus("the app frame did not answer - run the app first", true);
      sheet.element = undefined;
      d.redraw();
    });
    sheet.element = undefined;
    d.redraw();
  });
  actions.append(pick, done);
  const head = d.blockHead("Properties", actions);

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
      d.redraw();
      document.querySelector('.view-tree button[aria-current="true"]')?.focus();
    });
    item.append(pick);
    tree.append(item);
  });

  const picked = elements[sheet.index];
  // The control's properties and events at the reader's UI5 floor, from the
  // linter's metadata (d.controlInfo( ) in lint-core.mjs) - asked once per tag
  // and drawn again when it arrives.
  const tagName = picked.tagName.slice(picked.tagName.indexOf(":") + 1);
  const info = infoFor(tagName);
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
  const attributes = d.bind.publicAttributes(source);
  const said = document.createElement("span");
  said.className = "config-said view-said";
  said.id = "view-props-said";
  said.setAttribute("role", "status");
  const client = d.bind.clientOf(source);
  const bindSelect = (property, input) => {
    const select = document.createElement("select");
    select.className = "view-prop-bind";
    select.setAttribute("aria-label", `Bind ${property || "the new property"} to an attribute`);
    select.append(new Option("bind…", ""));
    // For a property the user types into (value, selected) the editable bind
    // comes first - what they type has to reach the attribute.
    const editFirst = d.bind.editableByDefault(property);
    // Only the attributes whose type fits the property's (d.bind.bindsTo( )): a
    // boolean property is offered abap_bool, a number a number, never a table.
    const type = info?.properties.find((p) => p.name === property)?.type;
    for (const a of attributes.filter((attr) => d.bind.bindsTo(type, attr))) {
      const show = new Option(a.name, `${a.name}|show`);
      const edit = new Option(`${a.name} (editable)`, `${a.name}|edit`);
      select.append(...(editFirst ? [edit, show] : [show, edit]));
    }
    // An event: the name typed into the field, raised by this property, and
    // an empty arm for it in main( ) (d.bind.withEventArm( ) in bind-options.mjs).
    select.append(new Option("event - the name in the field", "|event"));
    select.title = "Bind to a public attribute of the app, or raise the event named in the field";
    select.addEventListener("change", () => {
      if (!select.value) return;
      const [name, how] = select.value.split("|");
      said.classList.remove("is-error");
      if (how === "event") {
        const event = input.value.trim().toUpperCase();
        if (!d.bind.EVENT_NAME.test(event)) {
          said.classList.add("is-error");
          said.textContent = "Type the event's name into the field first - letters, digits and _, e.g. SAVE.";
          select.value = "";
          return;
        }
        input.dataset.event = event;
        input.dataset.abap = d.bind.eventAbap(client, event);
      } else {
        delete input.dataset.event;
        input.dataset.abap = d.bind.bindingAbap(client, name, how === "edit");
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
  const valueOf = (input) => (input.dataset.abap ? d.abapValue(input.dataset.abap) : input.value);
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
  // What the control has and does not set yet, at the floor - typed or picked.
  if (info) {
    const list = document.createElement("datalist");
    list.id = "view-prop-names";
    const set = new Set(own.map((a) => a.name));
    for (const p of info.properties) if (!set.has(p.name)) list.append(new Option(`${p.type}`, p.name));
    for (const e of info.events) if (!set.has(e)) list.append(new Option("event", e));
    addName.setAttribute("list", list.id);
    add.append(list);
    addName.placeholder = `new property - ${info.properties.length} at UI5 ${info.floor}`;
  }
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
    let unknownName = "";
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
      if (info && !info.properties.some((p) => p.name === newName) && !info.events.includes(newName)) {
        unknownName = `${newName} is no property or event of ${info.name} at UI5 ${info.floor} - the linter will say so in Problems.`;
      }
    }
    if (!changed) {
      said.textContent = "Nothing changed.";
      return;
    }
    const written = d.sourceWithView(d.getSource(file), xml, new XMLSerializer().serializeToString(doc));
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
      const armed = d.bind.withEventArm(next, client, event);
      if (armed.ok) next = armed.source;
      else missed.push(armed.why);
    }
    d.setSourceOf(file, next);
    // In the status line, which outlives the redraw the write sets off.
    const notes = [...missed, unknownName].filter(Boolean);
    d.setStatus(`${picked.tagName}: written into the builder chain${notes.length ? ` - ${notes.join(" ")}` : ""}`, notes.length > 0);
    d.redraw();
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
      const written = d.sourceWithView(d.getSource(file), xml, new XMLSerializer().serializeToString(doc));
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
      d.setSourceOf(file, written.source);
      sheet.element = undefined;
      d.setStatus(`${tag} added after ${picked.tagName}`);
      d.redraw();
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
function listen() {
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !picking) return;
  picking = false;
  d.linkOf(d.frame).call("pick", [false], 3000).catch(() => {});
  if (sheet) sheet.element = undefined;
  d.setStatus("picking stopped");
  d.redraw();
});

d.onFrameMessage("picked", (link, m) => {
  if (link.frame !== d.frame || !picking) return;
  picking = false;
  if (!sheet || !sheet.xml) return;
  sheet.element = undefined;
  const picked = m.picked;
  if (!picked || typeof picked.tag !== "string") {
    d.setStatus(picked === null ? "picking stopped" : "nothing pickable there");
    d.redraw();
    return;
  }
  const doc = new DOMParser().parseFromString(sheet.xml, "application/xml");
  const index = elementForPick(elementsOf(doc), picked);
  if (index === -1) {
    d.setStatus(`${picked.tag}: the app on screen and the view in the code do not line up - run the app again, then pick`, true);
  } else {
    sheet.index = index;
    d.setStatus(`${picked.tag} picked`);
  }
  d.redraw();
  document.querySelector('.view-tree button[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
});
  d.onLinterSettings(() => sheetInfoChanged());
}

// d.controlInfo( ) answers, per tag; undefined while asked, null for a control
// the metadata does not know. Dropped when the linter's settings change, so
// a new UI5 floor is asked afresh (sheetInfoChanged( )).
const infos = new Map();
function infoFor(tag) {
  if (infos.has(tag)) return infos.get(tag) ?? undefined;
  infos.set(tag, undefined);
  d.controlInfo(tag).then(
    (info) => {
      infos.set(tag, info ?? null);
      if (sheet) {
        sheet.element = undefined;
        d.redraw();
      }
    },
    () => infos.set(tag, null),
  );
  return undefined;
}
/** The UI5 floor changed (Config, the bar): the sheet's choices are asked again. */
export function sheetInfoChanged() {
  infos.clear();
  if (sheet) sheet.element = undefined;
}
