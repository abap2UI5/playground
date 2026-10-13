// Code a link carries, asked about before it runs - on the AI Pilot's page.
//
// The Pilot opens an app from a share link (the fragment) or from ?src=, and
// that app runs in the app frame: same origin as this page, no sandbox, with
// the frame reaching into the page through the bridge. The API key the reader
// types into the chat lives in this page's memory and its DOM, and a view's
// core:HTML with a script in it can read both. So on the one page where a
// key and a stranger's code meet, the code is opened only once the reader
// said so (`#linked-dialog` in index.html). The playground itself has no key
// and asks nothing; the AI Studio opens no links at all.
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
