// @ts-check
// The files on screen, handed to another of the site's tools in a tab of its
// own: the AI App Builder's build to the playground (to go on by hand) or to
// the AI Agent (to have it used), the playground's code to the AI Agent.
//
// The way across is the one every share link takes - the files deflated into
// the fragment (share.mjs), never sent anywhere - and the page on the other
// side opens it the way it opens a link: the playground at once, the Agent
// only after the reader said so (linked-code.mjs; the app is what the model
// reads and acts on). A new tab rather than this one, so the conversation,
// the run and the undo stacks here stay where they are.
//
// The three pages are one deployment: ai/ and pilot/ carry <base href="../">,
// so "pilot/" and "./" resolve against the site's root from all three.
import { encodeFiles } from "./share.mjs";

/** @typedef {{ name: string, source: string }} File */

export const HAND_OFF_TARGETS = {
  playground: { path: "./", label: "Playground", blurb: "go on by hand - editor, debugger, Share" },
  pilot: { path: "pilot/", label: "AI Agent", blurb: "have the AI use the app while you watch" },
};

/** The address of `tool` with `files` in its fragment.
 *  @param {keyof typeof HAND_OFF_TARGETS} tool
 *  @param {File[]} files */
export async function handOffUrl(tool, files) {
  const url = new URL(HAND_OFF_TARGETS[tool].path, document.baseURI);
  url.hash = await encodeFiles(files);
  return url.href;
}

/** Opens `tool` on `files` in a new tab. The tab is opened inside the click -
 *  a popup blocker lets a click open one, not a promise resolved after it -
 *  and pointed at the address once the files are encoded.
 *  @param {keyof typeof HAND_OFF_TARGETS} tool
 *  @param {File[]} files */
export async function openIn(tool, files) {
  const tab = window.open("about:blank", "_blank");
  const url = await handOffUrl(tool, files);
  if (tab) {
    // No way back to this page from the new one: what runs there is a link's
    // code, and the opener would hand it this window.
    tab.opener = null;
    tab.location.href = url;
  } else {
    window.location.assign(url);
  }
  return url;
}

/** The Share dialog's section that hands the playground's code to the AI
 *  Agent (share-dialog.mjs), in the dress of the layout editor's beside it.
 *  @param {File[]} files */
export function pilotSection(files) {
  const wrap = document.createElement("section");
  wrap.className = "share-section";
  const head = document.createElement("h3");
  head.textContent = "AI Agent";
  const blurb = document.createElement("p");
  blurb.className = "config-blurb";
  blurb.textContent =
    "Have the AI use this app while you watch: it reads the screen, fills the fields and presses the buttons. " +
    "Opens in a new tab and asks before it runs the code; it needs an API key or a model on your machine.";
  const row = document.createElement("div");
  row.className = "config-row";
  const button = document.createElement("button");
  button.type = "button";
  button.id = "share-pilot";
  button.textContent = "Open in AI Agent";
  button.addEventListener("click", () => {
    openIn("pilot", files);
  });
  row.append(button);
  wrap.append(head, blurb, row);
  return wrap;
}
