// The app's attributes as the page's State tab shows them - read off the
// instance itself, in the worker, at the end of each roundtrip.
//
// The framework keeps an app between roundtrips by serialising it into its
// drafts table, and that XML is the obvious place to read the state from -
// but it is the framework's own format, private and moving, and it is the
// state as the NEXT roundtrip will restore it rather than as the app left it.
// The instance is right there: index.mjs wraps the handler's last step of a
// roundtrip (main_end_save) and hands the app it holds to snapshot( ) below.
//
// What crosses to the page is plain data and bounded: a few levels deep, a
// few rows of each table, a long string cut short - an app with a 5,000-row
// table must not send 5,000 rows to a panel after every click, and an object
// graph is walked no further than the app's own attributes. References are
// named, never followed: the client, a popup, a helper object - each is a
// world of its own, and a cycle would be a hang.
const MAX_DEPTH = 4;
const MAX_ROWS = 20;
const MAX_FIELDS = 60;
const MAX_TEXT = 200;
const MAX_NODES = 1500;

const VISIBILITY = { U: "public", O: "protected", I: "private" };

/**
 * @typedef {{ name: string, type: string, value?: string, length?: number,
 *   children?: Node[], rows?: number, cut?: number,
 *   visibility?: string, static?: boolean }} Node
 */

// The snapshot of one app instance: its class and its attributes, instance
// and static, in the order the class declares them - inherited ones first,
// as a reader would find them walking up from the class. Constants and the
// attributes of interfaces (z2ui5_if_app~id_draft, which the framework
// rewrites every roundtrip) are left out: neither is the app's state.
export function snapshot(app) {
  if (!app || typeof app !== "object") return undefined;
  const abap = globalThis.abap;
  const budget = { nodes: 0, cut: false };
  const attributes = [];
  const chain = [];
  for (let cls = app.constructor; cls && cls.INTERNAL_NAME; cls = Object.getPrototypeOf(cls)) chain.unshift(cls);
  const seen = new Set();
  for (const cls of chain) {
    for (const [upper, meta] of Object.entries(cls.ATTRIBUTES ?? {})) {
      if (upper.includes("~") || meta?.is_constant === "X" || seen.has(upper)) continue;
      seen.add(upper);
      const name = upper.toLowerCase();
      const isStatic = meta?.is_class === "X";
      const data = app.FRIENDS_ACCESS_INSTANCE?.[name] ?? app[name] ?? (isStatic ? cls[name] : undefined);
      if (data === undefined) continue;
      const node = describe(abap, name, data, 0, budget);
      node.visibility = VISIBILITY[meta?.visibility] ?? "public";
      if (isStatic) node.static = true;
      attributes.push(node);
    }
  }
  return { class: app.constructor.INTERNAL_NAME ?? app.constructor.name, attributes, cut: budget.cut };
}

/** @returns {Node} */
function describe(abap, name, data, depth, budget) {
  budget.nodes++;
  const t = abap.types;
  const node = { name, type: typeOf(t, data) };
  if (data instanceof t.Structure) {
    const fields = Object.entries(data.get());
    if (depth >= MAX_DEPTH || budget.nodes > MAX_NODES) return cut(node, fields.length, budget);
    node.children = fields.slice(0, MAX_FIELDS).map(([field, value]) => describe(abap, field, value, depth + 1, budget));
    if (fields.length > MAX_FIELDS) node.cut = fields.length - MAX_FIELDS;
    return node;
  }
  if (data instanceof t.Table || data instanceof t.HashedTable) {
    const rows = data.array();
    node.rows = rows.length;
    if (depth >= MAX_DEPTH || budget.nodes > MAX_NODES) return cut(node, rows.length, budget);
    node.children = rows.slice(0, MAX_ROWS).map((row, i) => describe(abap, String(i + 1), row, depth + 1, budget));
    if (rows.length > MAX_ROWS) node.cut = rows.length - MAX_ROWS;
    return node;
  }
  if (data instanceof t.ABAPObject) {
    const target = data.get();
    node.value = target ? `→ ${target.constructor?.INTERNAL_NAME ?? target.constructor?.name ?? "object"}` : "initial";
    return node;
  }
  if (data instanceof t.DataReference) {
    const target = data.getPointer?.();
    node.value = target ? `→ ${typeOf(t, target)}` : "initial";
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
  return node;
}

function cut(node, count, budget) {
  if (count > 0) {
    node.children = [];
    node.cut = count;
    budget.cut = true;
  }
  return node;
}

// The type as ABAP would write it: the DDIC or global name it was declared
// with where there is one (abap_bool, ztab, string_table), else the built-in
// type with its length.
function typeOf(t, data) {
  const named = qualified(data);
  if (data instanceof t.Table || data instanceof t.HashedTable) {
    const row = data.getRowType?.();
    return named ?? `table of ${row ? typeOf(t, row) : "?"}`;
  }
  if (data instanceof t.Structure) return named ?? "structure";
  if (data instanceof t.ABAPObject) return `ref to ${named ?? "object"}`;
  if (data instanceof t.DataReference) return "ref to data";
  if (named) return named;
  if (data instanceof t.Character) return `c length ${data.getLength()}`;
  if (data instanceof t.String) return "string";
  if (data instanceof t.XString) return "xstring";
  if (data instanceof t.Integer) return "i";
  if (data instanceof t.Integer8) return "int8";
  if (data instanceof t.Packed) return `p length ${data.getLength()} decimals ${data.getDecimals()}`;
  if (data instanceof t.Float) return "f";
  if (data instanceof t.DecFloat34) return "decfloat34";
  if (data instanceof t.Date) return "d";
  if (data instanceof t.Time) return "t";
  if (data instanceof t.Numc) return `n length ${data.getLength()}`;
  if (data instanceof t.Hex) return `x length ${data.getLength()}`;
  if (data instanceof t.UTCLong) return "utclong";
  return data?.constructor?.name?.toLowerCase() ?? "?";
}

// A name the type was declared with, when it is a name somebody wrote - not
// the path of a component inside another type (z2ui5_if_types=>ty_s-field).
function qualified(data) {
  const name = data?.getQualifiedName?.();
  if (typeof name !== "string" || name === "" || name.includes("-")) return undefined;
  return name.toLowerCase();
}
