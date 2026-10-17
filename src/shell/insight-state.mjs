// The State tab: the app's attributes as the last roundtrip left them - each
// with its type and its value, structures and tables opened up a level at a
// time - and what changed since the roundtrip before it, marked.
//
// This is the debugger's variables view for a program that runs a roundtrip
// at a time: the question after a click is almost always "what is in the
// attribute now", and the answer was a WRITE and a Run away. The snapshot is
// taken in the runtime worker at the end of each roundtrip, off the instance
// itself, bounded there (src/runtime/app-state.mjs), and travels with the
// roundtrip it belongs to (roundtrips.mjs) - so it is started afresh by a Run
// and kept no longer than the roundtrips are. Read-only: the app's state is
// what the app made it.
import { roundtripList } from "./roundtrips.mjs";
import { blockHead, empty, redraw } from "./insight-common.mjs";

// Which containers the reader opened or closed by hand, by path. A container
// with a change inside opens by itself - unless it was closed by hand - so
// the change is on screen without a click; everything else starts closed.
const opened = new Set();
const closed = new Set();

// The roundtrip whose state is shown, and the one before it that had state:
// the last two the runtime described. A roundtrip that ended in a dump
// carries none, and is said in a line above the state it did not change.
function latest() {
  const list = roundtripList();
  let now;
  let before;
  for (let i = list.length - 1; i >= 0; i--) {
    if (!list[i].state) continue;
    if (now === undefined) now = list[i];
    else {
      before = list[i];
      break;
    }
  }
  return { now, before, last: list[list.length - 1] };
}

export function stateTab() {
  const { now, before, last } = latest();
  if (now === undefined) {
    return empty("Nothing yet. After each roundtrip the app's attributes land here - with what changed since the one before marked.");
  }
  const previous = before && before.state.class === now.state.class ? flatten(before.state.attributes) : undefined;
  const changes = changedPaths(now.state.attributes, previous);

  const wrap = document.createElement("div");
  wrap.className = "state";
  const said = now.args.length > 0 ? `${now.event} (${now.args.join(", ")})` : now.event;
  const count = previous === undefined
    ? ""
    : changes.size === 0
      ? " · nothing changed"
      : ` · ${changes.size} change${changes.size === 1 ? "" : "s"} since #${before.n}`;
  wrap.append(blockHead(`${now.state.class} after #${now.n} ${said}${count}`));
  if (last && last !== now) {
    const note = document.createElement("p");
    note.className = "state-note";
    note.textContent = `#${last.n} ${last.event} did not finish (${last.status}) - this is the state #${now.n} left.`;
    wrap.append(note);
  }
  const list = document.createElement("ul");
  list.className = "state-list";
  list.setAttribute("role", "tree");
  list.setAttribute("aria-label", `Attributes of ${now.state.class}`);
  for (const node of now.state.attributes) list.append(...rows(node, node.name, 0, changes));
  wrap.append(list);
  if (now.state.cut) {
    const note = document.createElement("p");
    note.className = "state-note";
    note.textContent = "Deep or large values are cut short here - the app holds all of it.";
    wrap.append(note);
  }
  return wrap;
}

// The rows for one node and, when it is open, everything under it.
function rows(node, path, depth, changes) {
  const container = Array.isArray(node.children);
  const changedInside = container && [...changes].some((p) => p.startsWith(`${path}/`));
  const open = container && (opened.has(path) || (!closed.has(path) && changedInside));

  const item = document.createElement("li");
  item.className = "state-row";
  item.setAttribute("role", "treeitem");
  item.style.setProperty("--depth", String(depth));
  if (changes.has(path)) item.classList.add("is-changed");
  if (container) item.setAttribute("aria-expanded", String(open));

  const toggle = document.createElement(container ? "button" : "span");
  toggle.className = "state-toggle";
  if (container) {
    /** @type {HTMLButtonElement} */ (toggle).type = "button";
    toggle.textContent = open ? "▾" : "▸";
    toggle.dataset.focus = `state ${path}`;
    toggle.setAttribute("aria-label", `${open ? "Close" : "Open"} ${node.name}`);
    toggle.addEventListener("click", () => {
      if (open) {
        opened.delete(path);
        closed.add(path);
      } else {
        closed.delete(path);
        opened.add(path);
      }
      redraw();
    });
  }

  const name = document.createElement("span");
  name.className = "state-name";
  name.textContent = depth > 0 && /^\d+$/.test(node.name) ? `[${node.name}]` : node.name;
  if (node.static) name.title = "static (CLASS-DATA)";

  const type = document.createElement("span");
  type.className = "state-type";
  type.textContent = node.visibility && node.visibility !== "public" ? `${node.type} · ${node.visibility}` : node.type;

  const value = document.createElement("span");
  value.className = "state-value";
  if (container) {
    value.textContent = node.rows !== undefined ? `${node.rows} row${node.rows === 1 ? "" : "s"}` : `${node.children.length + (node.cut ?? 0)} fields`;
    value.classList.add("is-summary");
  } else if (node.value === "" || node.value === "initial") {
    value.textContent = "initial";
    value.classList.add("is-initial");
  } else {
    value.textContent = node.length !== undefined ? `${node.value}… (${node.length} characters)` : node.value;
  }
  if (changedInside && !changes.has(path)) value.classList.add("has-change");
  if (changes.has(path)) {
    const mark = document.createElement("span");
    mark.className = "state-changed";
    mark.textContent = "changed";
    value.append(" ", mark);
  }

  item.append(toggle, name, type, value);
  const out = [item];
  if (open) {
    for (const child of node.children) out.push(...rows(child, `${path}/${child.name}`, depth + 1, changes));
    if (node.cut) {
      const more = document.createElement("li");
      more.className = "state-row state-more";
      more.style.setProperty("--depth", String(depth + 1));
      more.textContent = `… ${node.cut} more not shown`;
      out.push(more);
    }
  }
  return out;
}

// Every node by its path - `name`, `name/field`, `table/3/field` - and what
// it holds: its type and value, or for a container its type and size, so a
// table that grew is a change and so is every row that moved.
function flatten(nodes, prefix = "", out = new Map()) {
  for (const node of nodes) {
    const path = prefix === "" ? node.name : `${prefix}/${node.name}`;
    out.set(path, Array.isArray(node.children) ? `${node.type}#${node.rows ?? node.children.length}` : `${node.type}=${node.value}`);
    if (Array.isArray(node.children)) flatten(node.children, path, out);
  }
  return out;
}

// What differs from the state before - none at all when there is nothing to
// compare with (the app's first roundtrip, another app now in front).
function changedPaths(nodes, previous) {
  const changes = new Set();
  if (previous === undefined) return changes;
  for (const [path, held] of flatten(nodes)) {
    if (previous.get(path) !== held) changes.add(path);
  }
  return changes;
}
