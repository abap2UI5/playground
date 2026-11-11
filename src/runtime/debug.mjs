// The debugger's half in the runtime worker: `abap.dbg`, which the debug
// build of the reader's classes calls (src/editor/instrument.mjs writes the
// calls), and the commands the page sends while a program is stopped.
//
// How a stop works. Every transpiled method is async and awaited, so a
// statement can wait on a promise: `if ($dbg.hit(17)) await $dbg.stop(17)`
// waits until the page says go on, and while it waits the worker is idle and
// reads its messages - the commands below. Nothing blocks a thread, so no
// SharedArrayBuffer and no special headers.
//
// `hit( )` is the part every statement pays for, so it decides synchronously
// and says no in the common case; only `stop( )` is async. See
// docs/design/debugger.md for the measurements and the rest of the design.
//
// Everything that crosses to the page is plain data, and bounded.

import { typeOf as stateTypeOf } from "./app-state.mjs";

const inWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
const post = (message) => {
  if (inWorker) self.postMessage({ type: "debug", ...message });
};

// ------------------------------------------------------------------ state

/** file -> line -> condition (undefined: always) */
let breakpoints = new Map();
// What the program does when it is let go: run to the next breakpoint, or
// one of the steps - see stepDone( ).
let mode = "run";
let modeDepth = 0;
let cursor;
let pauseRequested = false;
let breakOnRaise = false;
// Held: nothing stops - the page's Stop restarts the app this way, or a
// BREAK-POINT in the app's start would stop the restart again. "roundtrip"
// holds until the next roundtrip has ended: the app's start, which comes
// after the classes are defined, the tests and the database reset.
let suspended = false;
// Whether the statement BREAK-POINT stops. Not on a page with no debugger
// to continue it - the AI App Builder's, where only its own tool sets
// breakpoints.
let breakStatements = true;
/** @type {{ id: number, path: string, target: any, frame: Frame, last: string }[]} */
let watchpoints = [];
// Any of the above that makes every statement worth a look.
let armed = false;
const rearm = () => {
  armed = mode !== "run" || pauseRequested || watchpoints.length > 0;
};

/** @type {Frame[]} the reader's methods running now, outermost first */
const stack = [];
/** @type {{ resolve: () => void, frame: Frame } | undefined} */
let paused;

// A program that runs for a long time only reads its messages - a Pause, a
// breakpoint set while it runs - if it gives the thread back now and then.
// Every thousandth statement looks at the clock, and past 100 ms the next
// stop( ) waits for one macrotask.
let ticks = 0;
let lastYield = 0;
const YIELD_MS = 100;
const yieldDue = () => inWorker && performance.now() - lastYield > YIELD_MS;
const nextTask = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });

// ------------------------------------------------------------------ frames

class Frame {
  constructor(me, info, scope) {
    this.me = me;
    this.info = info;
    this.scope = scope;
    this.line = info.start;
  }

  // Whether stop( ) has anything to decide here. Synchronous and cheap: a
  // Map lookup for the breakpoints, a counter for the clock.
  hit(line, raise) {
    this.line = line;
    if (suspended) return false;
    if (armed || (raise === 1 && breakOnRaise)) return true;
    const lines = breakpoints.get(this.info.file);
    if (lines !== undefined && lines.has(line)) return true;
    return (++ticks & 1023) === 0 && yieldDue();
  }

  // `kind`: 0 a statement, 1 a RAISE, 2 the statement BREAK-POINT.
  async stop(line, kind = 0) {
    this.line = line;
    const why = this.reason(line, kind);
    if (why !== undefined) return pauseAt(this, why.reason, why.detail);
    if (!yieldDue()) return;
    lastYield = performance.now();
    await nextTask();
    lastYield = performance.now();
    // What the page said meanwhile: a Pause, a breakpoint on this very line.
    const after = this.reason(line, kind);
    if (after !== undefined) return pauseAt(this, after.reason, after.detail);
  }

  reason(line, kind) {
    if (suspended) return undefined;
    if (kind === 2 && inWorker && breakStatements) return { reason: "break", detail: "BREAK-POINT" };
    if (pauseRequested) return { reason: "pause" };
    if (kind === 1 && breakOnRaise) return { reason: "raise", detail: "RAISE EXCEPTION" };
    if (stepDone(this, line)) return { reason: "step" };
    const lines = breakpoints.get(this.info.file);
    if (lines !== undefined && lines.has(line)) {
      const condition = lines.get(line);
      if (condition === undefined) return { reason: "breakpoint" };
      try {
        if (condition.test(this)) return { reason: "breakpoint", detail: `${condition.text} is true` };
      } catch (e) {
        return { reason: "breakpoint", detail: `the condition ${condition.text} could not be checked: ${message(e)}` };
      }
    }
    for (const w of watchpoints) {
      let now;
      try {
        now = fingerprint(w.target);
      } catch {
        continue;
      }
      if (now !== w.last) {
        const was = w.last;
        w.last = now;
        return { reason: "watch", detail: `${w.path} changed: ${shortValue(was)} → ${shortValue(now)}` };
      }
    }
    return undefined;
  }
}

function stepDone(frame, line) {
  switch (mode) {
    case "into":
      return true;
    case "over":
      return stack.length <= modeDepth;
    case "return":
      return stack.length < modeDepth;
    case "cursor":
      return cursor !== undefined && frame.info.file === cursor.file && line === cursor.line;
    default:
      return false;
  }
}

async function pauseAt(frame, reason, detail) {
  if (!inWorker) return;
  mode = "run";
  cursor = undefined;
  pauseRequested = false;
  rearm();
  post({
    event: "paused",
    reason,
    detail,
    file: frame.info.file,
    line: frame.line,
    frames: framesNow(),
    variables: variablesOf(stack.length - 1),
  });
  await new Promise((resolve) => {
    paused = { resolve, frame };
  });
  paused = undefined;
  lastYield = performance.now();
  post({ event: "resumed" });
}

function framesNow() {
  const out = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i];
    out.push({ index: i, cls: f.info.cls, method: f.info.method, file: f.info.file, line: f.line });
  }
  return out;
}

// What the transpiled code calls. `methods` registers a chunk's method table
// once, as the chunk is defined; `enter` and `leave` bracket every call of
// one of its methods (leave in a `finally`, so an exception unwinds the
// stack as well).
const dbg = {
  methods: (list) => list,
  enter(me, info, scope) {
    const frame = new Frame(me, info, scope);
    stack.push(frame);
    return frame;
  },
  leave(frame) {
    if (frame === undefined) return;
    const at = stack.lastIndexOf(frame);
    if (at !== -1) stack.length = at;
  },
};

export function installDebugger(abap) {
  abap.dbg = dbg;
}

// Called by the worker after each operation it ran to its end: a step that
// was still pending belongs to that operation and ends with it, or the next
// click in the app would stop on its first statement.
export function operationEnded(op) {
  if (suspended === "roundtrip" && op === "roundtrip") suspended = false;
  mode = "run";
  cursor = undefined;
  stack.length = 0;
  rearm();
}

// ---------------------------------------------------------------- commands

// The page's commands, by name - an allow list, as worker.mjs keeps for its
// operations. Each answers with a value or throws.
const COMMANDS = {
  // The whole set, replacing what was there: [{ file, line, condition? }].
  // Answers the conditions that do not parse.
  breakpoints({ list }) {
    const next = new Map();
    const problems = [];
    for (const bp of Array.isArray(list) ? list : []) {
      if (typeof bp?.file !== "string" || !Number.isInteger(bp.line)) continue;
      let condition;
      if (typeof bp.condition === "string" && bp.condition.trim() !== "") {
        try {
          condition = parseCondition(bp.condition.trim());
        } catch (e) {
          problems.push({ file: bp.file, line: bp.line, error: message(e) });
          continue;
        }
      }
      if (!next.has(bp.file)) next.set(bp.file, new Map());
      next.get(bp.file).set(bp.line, condition);
    }
    breakpoints = next;
    return problems;
  },
  options({ raise, suspend, statements }) {
    breakOnRaise = raise === true;
    breakStatements = statements !== false;
    suspended = suspend === "roundtrip" ? "roundtrip" : suspend === true;
    return true;
  },
  // A Pause asked for while nothing runs waits for the next statement that
  // does; this takes it back.
  unpause() {
    pauseRequested = false;
    rearm();
    return true;
  },
  pause() {
    if (paused) return true;
    pauseRequested = true;
    rearm();
    return true;
  },
  // Go on: `run` to the next breakpoint, or a step.
  resume({ how, file, line }) {
    if (!paused) return false;
    mode = ["into", "over", "return", "cursor"].includes(how) ? how : "run";
    modeDepth = stack.length;
    cursor = mode === "cursor" ? { file, line } : undefined;
    rearm();
    paused.resolve();
    return true;
  },
  // The variables of one frame of the stack (0 is the outermost).
  frame({ index }) {
    requirePaused();
    return variablesOf(index);
  },
  // The children of one node: a structure's fields, a block of a table's
  // rows, an object's attributes, what a reference points to.
  expand({ index, path, offset }) {
    requirePaused();
    return expand(frameAt(index), path, Number.isInteger(offset) ? offset : 0);
  },
  // A block of a table's rows as a grid, for the table view: one column per
  // component when the row is a structure, else one.
  table({ index, path, offset }) {
    requirePaused();
    const t = globalThis.abap.types;
    const data = deref(resolve(frameAt(index), path));
    if (!(data instanceof t.Table || data instanceof t.HashedTable)) throw new Error(`${path} is not a table`);
    const all = data.array();
    const from = Number.isInteger(offset) ? Math.max(0, offset) : 0;
    const columns = columnsOf(data);
    const cell = (value) => {
      const node = describeNode("", "", value);
      if (node.value !== undefined) return node.value;
      return node.open === "rows" ? `${node.size} rows` : `${node.size} fields`;
    };
    const rows = all.slice(from, from + TABLE_BLOCK).map((row) => {
      const at = row instanceof t.FieldSymbol ? deref(row) : row;
      if (columns && at instanceof t.Structure) {
        const fields = at.get();
        return columns.map((c) => cell(fields[c]));
      }
      return [cell(at)];
    });
    return { columns: columns ?? ["value"], rows, total: all.length, offset: from };
  },
  // Watches: each path's value now, or why there is none.
  watch({ index, paths }) {
    requirePaused();
    const frame = frameAt(index);
    return (Array.isArray(paths) ? paths : []).map((path) => {
      try {
        return { path, node: describeNode(path, path, resolve(frame, path)) };
      } catch (e) {
        return { path, error: message(e) };
      }
    });
  },
  // The value under the mouse in the editor.
  hover({ index, path }) {
    requirePaused();
    try {
      return describeNode(path, path, resolve(frameAt(index), path));
    } catch {
      return undefined;
    }
  },
  // A new value for an elementary variable, typed as text and converted the
  // way ABAP converts a string into the variable's type.
  set({ index, path, value }) {
    requirePaused();
    const target = deref(resolve(frameAt(index), path));
    const t = globalThis.abap.types;
    if (!isElementary(target)) throw new Error(`${path} is not an elementary value`);
    const source = new t.String().set(String(value));
    try {
      target.set(source);
    } catch (e) {
      throw new Error(`"${value}" is not a value for ${path}: ${message(e)}`, { cause: e });
    }
    return describeNode(path, path, target);
  },
  // Stop when a value changes: the path is resolved now, in the frame shown,
  // and what it names is watched from here on.
  watchpoints({ index, list }) {
    const frame = paused ? frameAt(index) : undefined;
    const next = [];
    for (const w of Array.isArray(list) ? list : []) {
      const kept = watchpoints.find((o) => o.id === w.id);
      if (kept) {
        next.push(kept);
        continue;
      }
      if (!frame) continue;
      try {
        const target = resolve(frame, w.path);
        next.push({ id: w.id, path: w.path, target, frame, last: fingerprint(target) });
      } catch (e) {
        throw new Error(`${w.path}: ${message(e)}`, { cause: e });
      }
    }
    watchpoints = next;
    rearm();
    return next.map((w) => w.id);
  },
};

export function debugCommand(data) {
  const { id, cmd, args } = data ?? {};
  const fn = Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : undefined;
  try {
    if (fn === undefined) throw new Error(`The debugger has no command called ${cmd}.`);
    post({ event: "reply", id, ok: true, value: fn(args ?? {}) });
  } catch (e) {
    post({ event: "reply", id, ok: false, error: message(e) });
  }
}

function requirePaused() {
  if (!paused) throw new Error("the program is not stopped");
}

function frameAt(index) {
  const frame = stack[Number.isInteger(index) ? index : stack.length - 1];
  if (frame === undefined) throw new Error("there is no such frame");
  return frame;
}

const message = (e) => String(e?.message ?? e);

// ---------------------------------------------------------------- values

const MAX_TEXT = 500;
const BLOCK = 50;
const TABLE_BLOCK = 200;
const SY_FIELDS = ["subrc", "tabix", "index", "dbcnt", "fdpos", "datum", "uzeit", "uname", "msgid", "msgty", "msgno", "msgv1", "msgv2", "msgv3", "msgv4"];
const PARAMETER = { I: "importing", E: "exporting", C: "changing", R: "returning" };
const VISIBILITY = { U: "public", O: "protected", I: "private" };

// A field symbol is shown as what it points to; the JavaScript name of
// `<lv>` is fs_lv_, and of a name that is a JavaScript keyword `$name`.
function displayName(js, value) {
  const t = globalThis.abap.types;
  if (value instanceof t.FieldSymbol) {
    const m = /^fs_(.+)_$/.exec(js);
    if (m) return `<${m[1]}>`;
  }
  return js.replace(/^\$/, "");
}

function variablesOf(index) {
  const frame = frameAt(index);
  const abap = globalThis.abap;
  const locals = [];
  const parameters = parametersOf(frame) ?? {};
  for (const js of frame.info.locals) {
    let value;
    try {
      value = frame.scope(js);
    } catch {
      continue; // not declared yet
    }
    if (value === undefined) continue;
    const name = displayName(js, value);
    const node = describeNode(name, name, value);
    const kind = PARAMETER[parameters[name.toUpperCase()]?.parm_kind];
    if (kind) node.kind = kind;
    locals.push(node);
  }
  const sy = abap.builtin?.sy?.get?.();
  const system = sy ? SY_FIELDS.filter((f) => sy[f] !== undefined).map((f) => describeNode(`sy-${f}`, `sy-${f}`, sy[f])) : [];
  return {
    index,
    cls: frame.info.cls,
    method: frame.info.method,
    file: frame.info.file,
    line: frame.line,
    locals,
    me: attributesOf(frame.me, isClass(frame.me) ? `${frame.info.cls}=>` : "me->"),
    staticMethod: isClass(frame.me),
    system,
  };
}

const isClass = (me) => typeof me === "function";

// A method's parameters as its class declares them - an interface's method
// (`zif_x~run`) as the interface does.
function parametersOf(frame) {
  const [owner, method] = frame.info.method.includes("~") ? frame.info.method.split("~") : [undefined, frame.info.method];
  const cls = owner ? globalThis.abap.Classes[owner] : classOf(frame.me);
  return cls?.METHODS?.[method]?.parameters;
}
const classOf = (me) => (isClass(me) ? me : me?.constructor);

// The attributes of an instance (or of a class: its static ones), in the
// order the classes declare them, inherited ones first. Constants are left
// out, as the State tab leaves them out.
function attributesOf(me, prefix) {
  const cls = classOf(me);
  if (!cls) return [];
  const chain = [];
  for (let c = cls; c && c.INTERNAL_NAME; c = Object.getPrototypeOf(c)) chain.unshift(c);
  const seen = new Set();
  const out = [];
  for (const c of chain) {
    for (const [upper, meta] of Object.entries(c.ATTRIBUTES ?? {})) {
      if (upper.includes("~") || meta?.is_constant === "X" || seen.has(upper)) continue;
      const isStatic = meta?.is_class === "X";
      if (isClass(me) && !isStatic) continue;
      seen.add(upper);
      const name = upper.toLowerCase();
      const value = attribute(me, name);
      if (value === undefined) continue;
      const node = describeNode(name, `${prefix}${name}`, value);
      node.visibility = VISIBILITY[meta?.visibility] ?? "public";
      if (isStatic) node.static = true;
      out.push(node);
    }
  }
  return out;
}

function attribute(instance, name) {
  if (isClass(instance)) return instance[name] ?? instance.FRIENDS_ACCESS_STATIC?.[name];
  const value = instance?.FRIENDS_ACCESS_INSTANCE?.[name] ?? instance?.[name];
  if (typeof value === "function") return undefined;
  if (value !== undefined) return value;
  const cls = instance?.constructor;
  return cls?.[name];
}

function isElementary(data) {
  const t = globalThis.abap.types;
  return !(data instanceof t.Structure || data instanceof t.Table || data instanceof t.HashedTable ||
    data instanceof t.ABAPObject || data instanceof t.DataReference || data instanceof t.FieldSymbol) &&
    typeof data?.get === "function";
}

function deref(data) {
  const t = globalThis.abap.types;
  let at = data;
  for (let hops = 0; at instanceof t.FieldSymbol && hops < 10; hops++) {
    if (!at.isAssigned()) throw new Error("the field symbol is not assigned");
    at = at.getPointer();
  }
  return at;
}

/** A value as a row of the tree: elementary, or a container to open. */
function describeNode(name, path, data) {
  const t = globalThis.abap.types;
  const node = { name, path, type: typeOf(data) };
  if (data instanceof t.FieldSymbol) {
    if (!data.isAssigned()) {
      node.value = "unassigned";
      node.initial = true;
      return node;
    }
    const inner = describeNode(name, path, data.getPointer());
    inner.fieldSymbol = true;
    return inner;
  }
  if (data instanceof t.Structure) {
    node.open = "fields";
    node.size = Object.keys(data.get()).length;
    return node;
  }
  if (data instanceof t.Table || data instanceof t.HashedTable) {
    node.open = "rows";
    node.size = data.array().length;
    return node;
  }
  if (data instanceof t.ABAPObject) {
    const target = data.get();
    if (target) {
      node.value = `→ ${target.constructor?.INTERNAL_NAME ?? target.constructor?.name ?? "object"}`;
      node.open = "attributes";
    } else {
      node.value = "initial";
      node.initial = true;
    }
    return node;
  }
  if (data instanceof t.DataReference) {
    const target = data.getPointer?.();
    if (target) {
      node.value = `→ ${typeOf(target)}`;
      node.open = "target";
    } else {
      node.value = "initial";
      node.initial = true;
    }
    return node;
  }
  let text;
  try {
    const raw = data.get();
    text = typeof raw === "string" ? raw.trimEnd() : String(raw);
  } catch {
    text = "?";
  }
  if (text.length > MAX_TEXT) {
    node.length = text.length;
    text = text.slice(0, MAX_TEXT);
  }
  node.value = text;
  node.editable = true;
  try {
    if (globalThis.abap.compare.initial(data)) node.initial = true;
  } catch {
    // a type compare does not know - shown as it is
  }
  return node;
}

function expand(frame, path, offset) {
  const t = globalThis.abap.types;
  const data = deref(resolve(frame, path));
  if (data instanceof t.Structure) {
    return { children: Object.entries(data.get()).map(([field, value]) => describeNode(field, `${path}-${field}`, value)) };
  }
  if (data instanceof t.Table || data instanceof t.HashedTable) {
    const rows = data.array();
    const children = rows.slice(offset, offset + BLOCK).map((row, i) => describeNode(String(offset + i + 1), `${path}[${offset + i + 1}]`, row));
    return { children, total: rows.length, offset, columns: columnsOf(data) };
  }
  if (data instanceof t.ABAPObject) {
    const target = data.get();
    if (!target) return { children: [] };
    return { children: attributesOf(target, `${path}->`) };
  }
  if (data instanceof t.DataReference) {
    const target = data.getPointer?.();
    return { children: target ? [describeNode("*", `${path}->*`, target)] : [] };
  }
  throw new Error(`${path} has nothing to open`);
}

// A table's columns, when its row is a structure - for the table view.
function columnsOf(table) {
  const t = globalThis.abap.types;
  const row = table.getRowType?.();
  if (row instanceof t.Structure) return Object.keys(row.get());
  return undefined;
}

// ------------------------------------------------------------------ paths

// A variable as the reader writes it: `lv_x`, `<fs>`, `ls_s-comp`,
// `lt_t[ 3 ]-field`, `me->attr`, `lo_obj->attr`, `lr_ref->*`, `sy-subrc`,
// `zcl_x=>attr`. Parsed into a root and steps; nothing of it is evaluated
// as code.
export function parsePath(text) {
  const src = String(text).trim();
  const root = /^(<[\w/$]+>|[\w/$]+=>[\w/$]+|[\w/$]+)/i.exec(src);
  if (!root) throw new Error(`"${src}" is not a variable`);
  const steps = [];
  let rest = src.slice(root[0].length);
  while (rest.length > 0) {
    let m;
    if ((m = /^->\*/.exec(rest))) steps.push({ deref: true });
    else if ((m = /^->([\w/$~]+)/.exec(rest))) steps.push({ attr: m[1].toLowerCase() });
    else if ((m = /^-([\w/$]+)/.exec(rest))) steps.push({ field: m[1].toLowerCase() });
    else if ((m = /^\[\s*(\d+)\s*\]/.exec(rest))) steps.push({ index: Number(m[1]) });
    else throw new Error(`cannot read "${rest}" in ${src}`);
    rest = rest.slice(m[0].length);
  }
  return { root: root[1].toLowerCase(), steps };
}

function resolve(frame, text) {
  const t = globalThis.abap.types;
  const { root, steps } = parsePath(text);
  let at = rootValue(frame, root);
  for (const step of steps) {
    if (at instanceof t.FieldSymbol) at = deref(at);
    if (step.field !== undefined) {
      if (!(at instanceof t.Structure)) throw new Error(`${text}: not a structure before -${step.field}`);
      const value = at.get()[step.field];
      if (value === undefined) throw new Error(`${text}: no component ${step.field}`);
      at = value;
    } else if (step.index !== undefined) {
      if (!(at instanceof t.Table || at instanceof t.HashedTable)) throw new Error(`${text}: not a table before [ ${step.index} ]`);
      const value = at.array()[step.index - 1];
      if (value === undefined) throw new Error(`${text}: the table has ${at.array().length} rows`);
      at = value;
    } else if (step.deref) {
      if (!(at instanceof t.DataReference)) throw new Error(`${text}: not a data reference before ->*`);
      const value = at.getPointer();
      if (!value) throw new Error(`${text}: the reference is initial`);
      at = value;
    } else if (step.attr !== undefined) {
      const instance = at instanceof t.ABAPObject ? at.get() : at && at.isMe ? at.instance : undefined;
      if (!instance) throw new Error(`${text}: not a bound object reference before ->${step.attr}`);
      const value = attribute(instance, step.attr);
      if (value === undefined) throw new Error(`${text}: no attribute ${step.attr}`);
      at = value;
    }
  }
  if (at && at.isMe) throw new Error(`${text} is an object - open it in the tree`);
  return at;
}

function rootValue(frame, root) {
  if (root === "me") return { isMe: true, instance: frame.me };
  if (root === "sy") return globalThis.abap.builtin.sy;
  if (root.includes("=>")) {
    const [clsName, attr] = root.split("=>");
    // The frame's own class first: a local class (a test class) is not
    // registered under its plain name.
    const own = isClass(frame.me) && frame.info.cls.toLowerCase() === clsName ? frame.me : undefined;
    const cls = own ?? globalThis.abap.Classes[clsName.toUpperCase()];
    if (!cls) throw new Error(`no class ${clsName}`);
    const value = attribute(cls, attr);
    if (value === undefined) throw new Error(`${clsName} has no static attribute ${attr}`);
    return value;
  }
  // sy-subrc and its kind: the root is `sy`, the rest a component.
  for (const js of frame.info.locals) {
    let value;
    try {
      value = frame.scope(js);
    } catch {
      continue;
    }
    if (displayName(js, value).toLowerCase() === root) return value;
  }
  // An attribute without `me->`, as ABAP lets a method write it.
  const own = attribute(frame.me, root.replace(/^<|>$/g, ""));
  if (own !== undefined) return own;
  throw new Error(`${root} is not known here`);
}

// ------------------------------------------------------------- conditions

const OPS = { "=": "eq", EQ: "eq", "<>": "ne", NE: "ne", "<": "lt", LT: "lt", ">": "gt", GT: "gt", "<=": "le", LE: "le", ">=": "ge", GE: "ge" };

// `path op literal`, `path op path`, `path IS [NOT] INITIAL` - the shape a
// breakpoint's condition takes. A literal is a number, '…' or `…`,
// abap_true, abap_false or space.
export function parseCondition(text) {
  const initial = /^(.+?)\s+IS\s+(NOT\s+)?INITIAL$/i.exec(text);
  if (initial) {
    const path = initial[1].trim();
    parsePath(path);
    const not = Boolean(initial[2]);
    return {
      text,
      test: (frame) => {
        const value = deref(resolve(frame, path));
        return globalThis.abap.compare.initial(value) !== not;
      },
    };
  }
  const m = /^(.+?)\s*(<>|<=|>=|=|<|>|\s(?:EQ|NE|LT|GT|LE|GE)\s)\s*(.+)$/i.exec(text);
  if (!m) throw new Error(`"${text}" is not a condition - write it as  lv_x = 5,  lv_x > lv_y  or  lv_x IS INITIAL`);
  const left = m[1].trim();
  parsePath(left);
  const op = OPS[m[2].trim().toUpperCase()];
  const right = m[3].trim();
  const literal = literalOf(right);
  if (literal === undefined) parsePath(right);
  return {
    text,
    test: (frame) => {
      const a = deref(resolve(frame, left));
      const b = literal !== undefined ? literal() : deref(resolve(frame, right));
      return Boolean(globalThis.abap.compare[op](a, b));
    },
  };
}

function literalOf(text) {
  const t = () => globalThis.abap.types;
  if (/^-?\d+$/.test(text)) return () => new (t().Integer)().set(Number(text));
  if (/^-?\d+\.\d+$/.test(text)) return () => new (t().Float)().set(Number(text));
  const quoted = /^'(.*)'$/.exec(text) ?? /^`(.*)`$/.exec(text);
  if (quoted) return () => new (t().String)().set(quoted[1]);
  if (/^abap_true$/i.test(text)) return () => new (t().Character)(1).set("X");
  if (/^(abap_false|space)$/i.test(text)) return () => new (t().Character)(1).set("");
  return undefined;
}

// --------------------------------------------------------------- helpers

// A value as a short string that changes when it changes - for watchpoints,
// compared after every statement while one is set, so it is bounded.
function fingerprint(data, depth = 0) {
  const t = globalThis.abap.types;
  if (data instanceof t.FieldSymbol) return data.isAssigned() ? fingerprint(data.getPointer(), depth) : "<unassigned>";
  if (data instanceof t.Structure) {
    if (depth > 3) return "{…}";
    return `{${Object.values(data.get()).map((v) => fingerprint(v, depth + 1)).join("|")}}`;
  }
  if (data instanceof t.Table || data instanceof t.HashedTable) {
    const rows = data.array();
    if (depth > 2) return `[${rows.length}]`;
    return `[${rows.length}:${rows.slice(0, 50).map((r) => fingerprint(r, depth + 1)).join(",")}]`;
  }
  if (data instanceof t.ABAPObject) return `obj:${data.get()?.INTERNAL_ID ?? "initial"}`;
  if (data instanceof t.DataReference) return `ref:${data.getPointer() ? "bound" : "initial"}`;
  const raw = data?.get?.();
  return typeof raw === "string" ? raw.trimEnd() : String(raw);
}

function shortValue(fp) {
  if (fp.startsWith("[")) return `${/^\[(\d+)/.exec(fp)?.[1] ?? "?"} rows`;
  if (fp.startsWith("{")) return "(structure)";
  return fp.length > 40 ? `${fp.slice(0, 40)}…` : fp === "" ? "initial" : fp;
}

// The type as ABAP writes it - the State tab's words (app-state.mjs), and a
// field symbol as what it points to.
function typeOf(data) {
  const t = globalThis.abap.types;
  if (data instanceof t.FieldSymbol) return data.isAssigned() ? typeOf(data.getPointer()) : "field-symbol";
  return stateTypeOf(t, data);
}
