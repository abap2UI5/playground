// The Share dialog: every way this code leaves the playground.
//
// Share used to be one thing, a link in the clipboard, and it still is that
// first - the click copies the link before the dialog is even open, because
// that is what nine presses in ten are for. The dialog is for the tenth: the
// documentation author who wants the block that embeds this demo in a page,
// the fence that puts it in a markdown file, and the developer who wants the
// code on a system, which is a zip for abapGit.
//
// Everything shown is derived from the open files at the moment of the
// click. Nothing is stored, and the dialog is rebuilt on every open.
import { abapGitZip, download } from "./export.mjs";
import { copyToClipboard } from "./share.mjs";
import { setStatus } from "./ui.mjs";

let dialog;
let body;

export function setUpShareDialog() {
  dialog = document.getElementById("share-dialog");
  body = document.getElementById("share-body");
  // A click on the backdrop closes it, the way a modal is expected to.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}

// The embed kit lives beside the playground - see src/embed - so its URL is
// this page's directory plus the script's name, wherever the site is served.
const embedScriptUrl = () => new URL("embed/abap2ui5-embed.js", document.baseURI).href;

// The block the embed kit documents at its top: an element carrying the
// ABAP inline, and the loader. One class travels inline; a playground with
// several files is more than data-code can carry, so those get the frame
// straight from the link - the same page, embedded, with everything in the
// fragment - which is the only way to embed more than one file that does
// not need the files hosted somewhere first.
function embedSnippet(files, url) {
  if (files.length === 1) {
    return (
      `<div class="abap2ui5-demo"\n` +
      `     data-code="${escapeAttribute(files[0].source)}"\n` +
      `     data-height="520"></div>\n` +
      `<script src="${embedScriptUrl()}"></script>`
    );
  }
  const embedded = new URL(url);
  embedded.search = "?embed=1";
  return `<iframe src="${embedded.href}" width="100%" height="520" style="border:0"></iframe>`;
}

// The fence the documentation writes an example in. One per file, the app
// first: docs/.vitepress/playground.mjs over in the documentation decides on
// its own whether a fence gets a Run button, from the class inside it.
const markdownSnippet = (files) => files.map((f) => "```abap\n" + f.source.replace(/\n*$/, "\n") + "```").join("\n\n");

function escapeAttribute(text) {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// A section: a heading, a sentence, the text in a box, and Copy.
function section({ title, blurb, text, rows = 4, copy = "Copy" }) {
  const wrap = document.createElement("section");
  wrap.className = "share-section";

  const head = document.createElement("h3");
  head.textContent = title;

  const said = document.createElement("p");
  said.className = "config-blurb";
  said.textContent = blurb;

  const area = document.createElement("textarea");
  area.className = "config-text share-text";
  area.readOnly = true;
  area.spellcheck = false;
  area.rows = rows;
  area.value = text;
  area.addEventListener("focus", () => area.select());

  const row = document.createElement("div");
  row.className = "config-row";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = copy;
  const status = document.createElement("span");
  status.className = "config-said";
  button.addEventListener("click", async () => {
    const copied = await copyToClipboard(area.value);
    status.textContent = copied ? "copied" : "select the text and copy it";
    if (!copied) area.select();
  });
  row.append(button, status);

  wrap.append(head, said, area, row);
  return wrap;
}

// Opens the dialog over the files given and the link already built for them;
// `copied` says whether the click before this got the link into the
// clipboard, which the first section then need not offer again.
export function openShare(files, url, copied = false) {
  if (!dialog) return;
  const frag = document.createDocumentFragment();

  frag.append(
    section({
      title: "Link",
      blurb:
        "Everything open, in the address - it never leaves the browser." +
        (copied ? " Already in your clipboard." : ""),
      text: url,
      rows: 2,
    }),
    section({
      title: "Embed in a page",
      blurb:
        files.length === 1
          ? "A click-to-load demo for a documentation page: the loader, and the class inline."
          : "Several files are more than the loader carries inline, so this is the playground itself, framed.",
      text: embedSnippet(files, url),
      rows: 6,
    }),
    section({
      title: "Markdown",
      blurb: "The fence a documentation page writes an example in - one per file, the app first.",
      text: markdownSnippet(files),
      rows: 6,
    }),
  );

  // abapGit: no text to show, a file to save.
  const git = document.createElement("section");
  git.className = "share-section";
  const head = document.createElement("h3");
  head.textContent = "abapGit";
  const blurb = document.createElement("p");
  blurb.className = "config-blurb";
  blurb.textContent =
    "A zip of these files with their metadata, laid out as a repository - .abapgit.xml, a README and the " +
    "sources under src/: import it offline with abapGit, or push it as it stands.";
  const row = document.createElement("div");
  row.className = "config-row";
  const button = document.createElement("button");
  button.type = "button";
  button.id = "share-abapgit";
  button.textContent = "Download for abapGit";
  button.addEventListener("click", () => {
    try {
      const zip = abapGitZip(files, url);
      download(zip.name, zip.bytes);
      setStatus(`${zip.name} is on its way`);
    } catch (e) {
      setStatus("the zip could not be written", true);
      console.error(e);
    }
  });
  row.append(button);
  git.append(head, blurb, row);
  frag.append(git);

  body.replaceChildren(frag);
  dialog.showModal();
}
