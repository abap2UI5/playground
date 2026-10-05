// The one module every per-sample page loads beside search.mjs - what those
// pages used to carry as three inline scripts, 15 kB a page across 772 of
// them, and one of the three a hand copy of site-memory.mjs to keep in step by
// hand. The same module the catalogue imports for the bar, the outline walk
// and the line numbers, bundled to dist/samples/page.mjs by tools/build-site.mjs.
//
// Two things stay inline on the page on purpose: the theme, which has to be
// applied before the first paint, and the menu behind the bar's last button,
// which the documentation borrows from one of these pages at build time.
import { keepSiteLinksCurrent, rememberHere } from "../shell/site-memory.mjs";
import { setUpOutline } from "./outline.mjs";
import { setUpLines } from "./lines.mjs";

/* Where the reader is, in the samples: this page. Then the bar - the other
   sections lifted to where they were left, the step back to a page still in
   the tab's history, the offset a bar link hands over. */
/* Not on the page for an address that is not a page (404.html loads this
   module too): written down, it was where every bar's Samples item went
   next - straight back to the miss. */
if (!document.body.hasAttribute("data-not-found")) rememberHere("samples");
keepSiteLinksCurrent();
setUpOutline();
setUpLines();
