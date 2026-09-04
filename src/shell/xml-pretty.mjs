// XML, one element per line, for reading.
//
// The linter reconstructs a view as a single line, which is right for a
// checker and wrong for a person. This puts every element on a line of its
// own, indented by depth, with its attributes beside it - the shape a view is
// written in in the abap2UI5 repositories - and leaves text where it stands.
// Parsed rather than split on angle brackets, so an attribute value that
// contains one does not break the layout; something the parser refuses is
// returned as it came, because a preview that is a little unreadable beats
// one that is missing.
export function prettyXml(xml, indent = "  ") {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return xml;
  const lines = [];
  const walk = (node, depth) => {
    const pad = indent.repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue.trim();
      if (text !== "") lines.push(pad + text);
      return;
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      lines.push(`${pad}<!--${node.nodeValue}-->`);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const attributes = [...node.attributes].map((a) => ` ${a.name}="${escapeAttribute(a.value)}"`).join("");
    const name = node.tagName;
    if (node.childNodes.length === 0) {
      lines.push(`${pad}<${name}${attributes}/>`);
      return;
    }
    // A single piece of text keeps its element on one line - a <Text> with
    // its label inside, rather than three lines for one word.
    const only = node.childNodes.length === 1 ? node.childNodes[0] : undefined;
    if (only?.nodeType === Node.TEXT_NODE) {
      lines.push(`${pad}<${name}${attributes}>${escapeText(only.nodeValue.trim())}</${name}>`);
      return;
    }
    lines.push(`${pad}<${name}${attributes}>`);
    for (const child of node.childNodes) walk(child, depth + 1);
    lines.push(`${pad}</${name}>`);
  };
  walk(doc.documentElement, 0);
  return lines.join("\n");
}

const escapeText = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const escapeAttribute = (text) => escapeText(text).replaceAll('"', "&quot;");
