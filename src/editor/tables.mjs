// @ts-check
// Database tables of the reader's own: a definition and the rows it starts with.
//
// abap2UI5 apps SELECT from tables, and a playground without one of its own
// could only show apps that invent their data in the constructor. So a file
// set may carry a table, named the way abapGit names it:
//
//   ztab.tabl.xml   - the DDIC definition, exactly as abapGit serialises a
//                     TABL (DD02V, DD03P_TABLE). abaplint reads it, so
//                     `SELECT ... FROM ztab` and `TYPE ztab` check, and the
//                     transpiler turns it into the runtime type and the
//                     CREATE TABLE.
//   ztab.tabu.json  - the rows, in the form abapGit's own data support
//                     writes table contents in (a TABU object: a JSON array
//                     of one object per row, keyed by field name). abapGit
//                     keeps it under /data/ beside a ztab.conf.json, which is
//                     where the export puts both - so a table travels to a
//                     system with its rows, by the tool that would carry it
//                     there anyway. JSON rather than a CSV because that is
//                     what abapGit reads, and because a value with a comma
//                     or a quote in it needs nothing explained.
//
// Every Run creates the tables afresh in the in-memory database and inserts
// these rows (src/runtime/index.mjs) - nothing an app writes outlives the Run,
// which is the promise ("Run starts fresh") the drafts database keeps too.
// The text of the two files is all there is to keep.
//
// This module is plain: no abaplint, no DOM - the registry worker, the page
// and the Node tests all read it.

// The most rows a seed file may hold. A share link carries the whole file in
// its fragment, and every Run inserts every row; a thousand is far more than
// an example needs and still a few milliseconds.
export const MAX_ROWS = 1000;

// The file the rows of a table live in, and the table a seed file fills.
export const seedFileOf = (tableFile) => tableFile.replace(/\.tabl\.xml$/, ".tabu.json");
export const tableFileOf = (seedFile) => seedFile.replace(/\.tabu\.json$/, ".tabl.xml");

export const isTableFile = (name) => /\.tabl\.xml$/.test(String(name));
export const isSeedFile = (name) => /\.tabu\.json$/.test(String(name));

/**
 * The rows of a seed file, or what is wrong with it, with the line it is on.
 * Field names are upper-cased - abapGit writes them as ajson does, and a
 * reader may write either - and every value is kept as a string or a number
 * for the runtime to convert under ABAP's rules into the field's type.
 *
 * @param {string} text
 * @returns {{ rows: Record<string, string | number>[], problems: { line: number, column: number, message: string }[] }}
 */
export function parseSeed(text) {
  const problems = [];
  if (text.trim() === "") return { rows: [], problems };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const { line, column } = jsonErrorAt(text, e);
    return { rows: [], problems: [{ line, column, message: `This is not JSON: ${jsonMessage(e)}` }] };
  }
  if (!Array.isArray(data)) {
    return { rows: [], problems: [{ line: 1, column: 1, message: "The rows are a JSON array, one object per row: [ { \"id\": \"A1\", ... } ]" }] };
  }
  if (data.length > MAX_ROWS) {
    problems.push({ line: 1, column: 1, message: `${data.length} rows - a seed file holds at most ${MAX_ROWS}.` });
    return { rows: [], problems };
  }
  const rows = [];
  const lines = rowLines(text);
  data.forEach((row, i) => {
    const line = lines[i] ?? 1;
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      problems.push({ line, column: 1, message: `Row ${i + 1} is not an object of field names and values.` });
      return;
    }
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      const field = key.trim().toUpperCase();
      if (value === null || value === undefined) continue;
      if (typeof value === "boolean") out[field] = value ? "X" : "";
      else if (typeof value === "string" || typeof value === "number") out[field] = value;
      else {
        problems.push({ line, column: 1, message: `Row ${i + 1}, ${field}: a value is a string or a number, not ${Array.isArray(value) ? "a list" : "an object"}.` });
      }
    }
    rows.push(out);
  });
  return { rows, problems };
}

// The line each top-level row starts on: a bracket depth walk over the text,
// strings skipped, so a problem with row 7 points at row 7.
function rowLines(text) {
  const out = [];
  let depth = 0;
  let line = 1;
  let inString = false;
  // At depth 1, after the opening bracket or a comma: the next thing that is
  // not white space starts a row.
  let next = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") line++;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (next && !/\s/.test(ch) && ch !== "]") {
      out.push(line);
      next = false;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") {
      depth++;
      if (depth === 1) next = true;
    } else if (ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 1) next = true;
  }
  return out;
}

// Where JSON.parse gave up. V8 says "at position N" (and newer ones "line L
// column C"); either is turned into a line, and without one it is line 1.
function jsonErrorAt(text, e) {
  const message = String(e?.message ?? "");
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) return { line: Number(lc[1]), column: Number(lc[2]) };
  const pos = /position (\d+)/.exec(message);
  if (!pos) return { line: 1, column: 1 };
  const before = text.slice(0, Number(pos[1])).split("\n");
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

const jsonMessage = (e) => String(e?.message ?? e).replace(/\s*\(line \d+ column \d+\)$/, "").replace(/^JSON\.parse: /, "");

/**
 * What a table definition says, read far enough to know whether abaplint can
 * be handed it: abaplint throws - from inside its parse, taking the editor's
 * whole analysis with it - on a field that has neither a built-in type nor a
 * data element, so such a file is checked here first and kept from it until
 * it is whole. Read with patterns rather than an XML parser: the registry
 * runs in a worker, which has no DOMParser, and abapGit's TABL is a flat list
 * of one element per line.
 *
 * @param {string} text
 * @returns {{ name: string | undefined, fields: { name: string, key: boolean, line: number }[], problems: { line: number, column: number, message: string }[] }}
 */
export function readTable(text) {
  const problems = [];
  const name = /<TABNAME>\s*([^<\s]+)\s*<\/TABNAME>/.exec(text)?.[1]?.toUpperCase();
  if (!/<abapGit\b/.test(text) || !/<DD02V>/.test(text)) {
    problems.push({ line: 1, column: 1, message: "A table definition is abapGit's TABL XML: <abapGit> with a <DD02V> header and the fields in <DD03P_TABLE>." });
    return { name, fields: [], problems };
  }
  if (name === undefined) problems.push({ line: lineOf(text, text.indexOf("<DD02V>")), column: 1, message: "The table has no <TABNAME>." });
  const fields = [];
  const field = /<DD03P>([\s\S]*?)<\/DD03P>/g;
  for (let m = field.exec(text); m; m = field.exec(text)) {
    const body = m[1];
    const line = lineOf(text, m.index);
    const tag = (t) => new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`).exec(body)?.[1];
    const fieldName = tag("FIELDNAME")?.toUpperCase();
    if (!fieldName) {
      problems.push({ line, column: 1, message: "A field has no <FIELDNAME>." });
      continue;
    }
    const comptype = tag("COMPTYPE") ?? "";
    const rollname = tag("ROLLNAME");
    const datatype = tag("DATATYPE");
    const include = fieldName === ".INCLUDE" || fieldName.startsWith(".INCLU-");
    if (!include && comptype === "" && !datatype) {
      problems.push({
        line,
        column: 1,
        message: rollname
          ? `${fieldName} names the data element ${rollname} - say so with <COMPTYPE>E</COMPTYPE>, as abapGit writes it.`
          : `${fieldName} has no type: a <DATATYPE> with its <LENG> (CHAR, NUMC, INT4, DEC, DATS, STRG, ...), or a <ROLLNAME> with <COMPTYPE>E</COMPTYPE>.`,
      });
    } else if (comptype !== "" && !rollname) {
      problems.push({ line, column: 1, message: `${fieldName} has <COMPTYPE>${comptype}</COMPTYPE> and no <ROLLNAME> to say which type.` });
    }
    fields.push({ name: fieldName, key: tag("KEYFLAG") === "X", line });
  }
  if (fields.length === 0 && problems.length === 0) {
    problems.push({ line: 1, column: 1, message: "The table has no fields - they go in <DD03P_TABLE>, one <DD03P> each." });
  }
  return { name, fields, problems };
}

const lineOf = (text, index) => (index < 0 ? 1 : text.slice(0, index).split("\n").length);

/** @typedef {{ name: string, key?: boolean, rollname?: string, datatype?: string, leng?: number, decimals?: number }} Column */

/** One field of a definition, as abapGit writes it.
 *  @param {Column} column */
function fieldXml({ name, key = false, rollname, datatype = "CHAR", leng = 1, decimals }) {
  const lines = [`    <DD03P>`, `     <FIELDNAME>${name}</FIELDNAME>`];
  if (key) lines.push(`     <KEYFLAG>X</KEYFLAG>`);
  if (rollname) {
    lines.push(`     <ROLLNAME>${rollname}</ROLLNAME>`, `     <ADMINFIELD>0</ADMINFIELD>`);
    if (key) lines.push(`     <NOTNULL>X</NOTNULL>`);
    lines.push(`     <COMPTYPE>E</COMPTYPE>`);
  } else {
    lines.push(`     <ADMINFIELD>0</ADMINFIELD>`);
    if (key) lines.push(`     <NOTNULL>X</NOTNULL>`);
    lines.push(`     <DATATYPE>${datatype}</DATATYPE>`, `     <LENG>${String(leng).padStart(6, "0")}</LENG>`);
    if (decimals !== undefined) lines.push(`     <DECIMALS>${String(decimals).padStart(6, "0")}</DECIMALS>`);
    lines.push(`     <MASK>  ${datatype.padEnd(4, " ")}</MASK>`);
  }
  lines.push(`    </DD03P>`);
  return lines.join("\n");
}

/**
 * A table definition for a name, in abapGit's serialisation - what "Add
 * table" starts from, and what a .tabl.xml typed into the strip begins as.
 * A client field and a key, then the columns: the shape of almost every
 * customer table, and one that imports into a system as it is.
 *
 * @param {string} name the table's name, any case
 * @param {Column[]} [columns]
 * @param {string} [text] the short description
 */
export function tableXml(name, columns, text) {
  const tabname = name.toUpperCase();
  const fields = columns ?? [
    { name: "ID", key: true, datatype: "CHAR", leng: 10 },
    { name: "TEXT", datatype: "CHAR", leng: 40 },
  ];
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_TABL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD02V>
    <TABNAME>${tabname}</TABNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <TABCLASS>TRANSP</TABCLASS>
    <CLIDEP>X</CLIDEP>
    <DDTEXT>${text ?? `playground ${name.toLowerCase()}`}</DDTEXT>
    <CONTFLAG>A</CONTFLAG>
    <EXCLASS>1</EXCLASS>
   </DD02V>
   <DD09L>
    <TABNAME>${tabname}</TABNAME>
    <AS4LOCAL>A</AS4LOCAL>
    <TABKAT>0</TABKAT>
    <TABART>APPL0</TABART>
    <BUFALLOW>N</BUFALLOW>
   </DD09L>
   <DD03P_TABLE>
${[{ name: "MANDT", key: true, rollname: "MANDT" }, ...fields].map(fieldXml).join("\n")}
   </DD03P_TABLE>
  </asx:values>
 </asx:abap>
</abapGit>
`;
}

// The built-in types write_table takes, with the length a type fixes for
// itself; CHAR, NUMC and DEC take the model's. Currency and quantity fields
// (CURR, QUAN) are left out: they need a reference field, and a table that
// imports with a warning is worse than one with a DEC.
const TABLE_TYPES = {
  CHAR: { length: true },
  NUMC: { length: true },
  DEC: { length: true },
  INT1: { leng: 3 },
  INT2: { leng: 5 },
  INT4: { leng: 10 },
  INT8: { leng: 19 },
  FLTP: { leng: 16 },
  DATS: { leng: 8 },
  TIMS: { leng: 6 },
  STRG: { leng: 0 },
};

/*
 * write_table's input as the two files "+ table" writes - the definition by
 * tableXml( ) above, the rows as JSON - or the one thing wrong with
 * it, said so the model can correct it - the AI App Builder's write_table
 * (src/shell/ai-agent.mjs). Pure, for tests/node.
 */
const whole = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) ? n : NaN;
};

export function tableFiles(input) {
  const str = (v) => (typeof v === "string" ? v : undefined);
  const name = str(input?.name)?.trim().toLowerCase();
  if (!name || !/^[yz][a-z0-9_]{0,15}$/.test(name)) {
    return { error: "write_table needs a name: lower case, z or y first, letters, digits and _, at most 16 characters (e.g. zorders)." };
  }
  if (!Array.isArray(input.fields) || input.fields.length === 0) return { error: "write_table needs fields - at least one, one of them key." };
  const seen = new Set();
  const columns = [];
  for (const [i, f] of input.fields.entries()) {
    const field = str(f?.name)?.trim().toUpperCase();
    if (!field || !/^[A-Z][A-Z0-9_]{0,29}$/.test(field)) return { error: `Field ${i + 1}: a name of letters, digits and _, a letter first, at most 30 characters.` };
    if (field === "MANDT") continue; // added by itself, first
    if (seen.has(field)) return { error: `Field ${field} is there twice.` };
    seen.add(field);
    const type = str(f.type)?.trim().toUpperCase();
    const spec = TABLE_TYPES[type];
    if (!spec) return { error: `Field ${field}: type ${f.type ?? "(none)"} - one of ${Object.keys(TABLE_TYPES).join(", ")}.` };
    let leng = spec.leng;
    if (spec.length) {
      leng = whole(f.length);
      if (!(leng >= 1 && leng <= (type === "DEC" ? 31 : 255))) return { error: `Field ${field}: a ${type} needs a length (1-${type === "DEC" ? 31 : 255}).` };
    }
    const column = { name: field, datatype: type, leng, key: f.key === true };
    if (type === "DEC") {
      const decimals = f.decimals === undefined ? 0 : whole(f.decimals);
      const most = Math.min(14, Math.max(0, leng - 1));
      if (!(decimals >= 0 && decimals <= most)) return { error: `Field ${field}: a DEC of length ${leng} takes 0 to ${most} decimals.` };
      column.decimals = decimals;
    }
    if (column.key && type === "STRG") return { error: `Field ${field}: a STRG field cannot be key.` };
    columns.push(column);
  }
  if (columns.length === 0) return { error: "write_table needs a field besides MANDT, which is added by itself." };
  // The key fields lead, as a table's key does on a system.
  if (!columns.some((c) => c.key)) return { error: "write_table needs at least one key field (key: true)." };
  const firstNonKey = columns.findIndex((c) => !c.key);
  if (firstNonKey !== -1 && columns.slice(firstNonKey).some((c) => c.key)) return { error: "The key fields come first, before every other field." };
  const rows = input.rows === undefined ? [] : input.rows;
  if (!Array.isArray(rows)) return { error: "rows is a list of objects, one per row." };
  if (rows.length > MAX_ROWS) return { error: `${rows.length} rows - a table here starts with at most ${MAX_ROWS}.` };
  const known = new Set(["MANDT", ...columns.map((c) => c.name)]);
  const out = [];
  for (const [i, row] of rows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return { error: `Row ${i + 1} is not an object of field names and values.` };
    const clean = {};
    for (const [k, v] of Object.entries(row)) {
      const field = k.trim().toUpperCase();
      if (!known.has(field)) return { error: `Row ${i + 1}: there is no field ${field}. The fields: ${[...known].join(", ")}.` };
      if (v !== null && typeof v === "object") return { error: `Row ${i + 1}, ${field}: a value is a string, a number or a boolean.` };
      clean[field.toLowerCase()] = v;
    }
    out.push(clean);
  }
  const description = str(input.description)?.trim().replace(/[<>&]/g, " ").slice(0, 60) || `table ${name}`;
  return {
    tabname: name.toUpperCase(),
    fields: columns.length,
    rows: out.length,
    table: { name: `${name}.tabl.xml`, source: tableXml(name, columns, description) },
    seed: { name: `${name}.tabu.json`, source: `${out.length ? `[\n${out.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n]` : "[]"}\n` },
  };
}

// The example "Add table" puts into the file set: a few products with a
// price and a stock, which is enough to SELECT, filter, sum and show in a
// table control - and a name that says what it is.
export const STARTER_TABLE = "zproducts";

export function starterTable(name = STARTER_TABLE) {
  return {
    table: {
      name: `${name}.tabl.xml`,
      source: tableXml(
        name,
        [
          { name: "PRODUCT_ID", key: true, datatype: "CHAR", leng: 10 },
          { name: "NAME", datatype: "CHAR", leng: 40 },
          { name: "CATEGORY", datatype: "CHAR", leng: 20 },
          { name: "PRICE", datatype: "DEC", leng: 13, decimals: 2 },
          { name: "STOCK", datatype: "INT4", leng: 10 },
        ],
        "playground products",
      ),
    },
    seed: {
      name: `${name}.tabu.json`,
      source: `[
  { "product_id": "P001", "name": "Notebook 14", "category": "Computers", "price": 899.0, "stock": 12 },
  { "product_id": "P002", "name": "Monitor 27", "category": "Displays", "price": 249.5, "stock": 30 },
  { "product_id": "P003", "name": "Keyboard", "category": "Accessories", "price": 49.99, "stock": 120 },
  { "product_id": "P004", "name": "Mouse", "category": "Accessories", "price": 19.9, "stock": 200 },
  { "product_id": "P005", "name": "Docking Station", "category": "Accessories", "price": 179.0, "stock": 0 }
]
`,
    },
  };
}

// abapGit's data configuration for one table: which table, all its rows.
// It sits beside the rows under /data/ in an export - abapGit's own layout
// for TABU content - and is what makes abapGit pick the rows up at all.
export const dataConfig = (name) =>
  `${JSON.stringify({ type: "TABU", name: name.toUpperCase(), skip_initial: "", where: [] }, null, 2)}\n`;
