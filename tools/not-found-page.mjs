// dist/404.html - the page for an address that is not a page, written by
// tools/sample-pages.mjs beside the sample pages it is one of.
//
// Its own module because it is its own program: a page of prose and, under it,
// a guesser that runs in the reader's browser over the whole list of classes,
// two hundred lines of inline script that have nothing to do with how a
// sample page is laid out. The frame - bar, footer, theme and menu - is the
// same as theirs, from tools/sample-frame.mjs.
import { BASE, MENU_SCRIPT, PAGE_SCRIPT, SEARCH_SCRIPT, THEME_SCRIPT, bar, foot } from "./sample-frame.mjs";

/* ---- THE PAGE FOR AN ADDRESS THAT IS NOT A PAGE ------------------------
 *
 * GitHub Pages answers anything it cannot find under this deployment with the
 * 404.html at the root of the artefact, and this deployment had none. A
 * mistyped sample, a class that was renamed upstream, a link into
 * /playground/ that has gone stale: all of them landed on GitHub's own white
 * page - no bar, no search, no way on. The manual has carried one of these for
 * a while; this is the same page for the other half of the origin.
 *
 * ABSOLUTE URLS, and this is the one page here that needs them. It is served
 * for /playground/samples/<typo>/ and for /playground/<typo> alike, so a
 * relative href resolves against whatever address missed - `../../samples/`
 * from a two-deep miss is right and from a one-deep miss leaves the site. The
 * base is SITE's own path, which is where every canonical link on these pages
 * already says this deployment lives.
 */
export function notFoundPage(rows) {
  /* WHAT THE ADDRESS ALMOST SAID. Samples get renamed and dropped upstream,
     and this build removes their pages on the next deploy - every link to one
     of them, in an issue, a blog post or somebody's bookmarks, lands here. A
     page that only says "not here" makes the reader go and search for
     something they had already named.
     The whole list is IN this page: 771 class names and titles, about 40 kB,
     so nothing is fetched to answer and the answer arrives with the page. */
  const near = JSON.stringify(rows.map((row) => [row.dir, row.title])).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found · abap2UI5</title>
<meta name="description" content="This address does not name a page of the abap2UI5 sample catalog.">
<!-- Served with a 404 status, which is what a crawler goes by - and said here
     as well, for the case where it is not (a preview, a mirror, a proxy that
     rewrites the status). -->
<meta name="robots" content="noindex">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f5f7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e2024">
<link rel="icon" href="${BASE}favicon.png">
<link rel="apple-touch-icon" href="${BASE}apple-touch-icon.png">
<link rel="preload" href="${BASE}fonts/inter-roman-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${BASE}samples/catalogue.css">
<link rel="stylesheet" href="${BASE}samples/sample.css">
${THEME_SCRIPT}
</head>
<body data-not-found>

<!-- The keyboard's way in. A sample page puts a link on every line of the
     printed class and the catalogue puts one on every sample, so the bar and
     the header were a long way to tab past to reach either. Same link, same
     wording and same first-stop position as the manual's. -->
<a class="skip" href="#main">Skip to content</a>

${bar(BASE, "none")}

<main id="main" tabindex="-1" class="sample">
  <div class="sample-body">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="${BASE}samples/">Sample catalog</a></nav>
  <h1>This page is not here</h1>
  <p class="lede">The address does not name a page of this deployment. A sample may have been
    renamed or dropped by the repository it comes from, or the link that brought you here may
    simply be old.</p>
  <p>The <a href="${BASE}samples/">catalog</a> searches every sample by what it does, by the
    control it builds and by the release your system runs; <a href="${BASE}samples/all/">the full
    list</a> is all of them on one page; the <a href="${BASE}">playground</a> runs ABAP in this
    browser with no system behind it; and the
    <a href="https://abap2ui5.github.io/docs/get_started/about">documentation</a> is where the
    project explains itself. The box in the bar searches the manual and every sample at once.</p>
  <div id="near" hidden><h2>Did you mean</h2><ul class="nearby"></ul></div>
  </div>
</main>

${foot(BASE)}
<script>
/* WHAT THE ADDRESS ALMOST SAID, ranked here rather than fetched - the list is
   in this page, see the comment where it is built.
   Words first: the last parts of the address, minus the ones nearly every
   sample carries (z2ui5, cl, smp, app), scored against the titles and the
   class names. That is what answers ".../z2ui5_cl_smpc_app_wizard/" with the
   Wizard samples and ".../all.html" with the full list.
   Then, and only for an address shaped like a class, how close the NAME is:
   ".../z2ui5_cl_smp_app_49/" has no word left to go on, and what it wants is
   the classes whose names are one character away.
   (No backticks and no backslashes in here: the whole block is inside a
   template literal, which eats both.) */
(function () {
  var rows = ${near};
  /* The three pages that are always here, searched with the samples: an
     address is as easily wrong about one of these as about a class, and
     /samples/all.html - the full list, at the address it does not have - is a
     guess this repository has itself made. */
  var pages = [
    ["samples/all/", "Every abap2UI5 sample", "the full list, all of them on one page"],
    ["samples/", "abap2UI5 sample catalog", "search every sample"],
    ["", "abap2UI5 Playground", "write ABAP and run it in this browser"]
  ];
  var base = ${JSON.stringify(BASE)};
  /* A stray % in the address (50%off, a cut escape) is a URIError out of the
     decoder, and the page that is about wrong addresses offered nothing. */
  var here;
  try { here = decodeURIComponent(location.pathname); } catch (e) { here = location.pathname; }
  var parts = here.slice(here.indexOf(base) === 0 ? base.length : 0)
    .toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
  if (!parts.length) return;

  /* A WORD NEARLY EVERY SAMPLE CARRIES SAYS NOTHING. Counted rather than
     listed: the class prefixes are the three repositories business and change
     without this file hearing about it. */
  var words = parts.filter(function (w) {
    /* And the words of an abapGit file name: /z2ui5_cl_x.clas.abap is how a
       ?src= link names a class, and "abap" began "abap2UI5" in three page
       titles while "clas" began "Classes". */
    if (w === "samples" || w === "playground" || w === "html" || w === "index"
        || w === "clas" || w === "intf" || w === "abap" || w === "xml") return false;
    var seen = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i][0].indexOf(w) >= 0) seen++;
    return seen * 4 < rows.length;
  });

  /* A WORD, NOT A RUN OF LETTERS. "here" is inside "Where" and inside "There",
     and an address that says nothing at all - /playground/nothing-like-this/ -
     matched a dozen titles that way; the reader is then given a list instead of
     an honest "no idea". A title word that BEGINS with the word is the match,
     which still catches the plural and the possessive. */
  /* ...AND A SHORT WORD IS THE WHOLE WORD OR NOTHING. "not" begins
     "Notification" and "for" begins "Form", so /nope-not-here/ was answered
     with five Notification List samples - a list of guesses about an address
     that named nothing. Three letters are a prefix of too many words to mean
     one; from four up the prefix still catches the plural and the possessive,
     which is what it is for. */
  function starts(text, word) {
    var w = text.toLowerCase().split(/[^a-z0-9]+/);
    for (var i = 0; i < w.length; i++) {
      if (w[i] === word) return true;
      if (word.length >= 4 && w[i].indexOf(word) === 0) return true;
    }
    return false;
  }

  var scored = [];
  var byWord = false;
  /* A segment that IS a class name is the answer, whatever else the address
     says - /samples/z2ui5_cl_smp_app_004.clas.abap, or a page asked for with
     something after it. */
  var segsAll = here.toLowerCase().split(/[\/.]+/);
  for (var e = 0; e < rows.length; e++) {
    if (segsAll.indexOf(rows[e][0]) >= 0) scored.push([1e9, "samples/" + rows[e][0] + "/", rows[e][1], rows[e][0].toUpperCase()]);
  }
  if (words.length && !scored.length) {
    for (var k = 0; k < pages.length; k++) {
      var page = pages[k];
      var pageHit = 0;
      for (var w1 = 0; w1 < words.length; w1++) {
        var word = words[w1];
        /* The address and the name, never the sentence beside it: that one is
           ordinary prose, and "this" or "here" in an address would match it. */
        if (page[0].indexOf(word) >= 0 || starts(page[1], word)) pageHit += 4;
      }
      if (pageHit) scored.push([pageHit + 1, page[0], page[1], page[2]]);
    }
    for (var m = 0; m < rows.length; m++) {
      var hit = 0;
      byWord = true;
      for (var w2 = 0; w2 < words.length; w2++) {
        if (starts(rows[m][1], words[w2])) hit += 3;
        else if (words[w2].length >= 4 && rows[m][0].indexOf(words[w2]) >= 0) hit += 1;
      }
      if (hit) scored.push([hit, "samples/" + rows[m][0] + "/", rows[m][1], rows[m][0].toUpperCase()]);
    }
  }

  /* HOW CLOSE TWO CLASS NAMES ARE, for an address that named one and left no
     word behind. They all begin z2ui5_cl_, so what tells them apart is the
     tail: what still agrees at the front, plus what agrees at the back, less
     what is left over in between. The whole segment, not the words above: it
     is the name that is nearly right, and splitting it on its underscores is
     what threw the part that was wrong away. */
  /* The segment that looks like a class name, not merely the last one:
     /samples/z2ui5_cl_x_y/foo/ named the class and then something else. */
  var segs = here.split("/").filter(Boolean);
  var last = (segs.filter(function (s) { return s.toLowerCase().indexOf("z2ui5") === 0; }).pop() || "").toLowerCase().split(".")[0];
  if (!scored.length && last.indexOf("z2ui5") === 0) {
    for (var n = 0; n < rows.length; n++) {
      var name = rows[n][0];
      var pre = 0;
      while (pre < last.length && pre < name.length && last.charAt(pre) === name.charAt(pre)) pre++;
      var suf = 0;
      while (suf < last.length - pre && suf < name.length - pre
             && last.charAt(last.length - 1 - suf) === name.charAt(name.length - 1 - suf)) suf++;
      if (pre > 8) {
        scored.push([pre + suf - Math.abs(last.length - name.length),
                     "samples/" + name + "/", rows[n][1], name.toUpperCase()]);
      }
    }
  }
  if (!scored.length) return;

  scored.sort(function (a, b) { return b[0] - a[0]; });
  var box = document.getElementById("near");
  var list = box.querySelector("ul");
  var best = scored[0][0];
  /* Only what is genuinely close. One good answer beats eight, and a list of
     eight unrelated samples is the same white page with more words on it. Half
     the best score where the score counts words matched, and one character
     where it measures how near a name is - on names that differ in their last
     digit, everything within two is the whole rest of the repository. */
  var cutoff = byWord ? best / 2 : best - 1;
  var shown = 0;
  for (var r = 0; r < scored.length && shown < 8; r++) {
    if (scored[r][0] < cutoff) break;
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.href = base + scored[r][1];
    a.textContent = scored[r][2];
    var who = document.createElement("span");
    who.textContent = " - " + scored[r][3];
    li.appendChild(a);
    li.appendChild(who);
    list.appendChild(li);
    shown++;
  }
  if (shown) box.hidden = false;
})();
</script>
${MENU_SCRIPT}
${SEARCH_SCRIPT(BASE)}
${PAGE_SCRIPT(BASE)}
</body>
</html>
`;
}
