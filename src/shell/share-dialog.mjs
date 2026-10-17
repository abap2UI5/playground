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
// click. Nothing is stored, and the dialog is rebuilt on every open. The one
// thing it holds between opens is the GitHub token of the Gist section, in
// this module's memory for the visit (gist.mjs says why never in storage),
// and whether the reader said they know code from a link ran in this page.
import { abapGitZip, download, endingInOneNewline } from "./export.mjs";
import { createGist } from "./gist.mjs";
import { layoutEditorSection } from "./layout-editor.mjs";
import { linkedCodeRan } from "./linked-code.mjs";
import { copyToClipboard } from "./share.mjs";
import { closeOnBackdrop, setStatus } from "./ui.mjs";

let dialog;
let body;
// What the shell knows about where a file came from (unchangedRawUrl( ) in
// original.mjs), for the Layout editor section.
let rawUrlOf = () => undefined;

export function setUpShareDialog(hooks = {}) {
  if (hooks.unchangedRawUrl) rawUrlOf = hooks.unchangedRawUrl;
  dialog = document.getElementById("share-dialog");
  body = document.getElementById("share-body");
  // A click on the backdrop closes it, the way a modal is expected to.
  closeOnBackdrop(dialog);
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
  // Named, and loaded when it nears the screen: the frame is a whole ABAP
  // runtime and a corpus parse, and the embed kit's own rule is that nothing
  // boots before it is wanted. A frame with no title is also a frame a screen
  // reader can only call "frame".
  return `<iframe src="${embedded.href}" title="abap2UI5 example" loading="lazy" width="100%" height="520" style="border:0"></iframe>`;
}

// The fence the documentation writes an example in. One per file, the app
// first: docs/.vitepress/playground.mjs over in the documentation decides on
// its own whether a fence gets a Run button, from the class inside it.
const markdownSnippet = (files) => files.map((f) => "```abap\n" + endingInOneNewline(f.source) + "```").join("\n\n");

function escapeAttribute(text) {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// A section: a heading, a sentence, the text in a box, and Copy.
function section({ title, blurb, text, rows = 4, copy = "Copy" }) {
  const wrap = document.createElement("section");
  wrap.className = "share-section";

  const head = document.createElement("h3");
  head.textContent = title;
  // The box is named by its heading, and each Copy says which box it copies:
  // three unnamed text boxes and three buttons all called "Copy" were what a
  // screen reader got.
  head.id = `share-${title.replace(/\W+/g, "-").toLowerCase()}`;

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
  area.setAttribute("aria-labelledby", head.id);

  const row = document.createElement("div");
  row.className = "config-row";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = copy;
  button.setAttribute("aria-label", `${copy}: ${title}`);
  const status = document.createElement("span");
  status.className = "config-said";
  status.setAttribute("role", "status");
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
// Where a link stops being pasteable: most chat clients and mail programs keep
// a URL whole to about 2,000 characters and cut it beyond that, and a cut
// fragment decodes to nothing (the page then opens on the sample and says so).
const LONG_LINK = 2000;

export function openShare(files, url, copied = false) {
  if (!dialog) return;
  const frag = document.createDocumentFragment();

  frag.append(
    section({
      title: "Link",
      blurb:
        "Everything open, in the address - it never leaves the browser." +
        (copied ? " Already in your clipboard." : "") +
        // Six files deflate to more than a chat client keeps in one line:
        // some cut a URL past ~2,000 characters and the fragment arrives
        // torn. The zip below is the hand-over that survives that.
        (url.length > LONG_LINK
          ? ` This link is ${url.length.toLocaleString("en-US")} characters, and some chat clients truncate a URL past 2,000 - for a set this size, Download for abapGit below is the safer hand-over.`
          : ""),
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
  frag.append(gistSection(files));
  frag.append(layoutEditorSection(files, rawUrlOf(files[0])));

  body.replaceChildren(frag);
  // Share awaits the link and the clipboard before it gets here, so a second
  // press can arrive while the dialog is open - and showModal( ) on an open
  // dialog is an InvalidStateError in older engines.
  if (!dialog.open) dialog.showModal();
}

// The token for the Gist section: typed once per visit, never stored and
// never left in the field (gist.mjs).
let gistToken = "";

// A GitHub gist of the open files - written with the reader's token, opened
// again with ?gist=<id>.
function gistSection(files) {
  const wrap = document.createElement("section");
  wrap.className = "share-section";
  const head = document.createElement("h3");
  head.id = "share-gist-title";
  head.textContent = "Gist";
  const blurb = document.createElement("p");
  blurb.className = "config-blurb";
  blurb.textContent =
    "A secret GitHub gist of these files, written with your token (a fine-grained one with the gist permission is " +
    "enough) - held for this visit only and never stored. The gist opens here again with ?gist=<id>.";

  const row = document.createElement("div");
  row.className = "config-row";
  const token = document.createElement("input");
  token.type = "password";
  token.id = "share-gist-token";
  token.className = "config-text share-token";
  token.autocomplete = "off";
  token.spellcheck = false;
  token.placeholder = gistToken ? "token held for this visit" : "GitHub token (github_pat_… or ghp_…)";
  token.setAttribute("aria-label", "GitHub token for the gist");
  const button = document.createElement("button");
  button.type = "button";
  button.id = "share-gist";
  button.textContent = "Create gist";
  const status = document.createElement("span");
  status.className = "config-said";
  status.id = "share-gist-said";
  status.setAttribute("role", "status");
  row.append(token, button, status);

  // Code from a link has run in this page (linked-code.mjs): it could read a
  // token typed here as easily as the reader can. Not refused - the reader
  // may know the link is their own - but not taken silently either: the
  // field and the button wait for a tick under a sentence saying why, and
  // where the safe place is. Once per visit. Code the reader wrote, a draft
  // or a sample never see this.
  const caution = gistCaution([token, button]);

  const link = document.createElement("textarea");
  link.className = "config-text share-text";
  link.id = "share-gist-link";
  link.readOnly = true;
  link.rows = 2;
  link.hidden = true;
  link.setAttribute("aria-labelledby", head.id);
  link.addEventListener("focus", () => link.select());

  button.addEventListener("click", async () => {
    const typed = token.value.trim();
    if (typed) gistToken = typed;
    token.value = "";
    if (!gistToken) {
      status.textContent = "a GitHub token is needed";
      token.focus();
      return;
    }
    button.disabled = true;
    status.textContent = "writing the gist…";
    try {
      const gist = await createGist(files, { token: gistToken });
      link.value = gist.playgroundUrl;
      link.hidden = false;
      const copied = await copyToClipboard(gist.playgroundUrl);
      status.textContent = copied ? "created - the link is in your clipboard" : "created";
      token.placeholder = "token held for this visit";
    } catch (e) {
      // A refused token is forgotten, so the next try asks for another.
      if (/token/.test(String(e?.message))) gistToken = "";
      status.textContent = String(e?.message ?? e);
    } finally {
      button.disabled = false;
    }
  });

  wrap.append(head, blurb, ...(caution ? [caution] : []), row, link);
  return wrap;
}

// Set once the reader ticked the box below - for the visit, like the token.
let linkedAcknowledged = false;

// The warning and its box, with `controls` disabled until the box is ticked;
// nothing when no link's code has run here or the reader already said yes.
function gistCaution(controls) {
  if (!linkedCodeRan() || linkedAcknowledged) return undefined;
  const box = document.createElement("div");
  box.className = "share-caution";
  box.id = "share-gist-caution";
  const said = document.createElement("p");
  said.textContent =
    "Code from a link ran in this page. It runs with the page's own rights and could read a token typed here. " +
    "The safe place for a token is the playground opened without the link - your changes come back there as " +
    "your last session.";
  const label = document.createElement("label");
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.id = "share-gist-trust";
  label.append(tick, " I trust where this link came from - use my token here");
  for (const control of controls) control.disabled = true;
  tick.addEventListener("change", () => {
    linkedAcknowledged = tick.checked;
    for (const control of controls) control.disabled = !tick.checked;
  });
  box.append(said, label);
  return box;
}
