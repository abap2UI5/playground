// The models' answers on screen, for both chats - the AI Studio's
// (src/shell/chat.mjs) and the AI Pilot's (src/shell/pilot.mjs). A module of
// its own so that the Pilot's room no longer imports the studio's to get it.
//
// The model answers in markdown. Rendered here into nodes - paragraphs,
// lists, headings, fenced code, tables, `code`, **bold** and https links - and
// never through innerHTML: every character of the answer reaches the page as
// text, so nothing the model writes can be markup.

/** The whole of `text`, rendered into `target` in place of what it held. */
export function renderMarkdown(target, text) {
  target.replaceChildren(...parse(text).blocks);
}

/*
 * An answer as it streams in, rendered delta by delta into an empty `target`
 * - answers the function that takes the next delta.
 *
 * Rendered again from the top on every delta, a long answer cost the square
 * of its length: a few thousand deltas, each one parsing and building every
 * paragraph, table and code block before it once more, on the page's main
 * thread beside Monaco and the app. What is above a point the parse starts
 * afresh from - a blank line outside a code block, or the line after a
 * closed fence, with the next line already begun - cannot change any more:
 * nothing in the parser looks back across it, so the blocks before it are
 * left in place and only the text after it is parsed again. The DOM after
 * every delta is the one renderMarkdown( ) would build from the whole text,
 * and so is the end.
 */
export function streamMarkdown(target) {
  // The text since the last such point, and the nodes drawn for it.
  let tail = "";
  let live = [];
  return (delta) => {
    tail += delta;
    const { blocks, settled, from } = parse(tail);
    for (const node of live) node.remove();
    target.append(...blocks);
    live = blocks.slice(settled);
    if (from > 0) tail = tail.split("\n").slice(from).join("\n");
  };
}

// The blocks of `text`, and the last point a parse starts afresh from: the
// first `settled` blocks are final, and line `from` on parses the same on its
// own as it does after them.
function parse(text) {
  const blocks = [];
  let paragraph = [];
  let list;
  let settled = 0;
  let from = 0;
  const endParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(element("p", inline(paragraph.join(" "))));
    paragraph = [];
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = undefined;
  };
  const lines = text.split("\n");
  // Only a line with a line break after it is complete: the last one may
  // still turn into anything ("" into "- item", "``" into a fence).
  const complete = (i) => i < lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      endParagraph();
      endList();
      const code = [];
      for (i += 1; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      const pre = document.createElement("pre");
      const c = document.createElement("code");
      c.textContent = code.join("\n");
      pre.append(c);
      blocks.push(pre);
      // A fence closed on a complete line: the code block is final, and
      // nothing is open after it.
      if (complete(i)) {
        settled = blocks.length;
        from = i + 1;
      }
      continue;
    }
    // A table: a header row, a separator row of dashes, then rows - each
    // cell rendered inline, so a field list the model proposes keeps its
    // columns. Pipes at the edges are optional, as in GitHub's markdown.
    if (/^\s*\|?.*\|.*$/.test(line) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "")) {
      endParagraph();
      endList();
      const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      thead.append(element("tr", cells(line).map((c) => element("th", inline(c)))));
      table.append(thead);
      const tbody = document.createElement("tbody");
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim() !== ""; i++) {
        tbody.append(element("tr", cells(lines[i]).map((c) => element("td", inline(c)))));
      }
      i -= 1;
      table.append(tbody);
      blocks.push(table);
      continue;
    }
    const item = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    if (item) {
      endParagraph();
      const kind = item[1] ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== kind) {
        endList();
        list = document.createElement(kind);
        // A numbered list broken by a nested bullet or a code block goes
        // on with its own number, not with 1 again.
        if (kind === "ol") list.start = Number(item[2]);
      }
      list.append(element("li", inline(item[3])));
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      endParagraph();
      endList();
      blocks.push(element("p", [element("strong", inline(heading[1]))]));
      continue;
    }
    if (line.trim() === "") {
      endParagraph();
      endList();
      // A blank line, complete: whatever was open is closed, and what
      // follows parses as if the text began there.
      if (complete(i)) {
        settled = blocks.length;
        from = i + 1;
      }
      continue;
    }
    endList();
    paragraph.push(line.trim());
  }
  endParagraph();
  endList();
  return { blocks, settled, from };
}

function element(tag, children) {
  const el = document.createElement(tag);
  el.append(...children);
  return el;
}

function inline(text) {
  const nodes = [];
  for (const part of text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https:\/\/[^\s)]+\))/)) {
    if (part === "") continue;
    const link = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(part);
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      nodes.push(element("code", [part.slice(1, -1)]));
    } else if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      nodes.push(element("strong", [part.slice(2, -2)]));
    } else if (link) {
      // Only https, opened beside, and never a handle on this page: the
      // address is text the model wrote.
      const a = element("a", [link[1]]);
      a.href = link[2];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      nodes.push(a);
    } else {
      nodes.push(document.createTextNode(part));
    }
  }
  return nodes;
}
