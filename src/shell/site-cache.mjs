// The page's half of the service worker (src/shell/sw.js): registering it once
// the page is up, and throwing it away - with every cache it wrote - when the
// page has reason to think it is serving a mix of two builds. See "What a
// visitor waits for" in docs/design/load-time.md for how that mix came about.

// Registers the service worker that makes a second visit cheap - see
// src/shell/sw.js for what it keeps and what it deliberately leaves alone.
//
// Last, once the page is up and the app is running. The worker fills its cache
// by fetching the heavy assets itself, and every one of them is in the
// browser's cache by now because this page has just downloaded them - so doing
// it here costs almost nothing, where doing it during boot would have put those
// fetches next to the ones the visitor is actually waiting on. Nothing on the
// page depends on any of this working.
export function keepAssetsForNextTime() {
  if (!("serviceWorker" in navigator)) return;
  // No scope given: a worker's default scope is the directory it was served
  // from, which is the site's own directory at an origin root and under a
  // GitHub Pages project path alike.
  navigator.serviceWorker.register(new URL("sw.js", document.baseURI)).catch(() => {
    // A browser that will not have one - a private window, a policy, an origin
    // that is not secure - loses the second visit's head start and nothing
    // else. There is nothing here to tell anybody about.
  });
}

// Whether a service worker is serving this page - the only case in which
// there is a cached copy to throw away. Without one, saying it was discarded
// was untrue and the reload asked for changed nothing.
export const servedFromCache = () => Boolean(navigator.serviceWorker?.controller);

// The opposite of keepAssetsForNextTime( ): every cache this site wrote and
// the worker that serves from them, gone, so the next load fetches the site
// as it is now. Nothing here can fail in a way worth reporting - a browser
// without either has nothing to discard.
export async function discardCachedSite() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.unregister();
  } catch {
    // No worker, or no permission to ask - nothing to throw away.
  }
  try {
    for (const name of await caches.keys()) {
      if (name.startsWith("abap2ui5-playground-")) await caches.delete(name);
    }
  } catch {
    // No Cache API, or a storage that refuses - the reload fetches fresh anyway.
  }
}
