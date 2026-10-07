// Files the reader adds to a message in the AI Pilot's chat (src/shell/pilot.mjs),
// turned into what the Messages API takes - in this browser, sent nowhere
// but with the message to api.anthropic.com:
//
//   PDF                       a document block, as it is (base64)
//   PNG, JPEG, GIF, WebP      an image block
//   .xlsx                     each sheet as CSV, a text document per sheet
//   .docx                     its paragraphs as text
//   text (csv, txt, json, md, xml, abap, …)   a text document
//
// The two Office formats are zip files of XML, read here rather than with a
// library: the central directory, each entry inflated by the browser's own
// DecompressionStream, the XML by DOMParser - a hundred lines instead of a
// spreadsheet library in the chunk. What they cannot carry (formulas, styles,
// dates as dates - a date cell is the serial number Excel keeps) is said in
// the document's own first line, so the model is not left guessing. The old
// binary formats (.xls, .doc) are refused with what to save them as.

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
// The API takes an image of at most 10 MB as base64, which a file of 7.5 MB
// already is: a larger one passed here and was refused by the API instead.
const MAX_IMAGE_BYTES = 7.5 * 1000 * 1000;
// What all of a message's files may add up to, as the API is sent them: a
// request is at most 32 MB, a PDF or an image goes as base64 (a third more),
// and the conversation's text goes with it. Three PDFs of 9 MB each passed
// every per-file check and were a guaranteed 413.
export const MAX_MESSAGE_BYTES = 20 * 1000 * 1000;
const MAX_TEXT = 200000;
// The text all the files of one message may bring, together: a workbook of
// twenty filled sheets was twenty times MAX_TEXT - far past the model's
// context, and resent with every later request of the conversation.
const MAX_TEXT_TOTAL = 400000;
const MAX_ROWS = 2000;

const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const TEXT_EXTENSIONS = new Set([
  "txt", "csv", "tsv", "json", "md", "xml", "html", "htm", "yaml", "yml", "log", "abap", "js", "mjs", "ts", "sql", "ini", "properties",
]);

const extensionOf = (name) => (/\.([^.]+)$/.exec(name)?.[1] ?? "").toLowerCase();
const clipText = (text, max = MAX_TEXT) =>
  text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters cut)`;

/** What kind of file this is, or why it is not taken. */
export function kindOf(file) {
  const ext = extensionOf(file.name);
  if (file.size > MAX_FILE_BYTES) return { error: `${file.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB` };
  // An empty PDF or image went out as a block without data, and the API
  // refused the whole message for it, text and all.
  if (file.size === 0) return { error: `${file.name} is empty` };
  // `sent` - the file goes to the API as it is (base64), so its size counts
  // towards MAX_MESSAGE_BYTES; the others go as the text read out of them.
  if (ext === "pdf" || file.type === "application/pdf") return { kind: "pdf", sent: true };
  if (IMAGE_TYPES[ext]) {
    if (file.size > MAX_IMAGE_BYTES) return { error: `${file.name} is larger than the 7.5 MB an image may be - make it smaller and add it again` };
    return { kind: "image", mediaType: IMAGE_TYPES[ext], sent: true };
  }
  if (ext === "xlsx" || ext === "xlsm") return { kind: "xlsx" };
  if (ext === "docx") return { kind: "docx" };
  if (ext === "xls" || ext === "doc") {
    return { error: `${file.name} is the old binary Office format - save it as .${ext}x, .csv or .pdf and add it again` };
  }
  if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/")) return { kind: "text" };
  return { error: `${file.name} is not a file the chat can read - PDF, images, .xlsx, .docx and text files are` };
}

/**
 * The files as content blocks for one user message. Answers { blocks, errors }:
 * a file that cannot be read is an error and is left out, the rest go.
 */
export async function attachmentBlocks(files) {
  const blocks = [];
  const errors = [];
  // What is left of MAX_TEXT_TOTAL, drawn on by every text document.
  const budget = { left: MAX_TEXT_TOTAL };
  for (const file of files.slice(0, MAX_FILES)) {
    const kind = kindOf(file);
    if (kind.error) {
      errors.push(kind.error);
      continue;
    }
    try {
      blocks.push(...(await blocksOf(file, kind, budget)));
    } catch (e) {
      errors.push(`${file.name} could not be read: ${String(e?.message ?? e)}`);
    }
  }
  if (files.length > MAX_FILES) errors.push(`only ${MAX_FILES} files go with one message - the rest were left out`);
  return { blocks, errors };
}

async function blocksOf(file, { kind, mediaType }, budget) {
  const textDocument = (title, text) => {
    const max = Math.min(MAX_TEXT, budget.left);
    const clipped = max > 0 ? clipText(text, max) : `(left out: the files of this message already bring ${MAX_TEXT_TOTAL} characters of text)`;
    budget.left -= Math.min(text.length, max);
    return { type: "document", title, source: { type: "text", media_type: "text/plain", data: clipped || "(empty)" } };
  };
  switch (kind) {
    case "pdf":
      return [{ type: "document", title: file.name, source: { type: "base64", media_type: "application/pdf", data: await base64(file) } }];
    case "image":
      return [
        { type: "text", text: `The attached image ${file.name}:` },
        { type: "image", source: { type: "base64", media_type: mediaType, data: await base64(file) } },
      ];
    case "xlsx":
      return (await spreadsheet(await file.arrayBuffer())).map(({ name, csv, note }) =>
        textDocument(`${file.name} - sheet ${name}`, `${note}\n${csv}`));
    case "docx":
      return [textDocument(file.name, await wordText(await file.arrayBuffer()))];
    default:
      return [textDocument(file.name, decodeText(await file.arrayBuffer()))];
  }
}

// A text file in whatever encoding it came: a BOM says which, UTF-8 is tried
// next, and what is not UTF-8 is Windows-1252 - an Excel "CSV (Comma
// delimited)" or a download from SAP GUI in the local code page, whose
// umlauts were replacement characters for good when read as UTF-8.
export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function base64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("the file could not be read"));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------- zip

/* The entries of a zip archive, by name, inflated on demand. Reads the end
 * of central directory record (the last 22 bytes, or further back by its
 * comment), then the central directory, then each entry's local header for
 * where its data starts. */
export function readZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("it is not a zip file (an Office file is one)");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("its zip directory is damaged");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, { method, size, local });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return {
    has: (name) => entries.has(name),
    async text(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
      const data = bytes.subarray(start, start + entry.size);
      if (entry.method === 0) return decoder.decode(data);
      if (entry.method !== 8) throw new Error(`a zip entry is packed with method ${entry.method}, which the browser cannot unpack`);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).text();
    },
  };
}

const xml = (text) => new DOMParser().parseFromString(text, "application/xml");
const all = (node, local) => [...node.getElementsByTagNameNS("*", local)];

// ---------------------------------------------------------- spreadsheet

/* Each sheet of an .xlsx as CSV: the workbook names the sheets and their
 * parts (through its relationships), the shared strings hold the text, and
 * a cell is a number, a shared string (t="s"), an inline string, a formula's
 * cached result (t="str") or a boolean. */
export async function spreadsheet(buffer) {
  const zip = readZip(buffer);
  const workbook = await zip.text("xl/workbook.xml");
  if (!workbook) throw new Error("it has no workbook - is it really an .xlsx?");
  const rels = xml((await zip.text("xl/_rels/workbook.xml.rels")) ?? "<Relationships/>");
  const targets = new Map(all(rels, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
  const sharedXml = await zip.text("xl/sharedStrings.xml");
  const shared = sharedXml ? all(xml(sharedXml), "si").map(stringOf) : [];
  const sheets = [];
  for (const sheet of all(xml(workbook), "sheet")) {
    const id = sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")
      ?? sheet.getAttribute("r:id");
    const target = (targets.get(id) ?? "").replace(/^\/?xl\//, "").replace(/^\//, "");
    const part = await zip.text(`xl/${target}`);
    if (!part) continue;
    sheets.push({ name: sheet.getAttribute("name") ?? target, ...sheetCsv(xml(part), shared) });
  }
  if (sheets.length === 0) throw new Error("it has no sheet with cells");
  return sheets;
}

// The text of a string item - its <t> runs, but not the ones under <rPh>,
// which are the phonetic reading Excel keeps beside Japanese text and would
// otherwise be glued onto every such cell.
// Excel writes a character XML cannot hold as _xHHHH_ (a carriage return is
// _x000D_), and a literal "_x" in front of one as _x005F_.
const stringOf = (node) =>
  all(node, "t")
    .filter((t) => t.parentNode?.localName !== "rPh")
    .map((t) => t.textContent)
    .join("")
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

// The column a cell reference names ("C7" is 2), or undefined for a cell
// without one - `r` is optional in the format, and a writer that leaves it out
// means "the column after the last".
const columnIndex = (ref) => {
  const letters = /^[A-Z]+/.exec(ref ?? "")?.[0];
  if (!letters) return undefined;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function sheetCsv(doc, shared) {
  const rows = [];
  const rowNodes = all(doc, "row");
  let cut = false;
  for (const row of rowNodes) {
    // A row without cells is not written at all, so the row number is what
    // places it: read off the node count, a sheet with a title row, a blank
    // line and the table had the table in line 2 rather than line 3.
    const number = Number(row.getAttribute("r")) || rows.length + 1;
    if (number > MAX_ROWS) {
      cut = true;
      break;
    }
    while (rows.length < number - 1) rows.push("");
    const cells = [];
    let column = -1;
    for (const c of all(row, "c")) {
      const type = c.getAttribute("t");
      const v = all(c, "v")[0]?.textContent ?? "";
      let value;
      if (type === "s") value = v === "" ? "" : (shared[Number(v)] ?? "");
      else if (type === "inlineStr") value = stringOf(c);
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else value = v;
      column = columnIndex(c.getAttribute("r")) ?? column + 1;
      cells[column] = value;
    }
    rows.push(Array.from(cells, (value) => csvField(value ?? "")).join(","));
  }
  while (rows.length > 0 && /^,*$/.test(rows[rows.length - 1])) rows.pop();
  const last = Number(rowNodes[rowNodes.length - 1]?.getAttribute("r")) || rowNodes.length;
  return {
    csv: rows.join("\n"),
    note: `(a spreadsheet sheet as CSV${cut ? `, the first ${MAX_ROWS} of ${last} rows` : ""}; a CSV line is the sheet's row of that number; values as Excel stores them - a date is its serial number, a formula its last result)`,
  };
}

const csvField = (value) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

// ------------------------------------------------------------- document

/* The paragraphs of a .docx: word/document.xml, each <w:p> one line, its
 * <w:t> runs joined, a tab a tab. Tables come out a cell per line, a text
 * box as the paragraphs it holds. */
export async function wordText(buffer) {
  const zip = readZip(buffer);
  const body = await zip.text("word/document.xml");
  if (!body) throw new Error("it has no document - is it really a .docx?");
  return all(xml(body), "p")
    .filter((p) => !skipped(p))
    .map((p) => {
      let line = "";
      for (const node of p.getElementsByTagNameNS("*", "*")) {
        // Only the paragraph's own runs: a text box is paragraphs inside a
        // paragraph, which are lines of their own - counted here as well, a
        // text box came out four times, twice glued to the line around it.
        if (paragraphOf(node) !== p || skipped(node)) continue;
        if (node.localName === "t") line += node.textContent;
        // A <w:tab/> in a run is a tab; one inside <w:pPr><w:tabs> is a tab
        // STOP the paragraph defines, and counted as text it put a tab in
        // front of every paragraph with custom stops.
        else if (node.localName === "tab" && node.parentNode?.localName !== "tabs") line += "\t";
        else if (node.localName === "br" || node.localName === "cr") line += "\n";
        else if (node.localName === "noBreakHyphen") line += "-";
      }
      return line;
    })
    .join("\n");
}

const paragraphOf = (node) => {
  let at = node.parentNode;
  while (at && at.localName !== "p") at = at.parentNode;
  return at;
};

// What Word keeps twice: a text box as the drawing (mc:Choice) and again for
// readers that do not know it (mc:Fallback), and text moved with track
// changes on both its old place (w:moveFrom) and its new one.
const skipped = (node) => {
  for (let at = node.parentNode; at; at = at.parentNode) {
    if (at.localName === "Fallback" || at.localName === "moveFrom") return true;
  }
  return false;
};
