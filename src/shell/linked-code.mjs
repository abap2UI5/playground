// Code a link carries, and what this page asks of the reader because of it.
//
// A share link (the fragment), ?src= and ?gist= put somebody else's ABAP into
// the editor, and Run starts it in the app frame: same origin as this page,
// no sandbox, with the frame reaching into the page through the bridge. A
// view's core:HTML with a script in it, or a WRITE '@KERNEL …' in the runtime
// worker, can then read this origin's localStorage, read what is typed into
// this page's fields and patch its fetch. What the page holds that is worth
// taking is what the reader types into it, never anything stored:
//
//   - the API key of the AI Studio and the AI Pilot (chat.mjs, pilot.mjs) -
//     in memory for the visit, never stored;
//   - the GitHub token of the Share dialog's Gist section (share-dialog.mjs) -
//     the same rule;
//   - and, stored, the provider settings (llm-provider.mjs), which are not a
//     secret but say where the next key goes: a link's code could point the
//     base URL at its own server. llm-form.mjs says on the form where a key
//     will be sent whenever that is not the provider's own default, and the
//     stored value is only read back as an http(s) URL.
//
// So where a link's code and a secret meet, the reader is asked first. On
// the AI Pilot's page - which opens share links and ?src= beside its key -
// the code is opened only once they said so (`#linked-dialog` in index.html,
// confirmLinkedCode( ) below). On the playground, a link opens and runs with
// no question - that is what nine links in ten are for - and the question
// moves to the one place a secret is typed: once code from a link has run
// here (markLinkedCodeRan( ), called by run( ) in main.mjs), the Gist
// section takes no token until the reader has ticked that they know
// (share-dialog.mjs). Code the reader wrote, a draft, a sample and the
// catalogue's classes ask nothing. The AI Studio opens no links at all.
//
// None of this is a wall - code that runs in this origin can rewrite the
// page that warns about it. It is the reader being told, at the moment it
// matters, that a fresh page without the link is the safe place for a secret.
export function confirmLinkedCode(what) {
  const dialog = document.getElementById("linked-dialog");
  if (!dialog || typeof dialog.showModal !== "function") return Promise.resolve(false);
  document.getElementById("linked-what").textContent = what;
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "open"), { once: true });
    dialog.returnValue = "";
    dialog.showModal();
  });
}

// Whether code a link brought has run in this page - for the visit, whatever
// is in the editor now: a script it started may still be listening after the
// files were replaced.
let linkedCodeHasRun = false;

export function markLinkedCodeRan() {
  linkedCodeHasRun = true;
}

export const linkedCodeRan = () => linkedCodeHasRun;
