// Colour for the XML and the JSON the bottom panel shows.
//
// The panel prints three kinds of text a reader scans rather than reads: the
// view a builder chain produces, the view an answer carried, and the request
// and response as they travelled. All three are structure - an element, its
// attributes, a key, a value - and in one colour the structure is exactly the
// thing that is hardest to see. This gives each part its own, in the shape the
// SAP sample pages use: names in red, values in blue for XML and green for
// JSON, punctuation dimmed out of the way.
//
// Two rules hold this file together.
//
// **Nothing is ever built as markup.** Every piece of text goes into a text
// node, every span is created and appended - so a view whose attribute value
// contains `<script>` is a value with angle brackets in it and can never be
// anything else. A highlighter that assembled an HTML string would put the
// panel one careless template literal away from running the ABAP author's
// text as script, and the panel shows text from a shared link.
//
// **A text it cannot read comes back whole.** Both scanners fall back to a
// plain text node for anything that does not match - a truncated tag, a
// response that is not JSON at all - because a panel that is a little grey
// beats one that is missing a line.

/** One `<span class="…">text</span>`, as a node rather than as markup. */
function piece(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

// The scanner is deliberately not an XML parser: what it is given has already
// been through DOMParser once (xml-pretty.mjs) and is being shown, not
// interpreted. It walks tags and leaves everything between them as text,
// which is what colour needs and no more.
export function highlightXml(text) {
  const out = document.createDocumentFragment();
  let at = 0;

  const plain = (upto) => {
    if (upto > at) out.append(document.createTextNode(text.slice(at, upto)));
  };

  while (at < text.length) {
    const open = text.indexOf("<", at);
    if (open === -1) break;
    plain(open);
    at = open;

    if (text.startsWith("<!--", at)) {
      const close = text.indexOf("-->", at + 4);
      const end = close === -1 ? text.length : close + 3;
      out.append(piece("code-comment", text.slice(at, end)));
      at = end;
      continue;
    }

    const tag = readTag(text, at);
    if (!tag) {
      // A `<` that opens nothing this scanner knows - a stray one in text, or
      // a tag the pretty printer cut. It is text like any other.
      out.append(document.createTextNode("<"));
      at += 1;
      continue;
    }
    out.append(tag.nodes);
    at = tag.end;
  }
  plain(text.length);
  return out;
}

// `<name attr="value" …>`, `</name>` or `<name …/>`, starting at `from`.
// Returns the coloured nodes and where the tag ended, or nothing at all when
// what stands there is not a tag - the caller then treats the `<` as text.
function readTag(text, from) {
  const head = /^<(\/?)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)/.exec(text.slice(from));
  if (!head) return undefined;

  const nodes = document.createDocumentFragment();
  nodes.append(piece("code-punct", `<${head[1]}`), piece("code-tag", head[2]));
  let at = from + head[0].length;

  // The attributes, until the tag closes. A `>` inside a quoted value is part
  // of the value, which is the whole reason this is scanned rather than cut at
  // the next angle bracket.
  for (;;) {
    const rest = text.slice(at);
    const close = /^(\s*)(\/?>)/.exec(rest);
    if (close) {
      if (close[1] !== "") nodes.append(document.createTextNode(close[1]));
      nodes.append(piece("code-punct", close[2]));
      return { nodes, end: at + close[0].length };
    }
    const attr = /^(\s+)([^\s=/>]+)(\s*=\s*)("[^"]*"|'[^']*')/.exec(rest);
    if (!attr) {
      // Something in the tag this does not understand. Colour what was
      // recognised and hand the rest back as text rather than guessing.
      const end = text.indexOf(">", at);
      const stop = end === -1 ? text.length : end + 1;
      nodes.append(document.createTextNode(text.slice(at, stop)));
      return { nodes, end: stop };
    }
    nodes.append(
      document.createTextNode(attr[1]),
      piece("code-attr", attr[2]),
      piece("code-punct", attr[3]),
      piece("code-value", attr[4]),
    );
    at += attr[0].length;
  }
}

// JSON as one pass of a single regular expression: a string (a key when a
// colon follows it), a number, one of the three words, or a bracket. Anything
// that matches nothing - whitespace, and whatever a malformed body holds -
// stays uncoloured text, so this never rejects a body it was handed.
const JSON_TOKEN = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]/g;

export function highlightJson(text) {
  const out = document.createDocumentFragment();
  let at = 0;
  JSON_TOKEN.lastIndex = 0;
  for (let m = JSON_TOKEN.exec(text); m !== null; m = JSON_TOKEN.exec(text)) {
    if (m.index > at) out.append(document.createTextNode(text.slice(at, m.index)));
    out.append(piece(jsonClass(m[0], text, m.index), m[0]));
    at = m.index + m[0].length;
  }
  if (at < text.length) out.append(document.createTextNode(text.slice(at)));
  return out;
}

function jsonClass(token, text, index) {
  if (token[0] === '"') {
    // The lookahead in the pattern already decided this, but the pattern's two
    // string branches are otherwise identical - so the answer is read off the
    // text rather than off which branch matched, which no group survives.
    return /^\s*:/.test(text.slice(index + token.length)) ? "code-key" : "code-string";
  }
  if (token === "true" || token === "false" || token === "null") return "code-atom";
  if (/^[-\d]/.test(token)) return "code-number";
  return "code-punct";
}

// What a `<pre>` in the panel is filled with: the text, coloured, or the text
// as it came when it is neither of the two things this file knows.
export function highlighted(text, kind) {
  if (kind === "xml") return highlightXml(text);
  if (kind === "json") return highlightJson(text);
  return document.createTextNode(text);
}
