// Open in Layout Editor - the way back to abap2UI5/layout-editor, which has
// had "Open in Playground" all along. A section of the Share dialog.
//
// What the layout editor reads (its README, "Open ABAP class"): a class by
// URL - `?src=<raw URL>` from raw.githubusercontent.com or
// gist.githubusercontent.com, the playground's own parameter - or pasted
// into its Open ABAP class dialog. Its `#d=` link carries a design of its
// own, not a class. `#playground=` (below) is read from its branch
// claude/zealous-feynman-nf350a on (openClassFromPlayground( ) in its
// src/ui/files.js); a deployment from before that ignores it.
//
// So there are two hand-overs:
//   - the app class is still exactly as it was opened from GitHub: its raw
//     URL as ?src=, which the layout editor opens on its own;
//   - anything else (edited, a draft, a share link, a gist's API read): the
//     class goes to the clipboard, to paste into Open ABAP class there, and
//     the link carries it as well, in this playground's share format behind
//     `#playground=` - the same fragment a share link has (share.mjs), which
//     the layout editor already writes for its own "Open in Playground" and
//     now reads back; where it does not yet, the clipboard is what works.
// Only the app goes - the first file. The layout editor edits one class.
//
// Part of the Share dialog's chunk. Where the class came from is the shell's
// knowledge (unchangedRawUrl( ) in original.mjs), handed in rather than
// imported, which would split deep-link.mjs and file-sets.mjs out of the
// shell into a chunk of their own.
import { copyToClipboard, encodeFiles } from "./share.mjs";

export const LAYOUT_EDITOR_URL = "https://abap2ui5.github.io/layout-editor/";

/** The layout editor's link for the app class: { url, how: "src" | "paste" }.
 *  `raw` is the class's raw GitHub URL when it is unchanged from there. */
export async function layoutEditorLink(app, raw) {
  const url = new URL(LAYOUT_EDITOR_URL);
  if (raw) {
    url.searchParams.set("src", raw);
    return { url: url.href, how: "src" };
  }
  url.hash = `playground=${await encodeFiles([app])}`;
  return { url: url.href, how: "paste" };
}

// The section: a sentence, the button, and what happened.
export function layoutEditorSection(files, raw) {
  const app = files[0];
  const wrap = document.createElement("section");
  wrap.className = "share-section";
  const head = document.createElement("h3");
  head.textContent = "Layout editor";
  const blurb = document.createElement("p");
  blurb.className = "config-blurb";
  blurb.textContent = `Design the view of ${app.name} by drag and drop, and export the class back.`;
  const row = document.createElement("div");
  row.className = "config-row";
  const button = document.createElement("button");
  button.type = "button";
  button.id = "share-layout-editor";
  button.textContent = "Open in Layout Editor";
  button.disabled = true;
  const status = document.createElement("span");
  status.className = "config-said";
  status.id = "share-layout-editor-said";
  status.setAttribute("role", "status");
  row.append(button, status);
  wrap.append(head, blurb, row);

  let link;
  layoutEditorLink(app, raw).then((l) => {
    link = l;
    button.dataset.href = l.url;
    button.disabled = false;
    blurb.textContent +=
      l.how === "src"
        ? " It opens the class from GitHub, where it came from."
        : " The class goes to your clipboard - paste it into Open ABAP class there.";
    if (files.length > 1) blurb.textContent += " Only the app class goes; the layout editor edits one class.";
  }).catch((e) => {
    status.textContent = String(e?.message ?? e);
  });
  button.addEventListener("click", () => {
    if (!link) return;
    // The copy is started inside the click, while the page still has the
    // focus and the gesture - the new tab takes both.
    const copied = link.how === "paste" ? copyToClipboard(app.source) : Promise.resolve(false);
    window.open(link.url, "_blank", "noopener");
    copied.then((yes) => {
      status.textContent =
        link.how === "src"
          ? "opened in a new tab"
          : yes
            ? "opened in a new tab - the class is in your clipboard"
            : "opened in a new tab - copy the class from the editor to paste it there";
    });
  });
  return wrap;
}
