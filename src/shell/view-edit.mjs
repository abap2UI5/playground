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
import { abapLiteral, unwritable, writeViewChain } from "./chain-write.mjs";
import { alignWithXml, readViewChain } from "./chain-read.mjs";

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

  const built = merge(wanted.element, was.element, chain.root.children[0]);
  if (!built.ok) return built;

  const why = unwritable(built.element);
  if (why) return no(why);

  const text = writeViewChain({ indent: chain.indent, assignment: chain.assignment, element: built.element });
  return { ok: true, source: source.slice(0, chain.start) + text + source.slice(chain.end) };
}

// The edited text as a document, or the parser's complaint in a form somebody
// can act on. A half-typed tag is the normal state of a textarea, so this is
// the message the panel shows most often and it has to be plain.
function parse(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) {
    const said = (error.textContent || "").split("\n").find((line) => line.trim() !== "") ?? "";
    return no(`That is not valid XML yet${said ? ` - ${said.trim()}` : ""}.`);
  }
  if (!doc.documentElement) return no("There is no view here.");
  return { ok: true, element: doc.documentElement };
}

// One element of the edited document, against the one it came from and the
// chain node behind that. `was` and `node` are undefined for an element the
// editor added, which is then written entirely from its own text.
function merge(wanted, was, node) {
  const [ns, name] = splitName(wanted.tagName);
  const built = { name, ns, attrs: [], children: [] };

  // The builder sets attributes; it has no call that puts text between two
  // tags. A view that wants text says `<Text text="…"/>`, which is also what
  // the reconstruction shows - so text here is something the editor typed and
  // this has to refuse rather than drop.
  for (const child of wanted.childNodes) {
    if (child.nodeType === 3 && child.nodeValue.trim() !== "") {
      return no(`\`${wanted.tagName}\` has text inside it. The builder writes attributes, not text between tags.`);
    }
  }

  for (const attr of wanted.attributes) {
    const before = node?.attrs.find((a) => a.name === attr.name);
    // Untouched: the value reads exactly as it was shown, so whatever ABAP
    // produced it goes back unchanged - a bind stays a bind.
    const untouched = before !== undefined && was?.getAttribute(attr.name) === attr.value;
    built.attrs.push(
      untouched
        ? { name: attr.name, raw: before.raw, boolean: before.boolean, literal: before.literal }
        : { name: attr.name, raw: abapLiteral(attr.value), boolean: false, literal: attr.value },
    );
  }

  // And the attributes the reconstruction never showed (see alignNode( ) in
  // chain-read.mjs): they are in the chain, they were not on screen, so they
  // cannot have been edited and they cannot have been deleted either. Written
  // after the ones that were shown, because there is nowhere better to put
  // them - the document being merged from has no opinion about where they sat.
  for (const attr of node?.attrs ?? []) {
    if (!attr.hidden || built.attrs.some((a) => a.name === attr.name)) continue;
    built.attrs.push({ name: attr.name, raw: attr.raw, boolean: attr.boolean, literal: attr.literal });
  }

  const wantedKids = [...wanted.children];
  const wasKids = was ? [...was.children] : [];
  const paired = pairChildren(wantedKids, wasKids);
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
// By name only. Two `<Column>`s in a row are interchangeable to this, and
// pairing the first with the first is both the obvious answer and the one that
// keeps their attributes where the reader left them.
function pairChildren(wanted, was) {
  const rows = wanted.length;
  const cols = was.length;
  const table = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] =
        wanted[i].tagName === was[j].tagName
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const paired = new Array(rows).fill(undefined);
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (wanted[i].tagName === was[j].tagName) {
      paired[i] = j;
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  return paired;
}
