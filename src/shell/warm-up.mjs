// The app frame's first load, asked for while the corpus is still parsing.
//
// Nothing asks for UI5 until Run sets the frame's src, and Run is the last
// thing boot does: after the corpus has parsed, after the framework is up,
// after the class has compiled. So on a first visit the frame's own megabyte
// and a half over the wire - the UI5 core, two library preloads, the two theme
// stylesheets, the component - started at the very end of the chain, after
// several seconds during which the network had been idle. On a connection
// where that download is a second or more, the app appeared that much later
// than it had to.
//
// These fetches move it into the idle stretch. They are low priority, so they
// yield to anything the page is actually waiting on, and their answers go
// where the frame will look: the browser's HTTP cache, which the frame's
// requests for the same URLs hit (GitHub Pages serves everything with a
// max-age of ten minutes), and - once the service worker is active - its
// cache, which keeps them for the next visit as well.
//
// The list mirrors what the frame loads first, in the order it loads it, and
// it is allowed to go stale: a file UI5 stops asking for is one fetch nobody
// needed, a file it starts asking for is one it fetches itself as before.
// Nothing here can break the app. The two stylesheets carry the query UI5
// puts on them, because a cache is keyed on the whole URL.
import { UI5_VERSION } from "./ui5-libraries.mjs";

const FIRST_LOAD = (theme) => [
  "app/resources/sap-ui-core.js",
  "app/resources/sap/ui/core/library-preload.js",
  `app/resources/sap/ui/core/themes/${theme}/library.css?sap-ui-dist-version=${UI5_VERSION}`,
  "app/Component-preload.js",
  "app/resources/sap/m/library-preload.js",
  `app/resources/sap/m/themes/${theme}/library.css?sap-ui-dist-version=${UI5_VERSION}`,
  "app/resources/sap/ui/layout/library-preload-lazy.js",
  "app/resources/sap/ui/unified/library-preload-lazy.js",
];

export function warmUpAppFrame(theme) {
  for (const rel of FIRST_LOAD(theme)) {
    // The answer is not read: landing in the cache is the whole point. A
    // failure is not worth reporting either - the frame will ask again, and
    // its failure is the one that means something.
    fetch(new URL(rel, document.baseURI), { priority: "low" })
      .then((r) => r.body?.cancel())
      .catch(() => {});
  }
}
