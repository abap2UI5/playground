// The Outline tab: the classes, interfaces, methods and attributes of the
// file on screen, read out of the same registry the editor checks against -
// abaplint answers documentSymbol, so this is a view of an existing analysis
// rather than a second parser that could disagree with the first.
import { currentFile, fileVersion } from "../editor/editor.mjs";
import { documentSymbols } from "../editor/registry.mjs";
import { empty, redrawIf } from "./insight-common.mjs";

export function outlineTab() {
  const file = currentFile();
  const symbols = outlineOf(file);
  if (symbols.length === 0) return empty("Nothing to show yet.");

  const list = document.createElement("ul");
  list.className = "insight-list is-outline";
  for (const symbol of symbols) {
    const item = document.createElement("li");
    const row = document.createElement("button");
    row.type = "button";
    row.className = `insight-row is-symbol depth-${symbol.depth}`;
    row.dataset.file = file;
    row.dataset.line = String(symbol.line);
    row.dataset.column = "1";

    const kind = document.createElement("span");
    kind.className = "insight-kind";
    kind.textContent = symbol.kind;

    const name = document.createElement("span");
    name.className = "insight-what";
    name.textContent = symbol.name;

    row.append(kind, name);
    item.append(row);
    list.append(item);
  }
  return list;
}

// abaplint's symbol kinds are LSP numbers; only the handful ABAP produces are
// named here, and anything else keeps its distance rather than claiming a name.
const KIND = {
  5: "class",
  6: "method",
  7: "field",
  8: "field",
  11: "interface",
  12: "function",
  14: "const",
};

// The outline comes from the registry worker, so it is a round trip: what is
// rendered is the last answer for this file at this version, and a newer one
// is asked for and rendered when it lands. A file mid-edit can be
// unparseable, and an outline is not worth an exception - the underlines
// already say what is wrong - so a failed answer is an empty one.
let outline = { key: undefined, symbols: [] };
let outlineAsked;

function outlineOf(file) {
  if (!file) return [];
  const key = `${file}@${fileVersion(file)}`;
  if (outline.key === key) return outline.symbols;
  if (outlineAsked !== key) {
    outlineAsked = key;
    documentSymbols(file)
      .then((symbols) => flatten(symbols, 0))
      .catch(() => [])
      .then((symbols) => {
        outline = { key, symbols };
        if (`${currentFile()}@${fileVersion(currentFile())}` === key) redrawIf("outline");
      });
  }
  // Until the answer for this file arrives, the last answer only if it was
  // about THIS file (an older version of it is near enough). Another file's
  // symbols were drawn with this file's name on them, and a click went to
  // that file's line numbers in this one.
  return outline.key?.startsWith(`${file}@`) ? outline.symbols : [];
}

function flatten(symbols, depth) {
  const out = [];
  for (const symbol of symbols ?? []) {
    out.push({
      name: symbol.name,
      kind: KIND[symbol.kind] ?? "",
      line: (symbol.range?.start?.line ?? symbol.selectionRange?.start?.line ?? 0) + 1,
      depth: Math.min(depth, 2),
    });
    out.push(...flatten(symbol.children, depth + 1));
  }
  return out;
}
