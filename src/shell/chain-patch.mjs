// Putting an edited view back as an edit, rather than as a new chain.
//
// `chain-write.mjs` writes a whole chain from a tree, and that is the honest
// answer for a view whose shape changed. It is the wrong answer for the edit
// people actually make. Change one word in the View tab and the chain that
// came back was a *different rendering of the same code*: the split shape (a
// statement per subtree, held in variables - the shape of the framework's own
// apps and of most of abap2UI5/samples) collapsed into one chain, the
// namespace declarations moved to the front, blank lines appeared, and every
// continuation line was re-anchored. A one-word change arrived as a
// forty-line diff, and the one word was somewhere inside it.
//
// The house layout is not the problem and unifying it would not have helped:
// the layout rules live in the abap2UI5 linter's `chain-house-layout` rule
// (the `view-chain-layout` skill in the framework repository writes them out),
// chain-write.mjs writes to them, and `tests/view-edit.spec.js` runs the rule
// over what it wrote. Both chains here were correct. They were simply not the
// same chain, because the whole thing had been generated again - and the fix
// for that is to stop generating what nobody edited.
//
// So this is tried first, and takes the smallest range that can be rewritten
// correctly:
//
//   a value changed        the value, and nothing else. `v = \`Greet\`` becomes
//                          `v = \`Say hello\`` where it stands; the line keeps
//                          its column, the statement keeps its shape, and the
//                          rest of the method is byte for byte what it was.
//   a control's attributes  that control's attribute block, rewritten in the
//   added or removed        house layout. The whole block rather than the one
//                          line, because the `v =` column is aligned across a
//                          block and a line spliced into it would leave the
//                          others pointing at nothing.
//   a leaf control         its own lines, when they are the whole of it: a
//   taken out              `tag( )` with its attributes directly behind it,
//                          each opening its own line (leafRemoval( ) below).
//   anything else          nothing: this returns undefined and the caller
//                          writes the chain again, which is what an added
//                          control has always done.
//
// The claim that makes it safe is narrow and checked before a single character
// moves: the edited tree and the chain's tree are the same tree - same
// elements, same order, every one of them paired with the original it came
// from, bar at most one leaf per control taken out - and each control carries
// exactly the attributes it carried, as a bijection onto them. Under that, the
// ABAP around the edit still builds exactly what it built, so leaving it alone
// is not an optimisation, it is the correct rewrite. And it is checked again
// after: the patched source is read back and has to build the tree that was
// asked for, or the edit goes to the writer instead.
//
// One thing it deliberately does not do: attributes reordered in the XML are
// left in the order the chain has them (view-edit.mjs sorts them back into it,
// new ones last). Order is not a property of the view worth a diff across a
// control's whole block.
import { STEP, attributeLines } from "./chain-write.mjs";
import { commentIn, qnameOf, readViewChain } from "./chain-read.mjs";

/**
 * `source` with `built` written back over the chain it came from, or
 * `undefined` when this edit is not one that can be made in place.
 *
 * `built` is the merged element out of view-edit.mjs, whose nodes and
 * attributes carry `from` - the chain node and the chain attribute each came
 * from - and `node` is the chain's own root element.
 */
export function patchChain(source, built, node) {
  const edits = [];
  if (!collect(built, node, source, edits)) return undefined;
  const patched = applyEdits(source, edits);
  if (!patched) return undefined;
  // And the claim checked on what came out rather than trusted: the patched
  // source, read back, has to build exactly the tree that was asked for -
  // every control, every attribute in its order, every value's ABAP. Ranges
  // cut out of a chain somebody else wrote are where a wrong assumption would
  // show, and one that shows here costs the full rewrite instead of a broken
  // view.
  const again = readViewChain(patched.source);
  if (!again.ok || treeOf(again.root.children[0]) !== treeOf(built)) return undefined;
  return patched;
}

// A tree as the ABAP that builds it, for the comparison above. Runs of
// whitespace count as one: a wrapped value is the same value however its
// continuation lines are indented.
const treeOf = (node) =>
  `${qnameOf(node)}(${node.attrs.map((a) => `${a.name}|${a.key}|${String(a.raw).replace(/\s+/g, " ")}`).join(",")})` +
  `[${node.children.map(treeOf).join(";")}]`;

// One element against the original it came from. Returns false the moment the
// two are not the same element, which is what confines this to the case it can
// reason about; the edits collected so far are dropped with it.
function collect(built, node, source, edits) {
  if (!node || built.from !== node) return false;
  if (built.name !== node.name || built.ns !== node.ns) return false;

  if (sameAttributes(built, node)) {
    for (const attr of built.attrs) {
      if (attr.raw === attr.from.raw && attr.boolean === attr.from.boolean && attr.key === attr.from.key) continue;
      if (attr.from.keyAt === undefined || attr.from.valueEnd === undefined) return false;
      // A value wrapped over lines with a comment between them: replaced as a
      // whole, the comment went with it, silently. Handed on instead, to the
      // paths that refuse a chain with a comment where they would write.
      if (commentIn(source, attr.from.keyAt, attr.from.valueEnd)) return false;
      edits.push({
        start: attr.from.keyAt,
        end: attr.from.valueEnd,
        text: `${attr.key ?? (attr.boolean ? "b" : "v")} = ${attr.raw}`,
      });
    }
  } else {
    const block = attributeEdit(built, node, source);
    if (!block) return false;
    edits.push(block);
  }

  // One control taken out is still an edit in place when it is a leaf whose
  // lines can go on their own (see leafRemoval( ) below); any other change in
  // the number of children is a change of shape, and the writer's.
  let kept = node.children;
  if (built.children.length === node.children.length - 1) {
    const gone = node.children.findIndex((child, i) => built.children[i]?.from !== child);
    const removal = leafRemoval(node.children[gone], source);
    if (!removal) return false;
    edits.push(removal);
    kept = node.children.filter((_, i) => i !== gone);
  }
  if (built.children.length !== kept.length) return false;
  for (let i = 0; i < built.children.length; i++) {
    if (!collect(built.children[i], kept[i], source, edits)) return false;
  }
  return true;
}

// The edit that takes one control out of the chain, or undefined when it is
// not one this can cut out exactly. Only a leaf added with `tag( )` whose
// attributes follow it directly, in the same statement, each opening its own
// line: then its lines are the whole of it. Taking them out changes nothing
// else the chain builds - `tag( )` leaves the cursor on the parent, and every
// `a( )` that landed on this leaf is among those lines - so the rest of the
// method, comments and the split shape included, stays what it was. It used
// to be the full rewrite, which a comment anywhere in the chain refuses.
function leafRemoval(leaf, source) {
  if (!leaf || leaf.call !== "tag" || leaf.children.length > 0) return undefined;
  if (!leaf.span || leaf.span.start === undefined) return undefined;
  let previous = leaf.span;
  for (const attr of leaf.attrs) {
    if (!attr.span || attr.span.start !== previous.end) return undefined;
    previous = attr.span;
  }
  // The `)` that closes the leaf's last call - the character the next
  // segment's line opens with, or the one in front of the statement's full
  // stop.
  const last = previous.end;
  const column = columnOf(source, leaf.span.start);
  if (column === undefined) return undefined;
  const start = leaf.span.start - column;

  if (columnOf(source, last) !== undefined) {
    // Whole lines: from the leaf's own line to the end of the line its last
    // value ends on. What follows - a blank, a comment, the next segment -
    // belongs to what comes next and stays. A blank line on each side would
    // then stand together, which the house layout never has, so one goes.
    let end = source.indexOf("\n", beforeTrailingSpace(source, last)) + 1;
    const lineBefore = source.slice(source.lastIndexOf("\n", start - 2) + 1, start);
    const nextBreak = source.indexOf("\n", end);
    const lineAfter = nextBreak === -1 ? "x" : source.slice(end, nextBreak + 1);
    if (start > 0 && lineBefore.trim() === "" && lineAfter.trim() === "") end = nextBreak + 1;
    if (commentIn(source, start, end)) return undefined;
    return { start, end, text: "" };
  }
  // The leaf ends the statement: from the end of what stands before it to
  // the end of its last value, so the ` ).` that closes the statement closes
  // whatever comes before it now. Not over a comment - on the line before
  // either, where the ` ).` would land inside it.
  if (!source.slice(last + 1).trimStart().startsWith(".")) return undefined;
  const from = beforeTrailingSpace(source, leaf.span.start);
  const to = beforeTrailingSpace(source, last);
  if (commentIn(source, source.lastIndexOf("\n", from - 1) + 1, to)) return undefined;
  return { start: from, end: to, text: "" };
}

// Whether this control carries exactly the attributes it carried - a bijection
// onto the chain's, so no attribute was added, removed or duplicated. Order is
// not part of it; see the note at the top.
function sameAttributes(built, node) {
  if (built.attrs.length !== node.attrs.length) return false;
  const seen = new Set();
  for (const attr of built.attrs) {
    if (!attr.from || !node.attrs.includes(attr.from) || seen.has(attr.from)) return false;
    seen.add(attr.from);
  }
  return true;
}

// The edit that rewrites one control's attribute block, or undefined when the
// block is not a shape this can cut out: a run of `)->a( )` calls, each opening
// its own line, following the control's own call. That is the house layout, so
// the chains this is for are exactly the chains it succeeds on - but it is
// checked against the source rather than assumed, because a chain that came
// from somewhere else must fall back to the full rewrite rather than be cut in
// the wrong place.
function attributeEdit(built, node, source) {
  if (node.attrs.length > 0) return replacingBlock(built, node, source);
  return openingBlock(built, node, source);
}

// A control that had attributes: the block runs from the line its first `a( )`
// opens to the parenthesis that closes its last, and is written again in that
// column. When the last attribute went too, the line the block stood on goes
// with it.
function replacingBlock(built, node, source) {
  for (let i = 0; i < node.attrs.length; i++) {
    const span = node.attrs[i].span;
    if (!span || span.start === undefined) return undefined;
    // Contiguous, and directly under their own control: an attribute reached
    // from a second statement, or one with something else in between, is not
    // part of a block this can replace as one range.
    const before = i === 0 ? node.span : node.attrs[i - 1].span;
    if (!before || before.end !== span.start) return undefined;
  }

  const first = node.attrs[0].span.start;
  const column = columnOf(source, first);
  if (column === undefined) return undefined;

  // Up to the last value, not up to the parenthesis that closes it: that
  // parenthesis opens the next segment and belongs to whatever comes after
  // the block - the ` ).` that ends the statement, the `\n    )->end(` that
  // ascends - and every one of those has to be left exactly as it is.
  const end = beforeTrailingSpace(source, node.attrs[node.attrs.length - 1].span.end);
  // A `" note` on an attribute line sits inside that range, and the block is
  // written from the tree, which has no comments: declined, so the comment is
  // not dropped (the full rewrite refuses it as well, and says so).
  if (commentIn(source, first - column, end)) return undefined;
  // Lines joined with the file's own ending - a CRLF file got LF lines in the
  // middle of it.
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  // Every attribute nobody edited keeps the text it has, from its `v =` to
  // the end of its value - only the padding in front of that is written
  // again, because the `v =` column moves with the longest name in the block.
  // Generated instead, a wrapped value came back re-anchored: the
  // continuation lines lined up under `val =` moved to one level in, a diff
  // over lines nobody touched, and taking an added attribute out again did
  // not give back the file that was there.
  const verbatim = (attr) => {
    if (!untouched(attr, node)) return undefined;
    const { nameEnd, keyAt, valueEnd } = attr.from;
    // A `v =` on the line under its name keeps that line break and its indent.
    const gap = nameEnd === undefined ? "" : source.slice(nameEnd, keyAt);
    return (gap.includes("\n") ? gap : "") + source.slice(keyAt, valueEnd);
  };
  const lines = attributeLines(built, column, verbatim);
  // Nothing left to write: the block's own line goes as well, or the closing
  // parenthesis would be left standing in column zero. A chain that opens the
  // file has no such line to take, and is left to the writer.
  if (lines.length === 0) {
    if (first - column === 0) return undefined;
    // The line break in front of it, both characters of it in a CRLF file.
    const lineBreak = source[first - column - 2] === "\r" ? 2 : 1;
    return { start: first - column - lineBreak, end, text: "" };
  }
  return { start: first - column, end, text: lines.join(eol) };
}

// Whether an attribute is the one the chain has, unedited: same ABAP, same
// key, and a range in the source to copy it from.
function untouched(attr, node) {
  const from = attr.from;
  if (!from || !node.attrs.includes(from)) return false;
  if (from.keyAt === undefined || from.valueEnd === undefined) return false;
  return attr.raw === from.raw && attr.key === from.key && attr.boolean === from.boolean;
}

// A control that had none and has some now: the block opens directly behind
// the control's own arguments, one level in - in front of whatever whitespace
// stood between them and the parenthesis that closes the call, so that
// parenthesis stays on the line it was on.
//
// "One level in" from the column the call stands in - or, for a control that
// is the first call of its statement (`page->tag( \`Text\` ).`, the split
// shape's every subtree), from the column the statement does: there is no
// `)` opening that call's line to measure from, and declining it sent an
// added attribute to the full rewrite and collapsed the method's shape.
function openingBlock(built, node, source) {
  if (!node.span) return undefined;
  const column = node.span.start !== undefined ? columnOf(source, node.span.start) : statementColumn(source, node.span.head);
  if (column === undefined) return undefined;
  const lines = attributeLines(built, column + STEP);
  if (lines.length === 0) return undefined;
  const at = beforeTrailingSpace(source, node.span.end);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  return { start: at, end: at, text: eol + lines.join(eol) };
}

// Where a call's content ends: the closing parenthesis walked back over the
// whitespace in front of it, which is the line break and the indent of the
// next segment and is not this call's to move.
function beforeTrailingSpace(source, close) {
  let at = close;
  while (at > 0 && /\s/.test(source[at - 1])) at -= 1;
  return at;
}

// The column a chain segment stands in, or undefined when it does not open its
// own line - a chain written with several calls to a line is one this leaves
// alone.
function columnOf(source, at) {
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  if (source.slice(lineStart, at).trim() !== "") return undefined;
  return at - lineStart;
}

// The indent of the line the call at `head` stands on - the statement's own
// column, for the first call of a statement. Undefined when there is no such
// position to measure from.
function statementColumn(source, head) {
  if (head === undefined) return undefined;
  const lineStart = source.lastIndexOf("\n", head - 1) + 1;
  const line = source.slice(lineStart, head);
  return line.length - line.trimStart().length;
}

// The edits applied, back to front so that every range still means what it
// meant when it was taken. Two ranges that overlap would mean this reasoned
// about one piece of source twice, which it should never do - so it says so by
// declining rather than by writing something plausible.
function applyEdits(source, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return undefined;
  }
  let out = source;
  for (const edit of sorted.reverse()) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return { ok: true, source: out };
}
