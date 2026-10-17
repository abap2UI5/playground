// The two DOM globals the XML modules reach for - DOMParser and Node - for
// the unit tests, which run in Node and have neither.
//
// @xmldom/xmldom parses; the one thing it does differently from a browser is
// what happens to XML that is not well-formed: it throws, where a browser
// answers a document with a <parsererror> element in it. The modules under
// test look for that element (prettyXml returns its input, alignWithXml
// refuses), so the shim turns the throw into one - the browser's contract,
// which is the one the code was written against.
import { DOMParser as XmlDomParser, Node } from "@xmldom/xmldom";

class DOMParser {
  parseFromString(text, type) {
    const strict = new XmlDomParser({
      onError(level) {
        if (level !== "warning") throw new Error("not well-formed");
      },
    });
    try {
      return strict.parseFromString(text, type);
    } catch {
      return new XmlDomParser().parseFromString("<parsererror/>", "application/xml");
    }
  }
}

export function installDom() {
  globalThis.DOMParser = DOMParser;
  globalThis.Node = Node;
}
