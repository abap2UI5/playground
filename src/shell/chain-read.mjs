// Reading a z2ui5_cl_ui5_view_builder chain back out of ABAP.
//
// The View tab shows the XML a chain produces; editing that XML and writing
// the chain back needs the other direction as well, and needs it to keep more
// than the shape. A chain is full of expressions that are not literals -
// `client->_bind( t_flight )`, `client->_event( \`COUNT\` )`, a string template
// - and the reconstruction the linter shows renders them as what they will
// mean at run time (`{/T_FLIGHT}`, `.eB()`). Generating ABAP from that
// rendering alone would silently turn every binding in the view into a
// hard-coded string. So this reads the chain into a tree in which every
// attribute keeps the ABAP that produced it, verbatim, and the writer puts
// that ABAP back for every attribute the editor did not touch.
//
// It is an interpreter, not a parser of ABAP: it executes the four builder
// methods against a tree exactly as the class does (see the ABAP Doc at the
// top of z2ui5_cl_ui5_view_builder - `a( )` lands on the last child if there
// is one and on the node itself if there is not), which is why a chain in the
// split shape - a statement per subtree, held in variables - reads correctly
// without this knowing anything about the shapes.
//
// Everything it cannot follow ends as a `why`, never as a guess: a name that
// is not a literal, a LOOP in the middle of the view, a second view in the
// same method. The Edit button is off with that sentence beside it, which is
// the honest answer - the alternative is an edit that quietly drops code.

// ---------------------------------------------------------------- scanning

// Where the strings and the comments are, and a copy of the source with both
// blanked out. Everything below - finding a statement's full stop, matching a
// parenthesis, telling one argument from the next - runs on the mask, so a
// full stop inside a string literal or a comment is not a statement end and a
// parenthesis inside one does not close anything.
//
// The three literal forms and both comment forms, because all five occur in
// the apps this has to read: '...' with '' for a quote, `...` with `` for a
// backtick, |...| with backslash escapes and { } holding ABAP that may itself
// contain any of the three; " to end of line, and * in the first column.
//
// A comment is blanked to spaces and a literal to \x01 - not both to spaces,
// because the mask is also what "is this argument exactly one literal" is
// decided on, and a literal that had become whitespace was trimmed away by
// that question before it could be asked.
// Whether `source` has a comment anywhere in [start, end): a position the mask
// blanked to a space that held something other than whitespace. A rewrite of
// that range would drop the comment, and what nobody edited is not rewritten.
export function commentIn(source, start, end) {
  const { mask } = maskSource(source);
  for (let i = start; i < end; i++) {
    if (mask[i] === " " && !/\s/.test(source[i])) return true;
  }
  return false;
}

function maskSource(source) {
  const mask = source.split("");
  const strings = [];
  const blank = (from, to, fill) => {
    for (let i = from; i < to; i++) if (mask[i] !== "\n") mask[i] = fill;
  };

  let at = 0;
  while (at < source.length) {
    const ch = source[at];
    if (ch === '"' || (ch === "*" && (at === 0 || source[at - 1] === "\n"))) {
      const eol = source.indexOf("\n", at);
      const end = eol === -1 ? source.length : eol;
      blank(at, end, " ");
      at = end;
      continue;
    }
    if (ch === "'" || ch === "`") {
      const end = closingQuote(source, at, ch);
      strings.push({ start: at, end, quote: ch });
      blank(at, end, "\x01");
      at = end;
      continue;
    }
    if (ch === "|") {
      const end = closingTemplate(source, at);
      strings.push({ start: at, end, quote: "|" });
      blank(at, end, "\x01");
      at = end;
      continue;
    }
    at += 1;
  }
  return { mask: mask.join(""), strings };
}

// The index just past the closing quote. A doubled quote is one character of
// the value, not the end - `it''s` and ``a `` b`` are both one literal.
function closingQuote(source, from, quote) {
  let at = from + 1;
  while (at < source.length) {
    if (source[at] === quote) {
      if (source[at + 1] === quote) {
        at += 2;
        continue;
      }
      return at + 1;
    }
    at += 1;
  }
  return source.length;
}

// A string template, taken whole - the embedded { } included, however much
// ABAP is inside them. The braces are counted so that a template inside an
// embedded expression ends the inner one rather than the outer.
function closingTemplate(source, from) {
  let at = from + 1;
  let depth = 0;
  while (at < source.length) {
    const ch = source[at];
    if (ch === "\\") {
      at += 2;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === "|" && depth === 0) return at + 1;
    else if (ch === "|" && depth > 0) {
      at = closingTemplate(source, at);
      continue;
    }
    at += 1;
  }
  return source.length;
}

// The statements, in order, as ranges into the source. A statement ends at the
// first full stop the mask still has - a colon-chained one (`DATA: a, b.`)
// counts as a single statement here, which is right for this reader: a chain
// is never written that way, and anything that is not a chain is refused.
function statementsOf(mask) {
  const statements = [];
  let start = 0;
  for (let at = 0; at < mask.length; at++) {
    if (mask[at] !== ".") continue;
    const text = mask.slice(start, at);
    if (text.trim() !== "") statements.push({ start, end: at + 1 });
    start = at + 1;
  }
  return statements;
}

// The index of the parenthesis closing the one at `from`, on the mask.
function closingParen(mask, from) {
  let depth = 0;
  for (let at = from; at < mask.length; at++) {
    if (mask[at] === "(") depth += 1;
    else if (mask[at] === ")") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

// ------------------------------------------------------------------- nodes

const newNode = (name = "", ns = "") => ({ name, ns, attrs: [], children: [], parent: undefined, span: undefined });

export const qnameOf = (node) => (node.ns === "" ? node.name : `${node.ns}:${node.name}`);

// ---------------------------------------------------------------- the read

const FACTORY = "z2ui5_cl_ui5_view_builder=>factory";
const fail = (why) => ({ ok: false, why });

/**
 * The view-building code in one ABAP source, as a tree that remembers its
 * ABAP. `{ ok: false, why }` when there is nothing to edit or when what is
 * there is more than a chain - `why` is the sentence the panel shows.
 *
 * On success:
 *   start, end   the range of the source the chain occupies, full stop
 *                included - what the writer replaces
 *   indent       the column the first statement starts in
 *   assignment   the text before the factory call (`DATA(view) = `), kept so
 *                the variable the rest of the method uses keeps its name
 *   root         the builder root; its children are the top-level elements
 *   usedAfter    the variables the chain binds that the method uses after it,
 *                which the full rewrite cannot keep (an edit in place can)
 */
export function readViewChain(source) {
  const { mask, strings } = maskSource(source);
  const statements = statementsOf(mask);

  // ABAP does not care how a name is cased, so neither does this:
  // `Z2UI5_CL_UI5_VIEW_BUILDER=>FACTORY( )` builds the same view.
  const buildsView = (s) => mask.slice(s.start, s.end).toLowerCase().includes(FACTORY);
  const first = statements.findIndex(buildsView);
  if (first === -1) return fail("Nothing here builds a view with z2ui5_cl_ui5_view_builder.");
  if (statements.some((s, i) => i > first && buildsView(s))) {
    return fail("This file builds more than one view. Editing is for a method that builds one.");
  }

  const literalAt = (from, to) => {
    const text = mask.slice(from, to);
    const start = from + text.length - text.trimStart().length;
    const end = to - (text.length - text.trimEnd().length);
    const token = strings.find((s) => s.start === start && s.end === end);
    if (!token || token.quote === "|") return undefined;
    const raw = source.slice(start + 1, end - 1);
    return raw.replaceAll(token.quote + token.quote, token.quote);
  };

  const root = newNode();
  const vars = new Map();
  let cursor;
  let assignment;
  let regionStart;
  let regionEnd;

  for (let i = first; i < statements.length; i++) {
    const statement = statements[i];
    const text = mask.slice(statement.start, statement.end);
    // The chain ends where the view is handed over. Everything after that is
    // somebody else's code and is left exactly as it is.
    if (i > first && /\bstringify\s*\(/i.test(text)) break;

    const parsed = parseHead(text);
    if (!parsed) {
      return fail(
        i === first
          ? "The chain does not start with a plain assignment - nothing here to rewrite."
          : "The view is built with more than a chain (a LOOP, an IF, a helper). Editing it would drop that code.",
      );
    }

    // Where the chain starts, and what the whole method calls it afterwards.
    if (i === first) {
      regionStart = statement.start + parsed.offset;
      assignment = parsed.assignment;
    } else if (!vars.has(parsed.target)) {
      return fail("The view is built with more than a chain (a LOOP, an IF, a helper). Editing it would drop that code.");
    }

    cursor = i === first ? root : vars.get(parsed.target);

    const walked = walkCalls({
      mask,
      source,
      literalAt,
      from: statement.start + parsed.callsAt,
      to: statement.end - 1,
      cursor,
    });
    if (!walked.ok) return walked;
    cursor = walked.cursor;

    if (parsed.declared) vars.set(parsed.declared, cursor);
    regionEnd = statement.end;
  }

  if (root.children.length !== 1) {
    return fail("The chain does not build exactly one root element - nothing to show as one view.");
  }

  // The names the chain bound that the method still uses after it. The full
  // rewrite is one statement and declares one variable, so a `page` or a
  // `cols` used further down would be a reference to something that no longer
  // exists - but only the full rewrite has that problem. A value changed in
  // place leaves every statement where it was, and refusing it here kept Edit
  // off for the whole view over `page->stringify( )`. So they are reported,
  // and view-edit.mjs refuses exactly the change that would break them. The
  // one that survives a rewrite is the one the assignment names.
  //
  // Looked for up to the end of the method rather than the end of the file: a
  // local `page` in some other method is a different variable, and finding it
  // there refused a view that nothing after its chain touches.
  const kept = /DATA\(\s*(\w+)\s*\)|^\s*(\w+)\s*=/i.exec(assignment ?? "");
  const keptName = (kept?.[1] ?? kept?.[2] ?? "").toLowerCase();
  const methodEnd = /\bENDMETHOD\b/i.exec(mask.slice(regionEnd));
  const after = mask.slice(regionEnd, methodEnd ? regionEnd + methodEnd.index : mask.length);
  const usedAfter = [...vars.keys()].filter((name) => name !== keptName && new RegExp(`\\b${name}\\b`, "i").test(after));

  // The replaced range starts at the beginning of the line when nothing but
  // whitespace stands in front of the chain, so the new statement is written
  // in the column the old one was read in rather than after its own indent.
  const lineStart = source.lastIndexOf("\n", regionStart - 1) + 1;
  const alone = source.slice(lineStart, regionStart).trim() === "";
  return {
    ok: true,
    start: alone ? lineStart : regionStart,
    end: regionEnd,
    indent: alone ? regionStart - lineStart : 0,
    assignment,
    root,
    usedAfter,
  };
}

// `DATA(view) = z2ui5_cl_ui5_view_builder=>factory(` and the three other ways
// a chain statement can begin. Returns where the statement's own text starts
// (the assignment is kept verbatim), where the calls begin, which variable the
// chain hangs off, and which one it binds.
function parseHead(text) {
  const m = /^(\s*)((?:DATA\(\s*\w+\s*\)|\w+)\s*=\s*)?(z2ui5_cl_ui5_view_builder=>factory|[a-z_]\w*)/i.exec(text);
  if (!m) return undefined;
  const [, lead, assign = "", target] = m;
  const declared = /DATA\(\s*(\w+)\s*\)/i.exec(assign)?.[1]?.toLowerCase() ?? /^(\w+)\s*=/.exec(assign)?.[1]?.toLowerCase();
  const isFactory = target.toLowerCase() === FACTORY;
  // A statement that is not a chain at all - a CASE, an assignment to a
  // structure - has no `(` or `->` where one has to be.
  const rest = text.slice(m[0].length);
  if (!/^\s*(\(|->)/.test(rest)) return undefined;
  if (!isFactory && !/^\s*->/.test(rest)) return undefined;
  return {
    offset: lead.length,
    assignment: assign,
    callsAt: m[0].length,
    target: isFactory ? undefined : target.toLowerCase(),
    declared,
  };
}

// The `( … )->ele( … )->a( … )` run of one statement, executed against the
// tree. `cursor` is what the chain is pointing at, exactly as the ABAP
// reference is.
function walkCalls({ mask, source, literalAt, from, to, cursor }) {
  let at = from;
  const skip = () => {
    while (at < to && /\s/.test(mask[at])) at += 1;
  };

  // Where the segment being read begins: the `)` that closed the call before
  // it, which in this chain shape is the character every `)->` line opens
  // with. A call's own text runs from there to its closing parenthesis, and
  // that is the range chain-patch.mjs rewrites when one call has to change.
  // It is undefined for the first call of a continuation statement
  // (`page->tag( … )`), where no such parenthesis stands in front - a call
  // there is not one this can cut out on its own.
  let segment;

  // A `factory( )` whose parenthesis opens the chain rather than a call.
  skip();
  if (mask[at] === "(") {
    const close = closingParen(mask, at);
    if (close === -1 || close > to) return fail("A parenthesis in the chain is never closed.");
    if (mask.slice(at + 1, close).trim() !== "") return fail("factory( ) takes no arguments.");
    segment = close;
    at = close + 1;
  }

  for (;;) {
    skip();
    if (at >= to) return { ok: true, cursor };
    const call = /^->\s*(\w+)\s*(?=\()/.exec(mask.slice(at, to + 1));
    if (!call) return fail("The chain has a call this cannot read.");
    // Where the `->` stands. For the first call of a continuation statement
    // there is no `start`, and this is what chain-patch.mjs measures the
    // statement's column from instead when it opens an attribute block there.
    const head = at;
    at += call[0].length;
    const open = at;
    const close = closingParen(mask, open);
    if (close === -1 || close > to) return fail("A parenthesis in the chain is never closed.");
    const args = readArgs(mask, source, literalAt, open + 1, close);
    const applied = apply(cursor, call[1].toLowerCase(), args, { start: segment, end: close, head });
    if (!applied.ok) return applied;
    cursor = applied.cursor;
    segment = close;
    at = close + 1;
  }
}

// The named arguments of one call, as ranges - `n`, `ns`, `v`, `b` and `t`,
// the only five the builder has - plus the positional form `ele( \`Page\` )`. A
// keyword only counts at depth zero, so a `v = xsdbool( a = b )` is one
// argument rather than two.
function readArgs(mask, source, literalAt, from, to) {
  const marks = [];
  let depth = 0;
  for (let at = from; at < to; at++) {
    const ch = mask[at];
    // Brackets count too: `v = lt[ n = 1 ]-x` is one value, not a value and
    // a second `n =` argument.
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (depth === 0) {
      const m = /^\b(ns|n|v|b|t)\s*=(?!=)/i.exec(mask.slice(at, to));
      if (m && (at === from || /[\s(]/.test(mask[at - 1]))) {
        marks.push({ key: m[1].toLowerCase(), from: at, valueAt: at + m[0].length });
        at += m[0].length - 1;
      }
    }
  }

  const args = {};
  if (marks.length === 0) {
    const text = mask.slice(from, to);
    const valueEnd = from + text.trimEnd().length;
    if (text.trim() !== "") args.positional = { raw: source.slice(from, valueEnd).trim(), literal: literalAt(from, valueEnd) };
    return args;
  }
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].from : to;
    // Measured on the mask, where a comment is blank: a `" note` behind the
    // value is not part of it. Taken from the source it was, and a rewritten
    // chain whose last attribute carried one ended in `" note ).` - a
    // statement with its full stop inside a comment.
    const masked = mask.slice(mark.valueAt, end);
    const valueEnd = mark.valueAt + masked.trimEnd().length;
    args[mark.key] = {
      raw: source.slice(mark.valueAt, valueEnd).trim(),
      literal: literalAt(mark.valueAt, valueEnd),
      // Where the `v = …` / `b = …` starts and where its value ends. It is
      // what lets a changed value be written back over exactly itself instead
      // of the chain being generated again around it - see chain-patch.mjs.
      keyAt: mark.from,
      valueEnd,
    };
  });
  return args;
}

// One builder call against the tree - the whole of the class's semantics, and
// the reason this is an interpreter: `a( )` lands on the last child when there
// is one and on the node itself when there is not, which is what makes `tag( )`
// and `ele( )` both work with the attributes written after them.
function apply(cursor, method, args, span) {
  if (method === "ele" || method === "tag") {
    const name = args.n?.literal ?? args.positional?.literal;
    if (name === undefined) return fail("An element is added under a name this cannot read as a literal.");
    if (args.ns !== undefined && args.ns.literal === undefined) {
      return fail("A namespace prefix is not a literal, so the view cannot be rewritten.");
    }
    const node = newNode(name, args.ns?.literal ?? "");
    node.span = span;
    // `tag` or `ele`: a leaf added with `tag( )` and nothing under it can be
    // taken out of the chain as its own lines (chain-patch.mjs); one added with
    // `ele( )` has an `end( )` somewhere that would then ascend one level too far.
    node.call = method;
    node.parent = cursor;
    cursor.children.push(node);
    return { ok: true, cursor: method === "ele" ? node : cursor };
  }
  if (method === "a") {
    const target = cursor.children.length > 0 ? cursor.children[cursor.children.length - 1] : cursor;
    if (target.name === "") return fail("An attribute is set before any element was added.");
    const name = args.n?.literal;
    if (name === undefined) return fail("An attribute is set under a name this cannot read as a literal.");
    // `t` is the builder's third way to pass a value - text escaped as a
    // literal at run time. Kept under its own key so an untouched one is
    // written back as `t =`; its rendering is the escaped text, so it is not
    // read as a literal to compare against the view.
    const value = args.v ?? args.b ?? args.t;
    if (value === undefined) return fail("An attribute is set without a value.");
    // More than one of them (the builder still takes the old `v = `` b = x`):
    // read as the first, an edit dropped the others or wrote a second value
    // beside them - ABAP the builder refuses at run time - and the read-back
    // check, making the same mistake again, let it through. Not guessed at.
    if ([args.v, args.b, args.t].filter((x) => x !== undefined).length > 1) {
      return fail(`\`${name}\` is given more than one of v, b and t. Pass exactly one in the ABAP first.`);
    }
    // The same attribute twice on one control. The view shows one of them, an
    // edit is matched by name, and whichever one the rewrite kept, the other
    // was gone - on Save with nothing changed. Which of the two is meant is
    // not something to guess.
    if (target.attrs.some((a) => a.name === name)) {
      return fail(`\`${name}\` is set twice on \`${qnameOf(target)}\`. Take one of them out in the ABAP first.`);
    }
    target.attrs.push({
      name,
      raw: value.raw,
      literal: args.v ? args.v.literal : undefined,
      boolean: args.b !== undefined,
      key: args.v ? "v" : args.b ? "b" : "t",
      // The call's own range, and the value's inside it.
      span,
      keyAt: value.keyAt,
      valueEnd: value.valueEnd,
      // Where the name's literal ends - what stands between it and `v =` is
      // the call's own layout, kept by chain-patch.mjs when it is a line break.
      nameEnd: args.n.valueEnd,
    });
    return { ok: true, cursor };
  }
  if (method === "end") {
    if (!cursor.parent) return fail("The chain ascends past its own root.");
    return { ok: true, cursor: cursor.parent };
  }
  return fail(`\`${method}( )\` is not one of the builder's four calls, so the chain cannot be rewritten.`);
}

// ------------------------------------------------------------- the linter's

/**
 * Pairs the tree with the XML the abap2UI5 linter reconstructed from the same
 * chain, so that every attribute knows what it renders as - which is the one
 * thing reading the ABAP cannot work out for `client->_bind( … )`.
 *
 * The pairing is positional and total: same element, same order, all the way
 * down, or it is refused. That is a strong check on purpose. It is what lets
 * the writer decide "this value is untouched, put the original ABAP back"
 * against the text a reader actually edited, and a partial match would make
 * that decision on the wrong attribute.
 */
export function alignWithXml(root, xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return "the reconstructed view is not XML";
  return alignNode(root.children[0], doc.documentElement);
}

// Where the two disagree, as a path into the view, or undefined when they
// agree. A path rather than a yes/no: the panel puts it in the sentence beside
// a disabled Edit, and "at /mvc:View/Shell/Page" is the difference between a
// reader who can look and one who can only shrug.
function alignNode(node, element, where = "") {
  if (!node || !element) return `${where}/?`;
  const at = `${where}/${element.tagName}`;
  if (qnameOf(node) !== element.tagName) return `${at} (the chain says ${qnameOf(node)})`;
  for (const attr of node.attrs) {
    // An attribute the reconstruction left out is not a disagreement. The
    // linter drops a value it cannot resolve - `client->_event_nav_app_leave( )`
    // is on the Page of every sample in abap2UI5/samples - and says so in its
    // notes. It is in the chain, it is simply not on screen, so it is marked
    // and carried through the rewrite untouched. Failing here instead would
    // put Edit out of reach of most real views; dropping it would silently
    // delete the navigation off every one of them.
    if (!element.hasAttribute(attr.name)) {
      attr.hidden = true;
      continue;
    }
    attr.rendered = element.getAttribute(attr.name);
  }
  const children = [...element.children];
  if (children.length !== node.children.length) {
    return `${at} (${node.children.length} children in the chain, ${children.length} in the view)`;
  }
  for (let i = 0; i < children.length; i++) {
    const why = alignNode(node.children[i], children[i], at);
    if (why) return why;
  }
  return undefined;
}
