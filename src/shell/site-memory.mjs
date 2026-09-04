// Where you were, on each of the two sites the bar moves between.
//
// The playground, the sample catalogue and the documentation are three
// deployments on ONE origin (abap2ui5.github.io/playground, /playground/samples
// and /docs), which is what makes this possible at all: they share a
// localStorage the way they already share the theme. Each page writes down
// where it is, and the nav item that points at the OTHER site is lifted to
// whatever that site wrote last. Docs -> Samples -> Docs comes back to the
// page you left rather than to the front of the manual, and because the
// catalogue keeps its filters in its URL (?q=table&lib=sap.m), a filtered
// catalogue comes back filtered.
//
// The href in the markup stays the section's front page. That is what a
// crawler, a reader with no JavaScript and a first visit all get, and it is
// what this falls back to at every step below - nothing here ever makes a link
// worse than the one that was written.
//
// THE PLAYGROUND IS NOT REMEMBERED, only consulted. Its URL carries the code
// in the editor (?src=...), and a Playground item that reopened yesterday's
// sample instead of an empty editor would be a different promise from the one
// the word makes. Samples and docs are places; the playground is a workbench.
import { readStored, writeStored } from "./storage.mjs";

/* The playground's namespace, for a key the documentation site writes too.
 * It is the wrong word for a value shared by three deployments and it is the
 * namespace every other key on this origin already uses - including the theme,
 * which crossed the same line first. One slightly misnamed prefix beats two
 * prefixes that have to be remembered separately. */
const KEY = {
  samples: "abap2ui5-playground:last-samples",
  docs: "abap2ui5-playground:last-docs",
};

/** Where this page is, in the form a link can be set to. */
const here = () => location.pathname + location.search + location.hash;

/**
 * Write down that the reader is here. `site` is "samples" or "docs" - the
 * section this page belongs to, not the one it links at.
 */
export function rememberHere(site) {
  if (KEY[site]) writeStored(KEY[site], here());
}

/**
 * Lift every `[data-site]` nav link to the page that site was last left on.
 *
 * A stored value is untrusted: anything running on this origin can put
 * anything in it, and a stale one outlives the page it named. So it is not
 * assigned, it is CHECKED - resolved against this origin first, and kept only
 * if what comes back is still inside the path the markup's own href points at.
 * That is what turns "//evil.example/x" (a different origin), "/docs/../x" (a
 * path that normalises out of the section) and "javascript:…" (an origin of
 * "null") into three links that are simply left alone.
 */
export function upgradeSiteLinks(root = document) {
  for (const a of root.querySelectorAll("a[data-site]")) {
    const last = readStored(KEY[a.dataset.site]);
    if (!last) continue;
    try {
      /* The section, from the link that is already written. Taking it from the
       * markup rather than from a constant is what lets this work unchanged on
       * a dev server, where the three sites sit at other paths - and what makes
       * a link to another HOST (no shared storage, so nothing to restore) fall
       * through the origin test below. */
      const base = new URL(a.getAttribute("href"), location.href);
      if (base.origin !== location.origin) continue;
      const target = new URL(last, location.origin);
      if (target.origin !== location.origin) continue;
      if (!target.pathname.startsWith(base.pathname)) continue;
      a.href = target.pathname + target.search + target.hash;
    } catch {
      /* A stored value that will not parse as a URL at all. The link keeps the
       * href it was written with. */
    }
  }
}
