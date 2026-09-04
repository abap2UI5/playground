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
//   anything else          nothing: this returns undefined and the caller
//                          writes the chain again, which is what an added or
//                          deleted control has always done.
//
// The claim that makes it safe is narrow and checked before a single character
// moves: the edited tree and the chain's tree are the same tree - same
// elements, same order, every one of them paired with the original it came
// from - and each control carries exactly the attributes it carried, as a
// bijection onto them. Under that, the ABAP around the edit still builds
// exactly what it built, so leaving it alone is not an optimisation, it is the
// correct rewrite.
//
// One thing it deliberately does not do: attributes reordered in the XML are
// left in the order the chain has them. Order is not a property of the view
// worth a diff across a control's whole block.
import { STEP, attributeLines } from "./chain-write.mjs";

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
  return applyEdits(source, edits);
}

// One element against the original it came from. Returns false the moment the
// two are not the same element, which is what confines this to the case it can
// reason about; the edits collected so far are dropped with it.
function collect(built, node, source, edits) {
  if (!node || built.from !== node) return false;
  if (built.name !== node.name || built.ns !== node.ns) return false;

  if (sameAttributes(built, node)) {
    for (const attr of built.attrs) {
      if (attr.raw === attr.from.raw && attr.boolean === attr.from.boolean) continue;
      if (attr.from.keyAt === undefined || attr.from.valueEnd === undefined) return false;
      edits.push({
        start: attr.from.keyAt,
        end: attr.from.valueEnd,
        text: `${attr.boolean ? "b" : "v"} = ${attr.raw}`,
      });
    }
  } else {
    const block = attributeEdit(built, node, source);
    if (!block) return false;
    edits.push(block);
  }

  if (built.children.length !== node.children.length) return false;
  for (let i = 0; i < built.children.length; i++) {
    if (!collect(built.children[i], node.children[i], source, edits)) return false;
  }
  return true;
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
  const lines = attributeLines(built, column);
  // Nothing left to write: the block's own line goes as well, or the closing
  // parenthesis would be left standing in column zero. A chain that opens the
  // file has no such line to take, and is left to the writer.
  if (lines.length === 0) {
    if (first - column === 0) return undefined;
    return { start: first - column - 1, end, text: "" };
  }
  return { start: first - column, end, text: lines.join("\n") };
}

// A control that had none and has some now: the block opens directly behind
// the control's own arguments, one level in - in front of whatever whitespace
// stood between them and the parenthesis that closes the call, so that
// parenthesis stays on the line it was on.
function openingBlock(built, node, source) {
  if (!node.span || node.span.start === undefined) return undefined;
  const column = columnOf(source, node.span.start);
  if (column === undefined) return undefined;
  const lines = attributeLines(built, column + STEP);
  if (lines.length === 0) return undefined;
  const at = beforeTrailingSpace(source, node.span.end);
  return { start: at, end: at, text: "\n" + lines.join("\n") };
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
