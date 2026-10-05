// Editing the view instead of the chain that builds it.
//
// The View tab shows the XML a builder chain produces. This is what happens
// when somebody edits that XML: the chain is read back out of the ABAP
// (chain-read.mjs), the edited document is matched against the one that was
// shown, and the chain is written again (chain-write.mjs) with the ABAP the
// editor did not touch left exactly as it was.
//
// That last part is the whole design. A view is full of expressions -
// `client->_bind( t_flight )`, `client->_event( \`COUNT\` )`, a string
// template - which the reconstruction renders as what they will mean at run
// time. Regenerating the chain from the rendering alone would compile, run,
// and quietly be a different app: every binding frozen into the string it
// happened to have. So an attribute whose value is the same text it was shown
// as keeps its original ABAP verbatim, and only what actually changed becomes
// a literal.
//
// Which attribute is "the same" needs the two documents to line up, and they
// are lined up by matching each element with the one it came from - by name,
// longest common subsequence at each level, so that inserting a control in the
// middle of a page does not shift every control after it onto the wrong
// original. An element with no counterpart is new and is written from its own
// text; everything under it is too.
//
// And the chain is only *written* again when it has to be. A value changed or
// an attribute added is put back as an edit to the ABAP that is there
// (chain-patch.mjs), so the method keeps the shape somebody wrote it in and
// the diff is the change - a leaf control taken out included. Writing the
// whole chain is what an added control, or a removed one that is more than a
// leaf's own lines, falls back to.
import { abapLiteral, unwritable, writeViewChain } from "./chain-write.mjs";
import { alignWithXml, commentIn, readViewChain } from "./chain-read.mjs";
import { patchChain } from "./chain-patch.mjs";

const no = (why) => ({ ok: false, why });

/**
 * Whether the view in `source` can be edited, and why not when it cannot.
 * `xml` is the view as the linter reconstructed it - the document the panel
 * is showing.
 */
export function viewEditable(source, xml) {
  const chain = readViewChain(source);
  if (!chain.ok) return chain;
  const mismatch = alignWithXml(chain.root, xml);
  if (mismatch) {
    return no(
      `The view on screen and the chain in the code do not line up at ${mismatch}, ` +
        "so an edit could not be put back safely.",
    );
  }
  return { ok: true };
}

/**
 * The source with the chain rewritten to build `edited` instead.
 * `{ ok: false, why }` for anything that cannot be done, said in a sentence
 * the panel puts under the editor.
 */
export function sourceWithView(source, xml, edited) {
  const chain = readViewChain(source);
  if (!chain.ok) return chain;
  const mismatch = alignWithXml(chain.root, xml);
  if (mismatch) {
    return no(
      `The view on screen and the chain in the code do not line up at ${mismatch}, ` +
        "so this edit was not written back.",
    );
  }

  const wanted = parse(edited);
  if (!wanted.ok) return wanted;

  const was = parse(xml);
  if (!was.ok) return was;

  rendered = renderedNonLiterals(was.element, chain.root.children[0]);
  const built = merge(wanted.element, was.element, chain.root.children[0]);
  if (!built.ok) return built;

  const why = unwritable(built.element);
  if (why) return no(why);

  // The edit in place, when the change is one that can be made in place: a
  // value rewritten where it stands, a control's attribute block written
  // again, and not one character touched anywhere else. That is the normal
  // edit, and generating the chain again for it turned one changed word into
  // a diff over the whole method - the split shape collapsed into a single
  // chain, every line re-anchored. See chain-patch.mjs.
  const patched = patchChain(source, built.element, chain.root.children[0]);
  if (patched) return withinLineLimit(source, patched);

  // A view whose shape changed: a control added, renamed, or removed with
  // more than its own lines. There is no edit to make here - the chain is
  // written again, in the house layout, out of a tree that still carries the
  // ABAP of every value nobody touched.
  // Except over a comment: the writer has no idea where one belonged, and
  // dropping somebody's notes is rewriting what they did not edit.
  if (commentIn(source, chain.start, chain.end)) {
    return no(
      "This change rewrites the whole chain, and the chain has comments in it that the rewrite would drop. " +
        "Take the comments out of the chain, or make the change in the ABAP.",
    );
  }
  // And not over a variable the method goes on using: the rewrite is one
  // statement declaring one variable, so a `page` used after the chain would
  // name something that no longer exists. Only here - an edit in place leaves
  // every statement standing, so it is no reason to keep Edit off.
  if (chain.usedAfter.length > 0) {
    return no(
      `This change rewrites the whole chain as one statement, and \`${chain.usedAfter[0]}\` is used after it. ` +
        "Make the change in the ABAP.",
    );
  }
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const text = writeViewChain({ indent: chain.indent, assignment: chain.assignment, element: built.element, eol });
  return withinLineLimit(source, { ok: true, source: source.slice(0, chain.start) + text + source.slice(chain.end) });
}

// ABAP stops at 255 characters a line, and a literal at 255 too: a long value
// changed in the view was written as one literal on one line - the wrapped
// `…` && `…` pieces of the original collapsed into 400 characters - and the
// class no longer activated once exported. abaplint only calls that style, so
// nothing else here notices. A line of that length the edit did not bring is
// left to its author.
const LINE_LIMIT = 255;
function withinLineLimit(before, result) {
  if (!result?.ok) return result;
  const had = new Set(before.split(/\r?\n/).filter((line) => line.length > LINE_LIMIT));
  const long = result.source.split(/\r?\n/).find((line) => line.length > LINE_LIMIT && !had.has(line));
  if (long === undefined) return result;
  return no(
    `This would write a line of ${long.length} characters, and ABAP takes ${LINE_LIMIT} at most. ` +
      "Make the value shorter, or split it with && in the ABAP.",
  );
}

// The edited text as a document, or the parser's complaint in a form somebody
// can act on. A half-typed tag is the normal state of a textarea, so this is
// the message the panel shows most often and it has to be plain.
function parse(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) {
    // Chromium wraps its message in a sentence of its own ("This page
    // contains the following errors:") and glues it to the first line.
    const said = (error.querySelector("div")?.textContent ?? error.textContent ?? "")
      .replace(/^This page contains the following errors:\s*/i, "")
      .split("\n")
      .find((line) => line.trim() !== "") ?? "";
    return no(`That is not valid XML yet${said ? ` - ${said.trim()}` : ""}.`);
  }
  if (!doc.documentElement) return no("There is no view here.");
  return { ok: true, element: doc.documentElement };
}

// What an event or a binding of the original view renders as, by attribute
// name - `press=".eB()"`, `value="{/NAME}"`. A control that is MOVED (or
// copied) is not paired with its original, which only pairs on one level, so
// it arrives as a new element written from its text - and its event became
// the literal `.eB()`, its binding the string `{/NAME}`: a Save that worked
// and an app whose button raised nothing. A new element carrying one of these
// renderings is refused rather than frozen into a string.
let rendered = new Set();
const renderedKey = (name, value) => `${name}\u0000${value}`;
function renderedNonLiterals(was, node) {
  const out = new Set();
  const walk = (el, n) => {
    if (!el || !n) return;
    for (const attr of n.attrs ?? []) {
      if (attr.literal !== undefined || !el.hasAttribute(attr.name)) continue;
      out.add(renderedKey(attr.name, el.getAttribute(attr.name)));
    }
    const kids = [...el.children];
    for (let i = 0; i < kids.length; i++) walk(kids[i], n.children?.[i]);
  };
  walk(was, node);
  return out;
}

// One element of the edited document, against the one it came from and the
// chain node behind that. `was` and `node` are undefined for an element the
// editor added, which is then written entirely from its own text.
function merge(wanted, was, node) {
  const [ns, name] = splitName(wanted.tagName);
  // `from` is the chain node this element came from, undefined for one the
  // editor added. Every attribute below carries the same. It is what lets
  // chain-patch.mjs work out that a control is the control it was and rewrite
  // only what changed inside it, instead of the chain being written again.
  const built = { name, ns, attrs: [], children: [], from: node };

  // The builder sets attributes; it has no call that puts text between two
  // tags. A view that wants text says `<Text text="…"/>`, which is also what
  // the reconstruction shows - so text here is something the editor typed and
  // this has to refuse rather than drop.
  for (const child of wanted.childNodes) {
    if ((child.nodeType === 3 || child.nodeType === 4) && child.nodeValue.trim() !== "") {
      return no(`\`${wanted.tagName}\` has text inside it. The builder writes attributes, not text between tags.`);
    }
  }

  for (const attr of wanted.attributes) {
    if (!node && rendered.has(renderedKey(attr.name, attr.value))) {
      return no(
        `\`${wanted.tagName}\` reads like a control that was moved or copied: its \`${attr.name}\` shows what an ` +
          "event or a binding renders as, and written back from the view it would become a plain string. " +
          "Move or copy the control in the ABAP.",
      );
    }
    const before = node?.attrs.find((a) => a.name === attr.name);
    // Untouched: the value reads exactly as it was shown, so whatever ABAP
    // produced it goes back unchanged - a bind stays a bind.
    const untouched = before !== undefined && was?.getAttribute(attr.name) === attr.value;
    built.attrs.push(
      untouched
        ? { name: attr.name, raw: before.raw, boolean: before.boolean, key: before.key, literal: before.literal, from: before }
        : { name: attr.name, raw: abapLiteral(attr.value), boolean: false, key: "v", literal: attr.value, from: before },
    );
  }

  // And the attributes the reconstruction never showed (see alignNode( ) in
  // chain-read.mjs): they are in the chain, they were not on screen, so they
  // cannot have been edited and they cannot have been deleted either.
  for (const attr of node?.attrs ?? []) {
    if (!attr.hidden || built.attrs.some((a) => a.name === attr.name)) continue;
    built.attrs.push({ name: attr.name, raw: attr.raw, boolean: attr.boolean, key: attr.key, literal: attr.literal, from: attr });
  }

  // In the order the chain has them, and what is new after them - not in the
  // order of the document. The parser lists namespace declarations before
  // every other attribute whatever order they were written in, so a control's
  // block written in document order moved `height` below the `xmlns` lines of
  // a root that had it first (and a hidden attribute, which the document does
  // not have at all, to the end). Order is not a property of the view; the
  // chain's is the one somebody chose. A stable sort, so new attributes keep
  // the order they were typed in.
  if (node) {
    const at = (attr) => (attr.from && node.attrs.includes(attr.from) ? node.attrs.indexOf(attr.from) : Infinity);
    built.attrs.sort((a, b) => at(a) - at(b));
  }

  const wantedKids = [...wanted.children];
  const wasKids = was ? [...was.children] : [];
  const { paired, ambiguous } = pairChildren(wantedKids, wasKids, node?.children ?? []);
  if (ambiguous !== undefined) {
    return no(
      `\`${wantedKids[ambiguous].tagName}\` appears more than once in \`${wanted.tagName}\` reading the same in the ` +
        "view but with different ABAP behind it (an event or a binding shows as the same text), so which of them " +
        "this edit keeps cannot be told. Make this change in the ABAP.",
    );
  }
  for (let i = 0; i < wantedKids.length; i++) {
    const at = paired[i];
    const child = merge(wantedKids[i], at === undefined ? undefined : wasKids[at], at === undefined ? undefined : node?.children[at]);
    if (!child.ok) return child;
    built.children.push(child.element);
  }
  return { ok: true, element: built };
}

const splitName = (tagName) => {
  const at = tagName.indexOf(":");
  return at === -1 ? ["", tagName] : [tagName.slice(0, at), tagName.slice(at + 1)];
};

// Which element of the edited level came from which element of the original
// one: the longest common subsequence of their tag names, so an inserted or a
// deleted control shifts nothing around it. Returns, per edited child, the
// index of its original or undefined.
//
// By name first, and among same-named candidates by how many attribute values
// still agree. By name alone, deleting the first of two `<Button>`s paired the
// survivor with the deleted one's original - its bind frozen into the text it
// happened to show, the deleted button's event on it - and inserting a
// `<Button>` in front of two shifted every original one place along. The
// agreement is a fraction below 1, so it only ever breaks ties between
// pairings of the same length; two identical `<Column>`s still pair first
// with first.
//
// Which is a guess whenever the two read the same and are NOT the same ABAP.
// Every event shows as `.eB()`: delete the first of two `<Button text="Go"
// press=".eB()"/>`s and nothing on screen says which one went, yet one of them
// raises FIRST and the other SECOND. So an edited child that some best pairing
// gives to one original and another, equally good, gives to a different one
// is reported as `ambiguous` (its index) when the ABAP behind those originals
// differs - and the edit is refused rather than one of them picked. Identical
// ABAP is no ambiguity at all: either way the same code comes back.
// `origins` is the chain nodes behind `was`, index for index.
function pairChildren(wanted, was, origins = []) {
  const rows = wanted.length;
  const cols = was.length;
  const score = (i, j) => {
    if (wanted[i].tagName !== was[j].tagName) return -1;
    const attrs = [...wanted[i].attributes];
    const agree = attrs.filter((a) => was[j].getAttribute(a.name) === a.value).length;
    return 1 + agree / (1 + Math.max(attrs.length, was[j].attributes.length));
  };
  const table = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
  const scores = Array.from({ length: rows }, () => new Array(cols));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      const s = (scores[i][j] = score(i, j));
      table[i][j] = Math.max(table[i + 1][j], table[i][j + 1], s >= 0 ? table[i + 1][j + 1] + s : -Infinity);
    }
  }
  const paired = new Array(rows).fill(undefined);
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    const s = scores[i][j];
    if (s >= 0 && table[i][j] === table[i + 1][j + 1] + s) {
      paired[i] = j;
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }

  // The same table from the front: `ahead[i][j]` is the best pairing of the
  // first i edited children with the first j originals. A pair (i, j) is in
  // SOME best pairing exactly when the best before it, its own score and the
  // best after it add up to the best there is. The scores are fractions, so
  // the comparison allows for rounding - two pairings that really differ do so
  // by far more than that.
  const ahead = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const s = scores[r - 1][c - 1];
      ahead[r][c] = Math.max(ahead[r - 1][c], ahead[r][c - 1], s >= 0 ? ahead[r - 1][c - 1] + s : -Infinity);
    }
  }
  const best = table[0][0];
  for (let r = 0; r < rows; r++) {
    const options = [];
    for (let c = 0; c < cols; c++) {
      const s = scores[r][c];
      if (s >= 0 && Math.abs(ahead[r][c] + s + table[r + 1][c + 1] - best) < 1e-9) options.push(c);
    }
    if (new Set(options.map((c) => (origins[c] ? abapOf(origins[c]) : ""))).size > 1) return { paired, ambiguous: r };
  }
  return { paired, ambiguous: undefined };
}

// A chain node and everything under it as the ABAP that builds it - what two
// originals have to agree on for it not to matter which one an edited child
// is paired with. Runs of whitespace count as one: a value wrapped onto a
// second line in one of them is the same code.
const abapOf = (node) =>
  `${node.ns}:${node.name}(${node.attrs.map((a) => `${a.name}|${a.key}|${String(a.raw).replace(/\s+/g, " ")}`).join(",")})` +
  `[${node.children.map(abapOf).join(";")}]`;
