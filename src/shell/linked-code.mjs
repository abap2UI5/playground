// Code a link carries, and what this page asks of the reader because of it.
//
// A share link (the fragment), ?src= and ?gist= put somebody else's ABAP into
// the editor, and Run starts it. It runs in two places, and they reach
// different things:
//
//   - the APP FRAME, where the app's frontend runs - a view's core:HTML with
//     a script in it, anything the app loads. On the AI Studio's and the AI
//     Pilot's pages the frame is on an opaque origin and talks to the page
//     only by message (frame-link.mjs, page.mjs's frameIsolated): it reads
//     nothing of this page, its storage or its fetch. On the playground, its
//     embeds and ?view=app it is this same origin with no sandbox (page.mjs
//     says why), and such a script can read this page's fields and memory,
//     this origin's localStorage, and patch the page's fetch;
//   - the RUNTIME WORKER, where the ABAP itself runs - transpiled to
//     JavaScript, `WRITE '@KERNEL …'` included - on every page. A worker has
//     no DOM and no localStorage, and nothing of the page's memory reaches it
//     (the page sends it roundtrips and classes, never a key). It is this
//     origin, but it gives up the origin's CacheStorage, IndexedDB and
//     nested workers before any of the reader's code runs
//     (src/runtime/lockdown.mjs), and the service worker hashes a cached
//     script against the build before it serves it (verifiedHit( ) in
//     sw.js) - so it cannot leave anything behind for a later visit either.
//     What it keeps is fetch: it can reach the network, as any page can.
//
// What the page holds that is worth taking is what the reader types into it,
// never anything stored:
//
//   - the API key of the AI Studio and the AI Pilot (chat.mjs, pilot.mjs) -
//     in memory for the visit, never stored;
//   - the GitHub token of the Share dialog's Gist section (share-dialog.mjs) -
//     the same rule, on the playground, whose frame is this origin;
//   - and, stored, the provider settings (llm-provider.mjs), which are not a
//     secret but say where the next key goes: a link's code could point the
//     base URL at its own server. llm-form.mjs says on the form where a key
//     will be sent whenever that is not the provider's own default, and the
//     stored value is only read back as an http(s) URL.
//
// So where a link's code and a secret meet, the reader is asked first. On
// the AI Pilot's page - which opens share links and ?src= beside its key -
// the code is opened only once they said so (`#linked-dialog` in index.html,
// confirmLinkedCode( ) below). Neither the frame nor the worker reaches the
// key there any more; what is left is that the app is what the model reads
// and acts on - an app written to mislead Claude can steer what it does in
// that chat (open, run, type into its apps), and the reader should know
// whose app that is before handing it the controls. On the playground,
// a link opens and runs with no question - that is what nine links in ten
// are for - and the question moves to the one place a secret is typed: once
// code from a link has run here (markLinkedCodeRan( ), called by run( ) in
// run.mjs), the Gist section takes no token until the reader has ticked
// that they know (share-dialog.mjs) - there the frame is this origin, and
// reaches the token as it is typed. Code the reader wrote, a draft, a sample
// and the catalogue's classes ask nothing. The AI Studio opens no links at
// all.
//
// None of this is a wall where the frame is this origin - code that runs in
// it can rewrite the page that warns about it. It is the reader being told,
// at the moment it matters, that a fresh page without the link is the safe
// place for a secret.
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
