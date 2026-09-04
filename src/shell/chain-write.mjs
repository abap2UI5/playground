// Writing a z2ui5_cl_ui5_view_builder chain, in the layout the repositories
// hold their chains in.
//
// The other half of chain-read.mjs. What comes in is a tree whose attributes
// each carry the ABAP that is to stand on the right of the `=` - the original
// expression for a value nobody touched, a fresh literal for one that was
// edited - and what goes out is a single chain statement.
//
// The layout is not decoration. It is the only thing that makes a chain
// legible as the XML tree it stands for, and it is checked: the abap2UI5
// linter's `chain-house-layout` rule is the same rules written as a checker,
// and a chain written here has to pass it. They are, in the order they show up
// below:
//
//   1. one call per line, every line opening with `)->`
//   2. four spaces per level - a child one level in from its container, a
//      control's attributes one level in from the control
//   3. the closing parenthesis rides with the arrow; the whole view ends in a
//      single `).`
//   4. `end( )` alone, in the column of the `ele( )` it closes
//   5. one attribute per line, the `v =` / `b =` column aligned across a
//      control's block
//
// And the blank lines, which are their own rule: a blank after a control's
// last attribute before its first child, a blank before the first of a run of
// tags, a blank before an `end( )` - and nowhere else. They are what turns a
// hundred-line chain into a page with paragraphs in it.
//
// The single-chain shape is what this writes, always, even for a view that was
// read out of the split shape (a statement per subtree, held in variables).
// The two are equally correct and the split one is the better read for a view
// filled from a loop - but a chain that came through here has been rebuilt from
// an XML document, which has no statements in it to preserve, and inventing a
// split would mean inventing names for its parts.
import { qnameOf } from "./chain-read.mjs";

const STEP = 4;

/**
 * One ABAP statement building `element`.
 *
 * `indent` is the column the statement starts in, `assignment` the text before
 * the factory call (`DATA(view) = `) - kept from the chain that was read, so
 * whatever the rest of the method calls the view keeps its name.
 *
 * Every node is `{ name, ns, attrs: [{ name, raw, boolean }], children }`,
 * where `raw` is ABAP written out as it stands.
 */
export function writeViewChain({ indent, assignment, element }) {
  const pad = " ".repeat(indent);
  const lines = [`${pad}${assignment}z2ui5_cl_ui5_view_builder=>factory(`];
  emit(element, 0, lines, { indent, previous: undefined, first: true, parentHasAttrs: false });
  // A trailing `end( )` may be left off, and a column of them at the bottom of
  // a view is nothing but noise: `stringify( )` renders from the root however
  // deep the chain stopped. The blank line that went with them goes too.
  while (lines.length > 1 && /^\s*(\)->end\(|)$/.test(lines[lines.length - 1])) lines.pop();
  // Rule 3: one closing parenthesis for the call the last line opened, and the
  // full stop of the statement - never a row of them.
  lines[lines.length - 1] += " ).";
  return lines.join("\n");
}

// One element and everything under it. `state` carries what the blank-line
// rules need to know about the line before this one: whether this is the first
// child of its parent, whether that parent carries attributes, and what kind
// of thing was emitted last.
function emit(node, depth, lines, state) {
  const leaf = node.children.length === 0;
  const column = state.indent + STEP + STEP * depth;
  const pad = " ".repeat(column);

  // A blank after a control's last attribute, before its first child; and a
  // blank in front of a run of tags that follows something which is not one.
  // Nothing else opens a block, which is why a bare `ele( )` whose children
  // follow immediately gets none.
  const opensBlock =
    (state.first && state.parentHasAttrs) || (leaf && !state.first && state.previous !== "tag");
  if (opensBlock) lines.push("");

  lines.push(`${pad})->${leaf ? "tag" : "ele"}( ${nameArguments(node)}`);
  for (const line of attributeLines(node, column + STEP)) lines.push(line);

  if (leaf) return "tag";

  let previous;
  node.children.forEach((child, i) => {
    previous = emit(child, depth + 1, lines, {
      indent: state.indent,
      previous,
      first: i === 0,
      parentHasAttrs: node.attrs.length > 0,
    });
  });

  // Rule 4: the `end( )` in the column of the `ele( )` it closes, alone on its
  // line - which is what makes an ascent over several levels visible instead
  // of hidden at the end of somebody else's line. A blank in front of it,
  // unless the line before is another `end( )`: those stack.
  if (previous !== "end") lines.push("");
  lines.push(`${pad})->end(`);
  return "end";
}

// `n = \`View\` ns = \`mvc\`` for an element in a namespace, and the positional
// `\`Page\`` for the ordinary case - which is how the repositories write them,
// and it is the shorter read where there is nothing to disambiguate.
function nameArguments(node) {
  if (node.ns === "") return abapLiteral(node.name);
  return `n = ${abapLiteral(node.name)} ns = ${abapLiteral(node.ns)}`;
}

// Rule 5: one attribute per line, and the values in one column across the
// block - so a control's attributes read as a table rather than as a ragged
// edge. The width is the block's own, not a number fixed here: an `id` beside
// a `noDataText` would otherwise push every view's values into column forty.
function attributeLines(node, column) {
  const pad = " ".repeat(column);
  const names = node.attrs.map((attr) => `n = ${abapLiteral(attr.name)}`);
  const width = Math.max(0, ...names.map((n) => n.length));
  return node.attrs.map(
    (attr, i) =>
      `${pad})->a( ${names[i].padEnd(width)} ${attr.boolean ? "b" : "v"} = ${wrapped(attr.raw, column + STEP)}`,
  );
}

// A value that runs over several lines - a `&&` concatenation, a wrapped
// `t_arg` list - carried across with its own shape and re-anchored.
//
// The lines after the first come out of the chain that was read, where they
// were indented for the column that call stood in. The rewrite puts the call
// somewhere else, so keeping those columns would leave a paragraph of ABAP
// floating at the indent of a chain that no longer exists. What is kept is
// their shape RELATIVE to each other; what is replaced is where the block
// starts, which is one level in from the call, the same as any other content.
function wrapped(raw, column) {
  const lines = String(raw).split("\n");
  if (lines.length === 1) return raw;
  const rest = lines.slice(1);
  const common = Math.min(...rest.filter((l) => l.trim() !== "").map((l) => l.length - l.trimStart().length));
  const pad = " ".repeat(column);
  return [lines[0], ...rest.map((l) => (l.trim() === "" ? "" : pad + l.slice(common)))].join("\n");
}

// A value as an ABAP string literal. Backticks rather than quotes throughout -
// the framework and every sample write them - so the one character that has to
// be escaped is the backtick, by doubling it.
export const abapLiteral = (value) => "`" + String(value).replaceAll("`", "``") + "`";

// What this cannot write, said before anything is written rather than as a
// syntax error in the editor afterwards. A line break is the whole list: an
// ABAP string literal cannot carry one, and a view that wants one writes it as
// `&#xA;` in the XML, which arrives here as a real newline after the parse.
export function unwritable(element) {
  const walk = (node) => {
    if (/[\r\n]/.test(node.name) || /[\r\n]/.test(node.ns)) return `\`${qnameOf(node)}\` is not a name.`;
    for (const attr of node.attrs) {
      if (attr.literal !== undefined && /[\r\n]/.test(attr.literal)) {
        return `\`${attr.name}\` has a line break in it, which an ABAP string literal cannot carry.`;
      }
    }
    for (const child of node.children) {
      const why = walk(child);
      if (why) return why;
    }
    return undefined;
  };
  return walk(element);
}
