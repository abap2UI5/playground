// The debugger on the page: breakpoints, the stop, stepping, the stack, the
// variables, watches - a chunk (src/shell/debug.mjs fetches it), so what it
// needs of the page is handed to setUpDebugger( ) and never imported: a
// chunk that imports a shell module splits the shell (load-time.md).
//
// The worker's half is src/runtime/debug.mjs; the hooks it answers are
// written into the reader's classes by src/editor/instrument.mjs. The whole
// design, and what was measured, is in docs/design/debugger.md.

const STORE = "abap2ui5-playground:breakpoints";

// The keys of the SAP debugger, so a hand that knows them finds them here.
const KEYS = { F5: "into", F6: "over", F7: "return", F8: "run" };

/**
 * @param {{
 *   runtime: () => any,
 *   editor: any,
 *   redraw: () => void,
 *   redrawIf: (...views: string[]) => void,
 *   showTab: () => void,
 *   empty: (text: string) => HTMLElement,
 *   blockHead: (text: string, ...buttons: HTMLElement[]) => HTMLElement,
 *   setStatus: (text: string, isError?: boolean) => void,
 *   storage: { read: (key: string) => any, write: (key: string, value: any) => void },
 *   dot: HTMLElement | null,
 * }} page
 */
export function setUpDebugger(page) {
  const { editor } = page;
  const rt = () => page.runtime();

  // ---------------------------------------------------------- breakpoints

  /** @type {{ id: number, file: string, line: number, condition: string, enabled: boolean, verified?: boolean, problem?: string }[]} */
  let breakpoints = [];
  let nextId = 1;
  /** per file, each method's stoppable lines - from the last debug build */
  let stops = {};
  let debugProblems = [];

  function restore() {
    const stored = page.storage.read(STORE);
    const open = new Map(editor.getFiles().map((f) => [f.name, f.source.split("\n").length]));
    if (!stored || typeof stored !== "object" || stored.v !== 1 || typeof stored.files !== "object") return;
    for (const [file, list] of Object.entries(stored.files)) {
      const lines = open.get(file);
      if (lines === undefined || !Array.isArray(list)) continue;
      for (const bp of list.slice(0, 200)) {
        if (!Number.isInteger(bp?.line) || bp.line < 1 || bp.line > lines) continue;
        if (breakpoints.some((b) => b.file === file && b.line === bp.line)) continue;
        breakpoints.push({
          id: nextId++,
          file,
          line: bp.line,
          condition: typeof bp.condition === "string" ? bp.condition.slice(0, 200) : "",
          enabled: bp.enabled !== false,
        });
      }
    }
  }

  function store() {
    const files = {};
    for (const bp of breakpoints) {
      (files[bp.file] ??= []).push({ line: bp.line, ...(bp.condition ? { condition: bp.condition } : {}), ...(bp.enabled ? {} : { enabled: false }) });
    }
    page.storage.write(STORE, breakpoints.length === 0 ? null : { v: 1, files });
  }

  // Draws them, keeps them, and tells the worker - the whole set each time.
  async function changed({ send = true } = {}) {
    const open = new Set(editor.getFiles().map((f) => f.name));
    breakpoints = breakpoints.filter((bp) => open.has(bp.file));
    editor.showBreakpoints(breakpoints);
    store();
    page.redrawIf("debug");
    if (!send) return;
    const list = breakpoints.filter((bp) => bp.enabled && bp.verified !== false).map(({ file, line, condition }) => ({ file, line, condition }));
    try {
      const problems = await rt()?.debug("breakpoints", { list });
      for (const bp of breakpoints) bp.problem = undefined;
      for (const p of problems ?? []) {
        const bp = breakpoints.find((b) => b.file === p.file && b.line === p.line);
        if (bp) bp.problem = p.error;
      }
      if ((problems ?? []).length > 0) page.redrawIf("debug");
    } catch {
      // A worker that is restarting gets the set replayed (runtime-client.mjs).
    }
  }

  function toggle(file, line) {
    const at = breakpoints.findIndex((bp) => bp.file === file && bp.line === line);
    if (at !== -1) breakpoints.splice(at, 1);
    else {
      const bp = { id: nextId++, file, line, condition: "", enabled: true };
      verify(bp);
      breakpoints.push(bp);
    }
    changed();
  }

  // Edits move the marks in the editor; the list follows them. What runs is
  // still the last Run's build, so a moved breakpoint is "not checked" until
  // the next Run says where the statements are.
  function moved() {
    let any = false;
    for (const { id, line } of editor.breakpointPositions()) {
      const bp = breakpoints.find((b) => b.id === id);
      if (bp && bp.line !== line) {
        bp.line = line;
        any = true;
      }
    }
    // Two marks that ended on one line are one breakpoint.
    const seen = new Set();
    breakpoints = breakpoints.filter((bp) => {
      const key = `${bp.file}:${bp.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (any) changed();
  }

  // A breakpoint on a line the debugger cannot stop at - a comment, a DATA,
  // an ELSE - moves to the next statement of the same method, as SAP's
  // does; outside any method it stays, hollow, and is not sent.
  function verify(bp) {
    const methods = stops[bp.file];
    if (!methods) {
      bp.verified = Object.keys(stops).length === 0 ? undefined : false;
      return;
    }
    const method = methods.find((m) => bp.line >= m.start && bp.line <= m.end);
    if (!method) {
      bp.verified = false;
      return;
    }
    if (method.lines.includes(bp.line)) {
      bp.verified = true;
      return;
    }
    const next = method.lines.find((l) => l > bp.line);
    if (next !== undefined && !breakpoints.some((b) => b !== bp && b.file === bp.file && b.line === next)) {
      bp.line = next;
      bp.verified = true;
    } else {
      bp.verified = false;
    }
  }

  // ------------------------------------------------------------- the stop

  /** @type {any} the last `paused` event, while stopped */
  let stop;
  let frameIndex;
  /** @type {any} the variables of the frame shown */
  let variables;
  let reason = "";
  /** path -> value at the stop before, for "changed" */
  let previous = new Map();
  let current = new Map();
  /** path -> { children, total } of opened containers, for this stop */
  let expanded = new Map();
  const opened = new Set();
  let breakOnRaise = false;

  /** @type {{ id: number, path: string, onChange: boolean, node?: any, error?: string }[]} */
  let watches = [];
  let nextWatch = 1;

  function remember(nodes) {
    for (const n of nodes) if (n.value !== undefined || n.size !== undefined) current.set(n.path, n.value ?? `#${n.size}`);
  }

  async function onDebug(message) {
    if (message.event === "paused") {
      previous = current;
      current = new Map();
      expanded = new Map();
      stop = message;
      frameIndex = message.frames[0]?.index;
      variables = message.variables;
      remember([...variables.locals, ...variables.me, ...variables.system]);
      reason = describeReason(message);
      editor.setDebugLock(true);
      editor.markExecution([{ file: message.file, line: message.line, kind: "current" }]);
      page.setStatus(`stopped at line ${message.line} of ${message.file} - ${reason}. F8 continues`);
      if (page.dot) page.dot.textContent = "●";
      page.showTab();
      await refreshWatches();
      page.redrawIf("debug");
      // For the tests, and for anybody watching the page with tools.
      document.documentElement.dataset.debugger = "stopped";
    } else if (message.event === "resumed" || message.event === "stopped") {
      stop = undefined;
      variables = undefined;
      editor.markExecution([]);
      editor.setDebugLock(false);
      if (page.dot) page.dot.textContent = "";
      if (message.event === "stopped") page.setStatus("the program was stopped in the debugger - Run starts the app again", true);
      else page.setStatus("running");
      document.documentElement.dataset.debugger = "running";
      // A step stops again in a moment; not redrawn in between, so the tab
      // does not blink through "running" on every F6.
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (!stop) page.redrawIf("debug");
      }, 150);
    }
  }
  let settle;

  function describeReason(m) {
    const what = {
      break: "BREAK-POINT",
      breakpoint: "breakpoint",
      step: "step",
      pause: "paused",
      watch: "watchpoint",
      raise: "RAISE EXCEPTION",
    }[m.reason] ?? m.reason;
    return m.detail && m.reason !== "break" ? `${what}: ${m.detail}` : what;
  }

  function resume(how) {
    if (!stop) return;
    const args = { how };
    if (how === "cursor") {
      const at = editor.caretPosition();
      if (!at) return;
      Object.assign(args, at);
    }
    rt()?.debug("resume", args).catch(() => {});
  }

  function stopProgram() {
    if (!stop) return;
    rt()?.stopProgram();
  }

  async function showFrame(index) {
    if (!stop) return;
    frameIndex = index;
    try {
      variables = await rt().debug("frame", { index });
    } catch {
      return;
    }
    expanded = new Map();
    const top = stop.frames[0];
    const spots = [{ file: top.file, line: top.line, kind: "current" }];
    if (index !== top.index) spots.push({ file: variables.file, line: variables.line, kind: "frame", reveal: true });
    editor.markExecution(spots);
    await refreshWatches();
    page.redrawIf("debug");
  }

  async function expand(path, offset = 0) {
    try {
      const block = await rt().debug("expand", { index: frameIndex, path, offset });
      const had = expanded.get(path);
      if (had && offset > 0) block.children = [...had.children, ...block.children];
      expanded.set(path, block);
      remember(block.children);
    } catch (e) {
      expanded.set(path, { children: [], error: String(e?.message ?? e) });
    }
    page.redrawIf("debug");
  }

  async function setValue(path, value) {
    try {
      const node = await rt().debug("set", { index: frameIndex, path, value });
      replaceNode(path, node);
      current.set(path, node.value);
      page.setStatus(`${path} is now ${node.value === "" ? "initial" : node.value}`);
    } catch (e) {
      page.setStatus(String(e?.message ?? e), true);
    }
    await refreshWatches();
    page.redrawIf("debug");
  }

  function replaceNode(path, node) {
    for (const list of [variables?.locals, variables?.me, variables?.system, ...[...expanded.values()].map((b) => b.children)]) {
      const at = list?.findIndex((n) => n.path === path) ?? -1;
      if (at !== -1) list[at] = { ...list[at], ...node, name: list[at].name, kind: list[at].kind };
    }
  }

  async function refreshWatches() {
    if (!stop || watches.length === 0) return;
    try {
      const values = await rt().debug("watch", { index: frameIndex, paths: watches.map((w) => w.path) });
      for (const w of watches) {
        const v = values.find((x) => x.path === w.path);
        w.node = v?.node;
        w.error = v?.error;
      }
    } catch {
      // stopped meanwhile
    }
  }

  async function sendWatchpoints() {
    try {
      const kept = await rt().debug("watchpoints", {
        index: frameIndex,
        list: watches.filter((w) => w.onChange).map((w) => ({ id: w.id, path: w.path })),
      });
      for (const w of watches) if (w.onChange && !kept.includes(w.id)) w.onChange = false;
    } catch (e) {
      for (const w of watches) if (w.onChange && !w.sent) w.onChange = false;
      page.setStatus(String(e?.message ?? e), true);
    }
    for (const w of watches) w.sent = w.onChange;
    page.redrawIf("debug");
  }

  // ------------------------------------------------------------- the tab

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, title, onClick, { disabled = false, cls = "" } = {}) => {
    const b = /** @type {HTMLButtonElement} */ (el("button", `debug-button ${cls}`.trim(), text));
    b.type = "button";
    b.title = title;
    b.disabled = disabled;
    b.addEventListener("click", onClick);
    return b;
  };

  function tab() {
    const wrap = el("div", "debugger");
    wrap.append(toolbar());
    if (stop) {
      const where = el("p", "debug-where");
      where.append(el("strong", "", `${reason}`), ` - line ${stop.line} of ${stop.file}`);
      wrap.append(where);
    } else {
      wrap.append(page.empty(
        breakpoints.length === 0
          ? "Not stopped. Click left of a line number (or press F9) to set a breakpoint, or write BREAK-POINT - the program stops there the next time it runs, and its variables show here."
          : "Not stopped. The program stops at a breakpoint the next time it reaches one - a click in the app, or Run.",
      ));
    }
    if (debugProblems.length > 0) {
      wrap.append(el("p", "state-note", `No breakpoints in ${debugProblems.map((p) => p.split(":")[0]).join(", ")} - the debug build of it failed and the plain one runs.`));
    }
    const columns = el("div", "debug-columns");
    const side = el("div", "debug-side");
    if (stop) side.append(stackView());
    side.append(breakpointsView(), watchesView());
    columns.append(side);
    if (stop && variables) columns.append(variablesView());
    wrap.append(columns);
    return wrap;
  }

  function toolbar() {
    const bar = el("div", "debug-bar");
    const off = !stop;
    bar.append(
      button("▶ Continue", "Continue to the next breakpoint (F8)", () => resume("run"), { disabled: off, cls: "is-primary" }),
      button("↴ Into", "Step into: the next statement, into a method it calls (F5)", () => resume("into"), { disabled: off }),
      button("↷ Over", "Step over: the next statement of this method (F6)", () => resume("over"), { disabled: off }),
      button("↑ Return", "Return: run to the end of this method (F7)", () => resume("return"), { disabled: off }),
      button("⇥ To cursor", "Run to the line the cursor is on", () => resume("cursor"), { disabled: off }),
      button("■ Stop", "Stop the program (Shift+F8) - the app ends; Run starts it again", stopProgram, { disabled: off }),
      button("⏸ Pause", "Stop at the next ABAP statement that runs - in a loop that is running now, or at the next click in the app", () => {
        rt()?.debug("pause").catch(() => {});
        page.setStatus("the debugger stops at the next statement that runs");
      }, { disabled: !off }),
    );
    const raise = el("label", "debug-option");
    const box = /** @type {HTMLInputElement} */ (el("input"));
    box.type = "checkbox";
    box.checked = breakOnRaise;
    box.addEventListener("change", () => {
      breakOnRaise = box.checked;
      rt()?.debug("options", { raise: breakOnRaise }).catch(() => {});
    });
    raise.append(box, " stop at RAISE EXCEPTION");
    bar.append(raise);
    return bar;
  }

  function stackView() {
    const box = el("section", "debug-box");
    box.append(page.blockHead("Call stack"));
    const list = el("ol", "debug-stack");
    for (const f of stop.frames) {
      const item = el("li");
      const b = button(`${f.cls}->${f.method.toLowerCase()}`, `${f.file} line ${f.line}`, () => showFrame(f.index), { cls: f.index === frameIndex ? "is-current" : "" });
      b.append(el("span", "debug-at", ` line ${f.line}`));
      item.append(b);
      list.append(item);
    }
    const note = el("li", "debug-framework", "… abap2UI5 (not stepped into)");
    list.append(note);
    box.append(list);
    return box;
  }

  function breakpointsView() {
    const box = el("section", "debug-box");
    const clear = button("Remove all", "Remove every breakpoint", () => {
      breakpoints = [];
      changed();
    }, { disabled: breakpoints.length === 0 });
    box.append(page.blockHead(`Breakpoints${breakpoints.length ? ` (${breakpoints.length})` : ""}`, clear));
    if (breakpoints.length === 0) return box;
    const list = el("ul", "debug-list");
    for (const bp of [...breakpoints].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      const row = el("li", `debug-bp${bp.verified === false ? " is-unverified" : ""}`);
      const on = /** @type {HTMLInputElement} */ (el("input"));
      on.type = "checkbox";
      on.checked = bp.enabled;
      on.title = "On or off";
      on.addEventListener("change", () => {
        bp.enabled = on.checked;
        changed();
      });
      const where = el("button", "debug-link", `${bp.file.replace(/\.clas\.(testclasses\.)?abap$/, "")}:${bp.line}`);
      where.dataset.file = bp.file;
      where.dataset.line = String(bp.line);
      where.title = bp.verified === false ? "Not on a statement the debugger can stop at" : "Show the line";
      const condition = /** @type {HTMLInputElement} */ (el("input", "debug-condition"));
      condition.placeholder = "condition, e.g. lv_x > 5";
      condition.value = bp.condition;
      condition.title = "Stop only when this is true: lv_x = 5, lv_x <> lv_y, ls_s-comp IS INITIAL";
      condition.setAttribute("aria-label", `Condition of the breakpoint at line ${bp.line}`);
      condition.addEventListener("change", () => {
        bp.condition = condition.value.trim();
        changed();
      });
      const remove = button("✕", "Remove", () => {
        breakpoints = breakpoints.filter((b) => b !== bp);
        changed();
      }, { cls: "is-icon" });
      row.append(on, where, condition, remove);
      if (bp.problem) row.append(el("span", "debug-problem", bp.problem));
      list.append(row);
    }
    box.append(list);
    return box;
  }

  function watchesView() {
    const box = el("section", "debug-box");
    box.append(page.blockHead("Watches"));
    const form = el("form", "debug-add");
    const input = /** @type {HTMLInputElement} */ (el("input", "debug-condition"));
    input.placeholder = "lv_x, ls_s-comp, lt_t[ 1 ], me->attr";
    input.setAttribute("aria-label", "A variable to watch");
    form.append(input, button("Add", "Watch this variable", () => {}));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const path = input.value.trim();
      if (path === "" || watches.some((w) => w.path === path)) return;
      watches.push({ id: nextWatch++, path, onChange: false });
      await refreshWatches();
      page.redrawIf("debug");
    });
    /** @type {HTMLButtonElement} */ (form.querySelector("button")).type = "submit";
    box.append(form);
    const list = el("ul", "debug-list");
    for (const w of watches) {
      const row = el("li", "debug-watch");
      row.append(el("code", "", w.path));
      const value = el("span", "state-value");
      if (!stop) value.textContent = "-";
      else if (w.error) {
        value.textContent = w.error;
        value.classList.add("is-initial");
      } else if (w.node) {
        value.textContent = w.node.value ?? (w.node.open === "rows" ? `${w.node.size} rows` : `${w.node.size} fields`);
        if (current.size && previous.has(w.path) && previous.get(w.path) !== (w.node.value ?? `#${w.node.size}`)) row.classList.add("is-changed");
      }
      const watchBox = el("label", "debug-option");
      const on = /** @type {HTMLInputElement} */ (el("input"));
      on.type = "checkbox";
      on.checked = w.onChange;
      on.disabled = !stop && !w.onChange;
      watchBox.title = stop || w.onChange ? "Stop as soon as this value changes (a watchpoint)" : "Set while the program is stopped - the variable is looked up where it stopped";
      on.addEventListener("change", () => {
        w.onChange = on.checked;
        sendWatchpoints();
      });
      watchBox.append(on, " stop on change");
      const remove = button("✕", "Remove", () => {
        watches = watches.filter((x) => x !== w);
        if (w.onChange) sendWatchpoints();
        else page.redrawIf("debug");
      }, { cls: "is-icon" });
      row.append(value, watchBox, remove);
      list.append(row);
    }
    box.append(list);
    return box;
  }

  function variablesView() {
    const box = el("section", "debug-box debug-variables");
    const where = `${variables.cls}->${variables.method.toLowerCase()}`;
    box.append(page.blockHead(`Variables of ${where}`));
    const groups = [
      ["Locals and parameters", variables.locals, "locals"],
      [variables.staticMethod ? `Static attributes of ${variables.cls}` : `me (${variables.cls})`, variables.me, "me"],
      ["System fields", variables.system, "sy"],
    ];
    for (const [title, nodes, key] of groups) {
      const head = el("p", "debug-group", title);
      box.append(head);
      if (nodes.length === 0) {
        box.append(el("p", "state-note", key === "locals" ? "none" : "none"));
        continue;
      }
      const list = el("ul", "state-list");
      list.setAttribute("role", "tree");
      list.setAttribute("aria-label", title);
      for (const node of nodes) list.append(...rows(node, 0));
      box.append(list);
    }
    return box;
  }

  function rows(node, depth) {
    const container = node.open !== undefined;
    const open = container && opened.has(node.path) && expanded.has(node.path);
    const item = el("li", "state-row");
    item.setAttribute("role", "treeitem");
    item.style.setProperty("--depth", String(depth));
    const value = node.value ?? `#${node.size}`;
    if (previous.has(node.path) && previous.get(node.path) !== value) item.classList.add("is-changed");
    if (container) item.setAttribute("aria-expanded", String(open));

    const toggleEl = el(container ? "button" : "span", "state-toggle");
    if (container) {
      /** @type {HTMLButtonElement} */ (toggleEl).type = "button";
      toggleEl.textContent = open ? "▾" : "▸";
      toggleEl.dataset.focus = `debug ${node.path}`;
      toggleEl.setAttribute("aria-label", `${open ? "Close" : "Open"} ${node.name}`);
      toggleEl.addEventListener("click", () => {
        if (open) {
          opened.delete(node.path);
          page.redrawIf("debug");
        } else {
          opened.add(node.path);
          if (expanded.has(node.path)) page.redrawIf("debug");
          else expand(node.path);
        }
      });
    }
    const name = el("span", "state-name", depth > 0 && /^\d+$/.test(node.name) ? `[${node.name}]` : node.name);
    name.title = node.path;
    const type = el("span", "state-type", [node.kind, node.type, node.visibility && node.visibility !== "public" ? node.visibility : ""].filter(Boolean).join(" · "));
    type.title = type.textContent;
    const valueEl = el("span", "state-value");
    if (node.open === "rows" || node.open === "fields") {
      valueEl.textContent = node.open === "rows" ? `${node.size} row${node.size === 1 ? "" : "s"}` : `${node.size} fields`;
      valueEl.classList.add("is-summary");
      if (node.open === "rows" && node.size > 0) {
        valueEl.append(" ", button("⊞ table", "Show the rows as a table", () => tableView(node)));
      }
    } else if (node.initial && (node.value === "" || node.value === "initial" || node.value === "unassigned")) {
      valueEl.textContent = node.value === "unassigned" ? "unassigned" : "initial";
      valueEl.classList.add("is-initial");
    } else {
      valueEl.textContent = node.length !== undefined ? `${node.value}… (${node.length} characters)` : node.value;
    }
    if (node.editable) {
      valueEl.classList.add("is-editable");
      valueEl.title = "Double-click to change the value";
      valueEl.tabIndex = 0;
      const edit = () => editValue(valueEl, node);
      valueEl.addEventListener("dblclick", edit);
      valueEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          edit();
        }
      });
    }
    item.append(toggleEl, name, type, valueEl);
    const out = [item];
    if (open) {
      const block = expanded.get(node.path);
      if (block.error) {
        const note = el("li", "state-row state-more", block.error);
        note.style.setProperty("--depth", String(depth + 1));
        out.push(note);
      }
      for (const child of block.children) out.push(...rows(child, depth + 1));
      if (block.total !== undefined && block.children.length < block.total) {
        const more = el("li", "state-row state-more");
        more.style.setProperty("--depth", String(depth + 1));
        more.append(button(`… ${block.total - block.children.length} more - show the next 50`, "Show more rows", () => expand(node.path, block.children.length)));
        out.push(more);
      }
    }
    return out;
  }

  function editValue(valueEl, node) {
    const input = /** @type {HTMLInputElement} */ (el("input", "debug-edit"));
    input.value = node.value ?? "";
    input.setAttribute("aria-label", `New value of ${node.path}`);
    valueEl.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save && input.value !== node.value) setValue(node.path, input.value);
      else page.redrawIf("debug");
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(false));
  }

  // A table, all of it, as a grid - in blocks of 200 rows.
  async function tableView(node) {
    const dialog = /** @type {HTMLDialogElement} */ (el("dialog", "debug-table-dialog"));
    const head = el("div", "debug-table-head");
    head.append(el("strong", "", `${node.path}`), el("span", "state-type", ` ${node.type} · ${node.size} rows`));
    const close = button("Close", "Close the table", () => dialog.close());
    head.append(close);
    const scroller = el("div", "debug-table-scroll");
    const grid = el("table", "debug-table");
    scroller.append(grid);
    const more = button("Show more rows", "The next 200 rows", () => load());
    dialog.append(head, scroller, more);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    let offset = 0;
    async function load() {
      let block;
      try {
        block = await rt().debug("table", { index: frameIndex, path: node.path, offset });
      } catch (e) {
        scroller.append(el("p", "state-note", String(e?.message ?? e)));
        more.hidden = true;
        return;
      }
      if (offset === 0) {
        const tr = el("tr");
        tr.append(el("th", "", "#"), ...block.columns.map((c) => el("th", "", c)));
        grid.append(tr);
      }
      block.rows.forEach((cells, i) => {
        const tr = el("tr");
        tr.append(el("td", "debug-rownum", String(block.offset + i + 1)), ...cells.map((c) => el("td", "", c)));
        grid.append(tr);
      });
      offset = block.offset + block.rows.length;
      more.hidden = offset >= block.total;
    }
    dialog.showModal();
    await load();
  }

  // ------------------------------------------------------------ wiring

  restore();
  editor.onBreakpointGesture(toggle, moved);
  editor.setDebugHover(async (path) => {
    if (!stop) return undefined;
    try {
      const node = await rt().debug("hover", { index: frameIndex, path });
      if (!node) return undefined;
      const shown = node.value ?? (node.open === "rows" ? `${node.size} rows` : `${node.size} fields`);
      return `\`${path}\` = \`${shown === "" ? "initial" : shown.replace(/`/g, "'")}\` - *${node.type}*`;
    } catch {
      return undefined;
    }
  });
  rt()?.onDebug(onDebug);
  changed();

  // F5 to F8 while stopped, Shift+F8 Stop - before Monaco sees them (F8 is
  // its "next problem") and before the browser does (F5 reloads).
  window.addEventListener("keydown", (e) => {
    if (!stop || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "F8" && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      stopProgram();
      return;
    }
    const how = !e.shiftKey ? KEYS[e.key] : undefined;
    if (how === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    resume(how);
  }, true);

  return {
    tab,
    paused: () => stop !== undefined,
    stop: stopProgram,
    // After every compile of the debug build: where the statements are now.
    compiled(result) {
      stops = result?.stops ?? {};
      debugProblems = result?.debugProblems ?? [];
      for (const bp of breakpoints) verify(bp);
      changed();
    },
  };
}
