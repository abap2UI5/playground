# One site in three places

> Design notes, moved out of `AGENTS.md`. Read this before touching the bar, the palette, the font, the search box, `site-memory.mjs` or anything shared with abap2UI5/docs.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## One site in three places

The playground, the sample catalogue at `/samples/` and the
[documentation](https://abap2ui5.github.io/docs/) are three deployments on
**one origin**, and they are meant to be read as one site: the same bar, the
same palette, the same measure. The documentation lives in
[abap2UI5/docs](https://github.com/abap2UI5/docs), which carries its half of
each mechanism below.

**One exception to the one origin: the AI pages' app frame.** On `/ai/` and
`/pilot/` the frame the app renders in is sandboxed onto an opaque origin
(`frameIsolated` in `page.mjs`, [runtime.md](runtime.md)), so the app's code
cannot reach the page where an API key is typed. Such a frame gets no HTTP
cache (Chromium keys its requests on a one-off isolation key) and no service
worker: the warm-up is skipped there and those pages' frame needs the network
on every load, where the installed playground runs offline
([load-time.md](load-time.md)). The playground, its embeds and the sample
pages keep a same-origin frame for that reason.

**The ABAP highlighter is published, and the documentation reads it.**
`tools/abap-highlight.mjs` is a build-time module here — `tools/sample-pages.mjs`
calls it and writes the answer into all 772 pages, so nothing on this site loads
it. The build copies it to `dist/samples/abap-highlight.mjs` anyway, because the
documentation prints the same ABAP and now colours it with **this file** rather
than with a scheme of its own. It is the same borrow the bar and `search.mjs`
already are: one implementation, not two that agree until they don't.

So it is a published surface. Changing what it colours changes the manual as
well as these pages, which is the point — but a rename or a change to the
exported shape (`highlightAbapLines(code) → string[]`, one entry per line, HTML
escaped) breaks a build in the other repository.

**The type is Inter, self-hosted, and it is a shared value like the palette.**
`--font-ui` in `src/catalogue/catalogue.css` and `src/shell/shell.css` names it,
`--vp-font-family-base` in the documentation's `theme/style.css` names the same
string, and `check:design` over there holds the two equal — so changing it means
changing it in three files and landing the playground first, or the
documentation's deploy goes red in between.

It used to lead with `system-ui`, which is to say each reader's own face: SF
Pro on macOS, Segoe UI on Windows, whatever is installed on Linux. That is
defensible and it was the choice for a long time; what it cost is that the same
page is a different page on every desk — the documentation's home page headline
sits on one line in SF Pro and wraps in a Linux browser's fallback. SF Pro
itself may not be redistributed, so what is shipped is the nearest face that
may be: Inter, the two Latin subsets, from `src/fonts/` to `dist/fonts/`, with
the old stack behind it as the fallback. `src/fonts/NOTICE.md` carries the
licence and the reasoning; the two files are in the service worker's core list,
so an installed playground opened offline is the page that was installed.

The one number to know: `dist/fonts/` is where both stylesheets reach by the
same relative `../fonts/…`, because both sit exactly one directory down. The
shell's bundle marks `*.woff2` external for that reason — bundled, esbuild
would copy the files a second time under hashed names beside `assets/`.

**What the bar carries, left to right.** The mark and the name, then the five
sections of the project — **Home**, **Documentation**, **Samples**,
**Playground**, **AI Studio** — then the search box, then the two marks and
the menu behind the last button. Home and Documentation are two pages of the
documentation's deployment; Samples, Playground and the AI Studio are here.
The studio was in the menu only until 2026-10-23, which made it the one door
of the project a reader had to know about to find: the README and the
documentation name four ways in, and the bar named three of them.

Each section carries its **mark** in front of its name — a house, a book, a
window, a play button, a sparkle — in the link's own colour, so the section
you are on is marked twice.
Below 620px the names are clipped away and each mark carries its **short
name** under it instead — Home, Docs, Samples, Play, AI, from `data-short` on the
same span the full word is on: four full names and their marks are 499px of a
390px screen, and the row ran off the end of it, but four marks with no word
were four guesses for a reader who arrived from a link, and a tooltip does not
exist under a thumb. The full name stays clipped rather than `display: none`,
so a screen reader still reads it, and the short one is drawn with an empty
alt (`content: attr(data-short) / ""`) so it is not read twice. The three
copies of the bar say it, and the manual borrows one of them;
`tests/catalogue.spec.js` holds the phone. On the studio's own page
(`ai/index.html`, written from the shell's document by `site-documents.mjs`)
the studio's item is the bold one and Playground is a link again.

**The playground's bar used to be the exception, and is not any more.** It was
one row carrying both the project's bar and this page's workbench — undo,
format, Samples, Run, Auto, Share, Full screen — with the toolbar owning the
middle and the four sections pushed to the far right, and below 1280px it had
to start dropping its own parts to fit. So it is **two rows** now:
`header.bar`, which is the catalogue's bar rule for rule, and `div.toolbar`
beneath it, which is the workbench and is only this page's. `?view=app` and
`?view=full` hide both; what comes back when something goes wrong is the
TOOLBAR, because the status line is in it and in that view it is the only
channel there is.

**The bar exists four times, by hand** — `src/shell/index.html`,
`src/catalogue/index.html`, `tools/sample-frame.mjs` (the frame of every page `sample-pages.mjs` writes) and, over there,
`theme/TheBar.vue` with `SiteNav.vue`, `SiteMenu.vue` and `theme/style.css` —
and so does the menu behind its last button: the switch, the practical links (issues, release notes, install,
support, contribute, sponsor), the tools, then the repositories by kind in two
columns. So does the palette
(`src/shell/shell.css` is the original; `catalogue.css` says it is a copy and
why). A shared partial would be a build step in front of a page whose whole
point is that it is a file, and a shared stylesheet across two repositories
that deploy separately would be a request in front of the first paint. Change
them together.

**Less motion, if asked — and the one place the blanket form cannot go.** The
catalogue and the manual answer `prefers-reduced-motion` with
`*, *::before, *::after`, animations and transitions together, because a rule
that has to be remembered every time something new animates is a rule that
will be forgotten. `shell.css` had no answer at all, and it cannot have quite
that one: Monaco is in that document, and it draws its caret with an
`alternate` animation run twenty times. Held to one iteration of a hundredth
of a millisecond, an `alternate` animation ends where its keyframes end, which
for a caret is invisible — the reader who asked for less motion would have
been given no cursor. So the shell switches off the **transitions** (it has
five, and the editor's are no loss) and leaves the animations alone, the
editor having its own settings for them. An animation of this file's own
belongs in that block by name.

**The search box is not a fourth copy, and its index is not a copy at all.**
The box is `src/shell/search-box.mjs` — plain DOM, because two of the three
documents here have no framework and one of them is written 772 times by a
build script. The playground's bundle imports it; the catalogue and every
per-sample page load it as `dist/samples/search.mjs`, one module for all 773
documents, bundled from `src/catalogue/search-entry.mjs` and budgeted in
`tools/check-size.mjs`. `src/shell/search-engine.mjs` (the matching) IS a copy
— of `docs/.vitepress/theme/search-engine.js` over there, kept in step by hand
like the palette: the ranking rules (stop words, the phrase bonus, the field
matched with its spaces taken out, the plural, what happens when nothing
matches) are documented and tested THERE, in `test/search.test.mjs`, and a
change to the matching starts there and is copied here. The one difference
from that copy is that this one exports `normalise` (the case folding), which
`foldCase` in `src/shell/search-terms.mjs` - the samples dialog's and the
catalogue's filter match - builds on, so the two kinds of search fold case
alike. (The AI's catalogue search, `rankEntries` in `ai-common.mjs`, could
adopt the same terms later.) Version compares go the same way: the samples
dialog uses `cmpVersion` from `ui5-libs.mjs` rather than one of its own. What this box adds
of its own is the line above the rows when the answer is not to the query
as typed — a typo corrected, a word set aside — read off `hits.relaxedTo`.
It also carries the memory of the **last query**: a hit opens
another page, often another deployment, and the box that opened there was
empty, so a reader comparing three samples of one control typed the same word
three times. The query is written down as a hit is opened and the next box on
this origin starts with it, selected, so the first keystroke replaces it.

What it searches is one generated document, `/docs/search-index.json`: every
page of the documentation, and every entry of the three sample catalogues. The
documentation builds it (`scripts/generate-search.mjs` over there) and all four
bars fetch it from the shared origin, lazily, when the box is opened. Two
copies of that data would be two answers to one query, which is why this one
thing is fetched rather than copied.

**The catalogue keeps its own search field, and that is not a duplicate.** That
field is a FILTER: it narrows the 770 rows in front of you, works with the
three facets beside it, and writes a URL that can be shared. The box in the bar
answers a different question — "where is X in this project" — from any of the
four bars, and leaves the page to answer it.

**One origin means one localStorage**, which four things rely on:

| | |
|---|---|
| the theme | `abap2ui5-playground:theme`, read before the first paint by ONE script, `THEME_BOOT` in `src/shell/theme-boot.mjs`, which the build writes into every document here (the playground's pages, the catalogue, every sample page, the 404) - the one `localStorage` touch outside `storage.mjs` - and by a head script over there. The switch in any of the four bars turns all four |
| where you were | `src/shell/site-memory.mjs`, imported by the shell and the catalogue bundles and by the per-sample pages through `samples/page.mjs` (`src/catalogue/page-entry.mjs`, one module for all 772 of them beside `search.mjs` - it used to be an inline copy kept in step by hand). Every samples page writes its own path down — the catalogue's *with its filters*, because the filters are the page there — and the Samples item on the other bars is lifted to it: at boot, again when the page is shown or the tab looked at again, and on the click itself (`keepSiteLinksCurrent()`), because a link lifted once and left open carries the position from before. A stored value is **checked, not followed**: resolved against this origin and kept only if it is still inside the href the markup carries, so a poisoned or stale key costs a restored position and nothing else. All three items open in the same tab — the sites are one site, and a bar that opened one of them in a second window was the one asymmetry between the four bars |
| where **on** the page you were | The same file, keys `:scroll` (a small map of path → offset, the twelve most recent) and `:returning`. The item above came back to the page and to the TOP of it, which on a list of 770 rows is most of the way to not having remembered anything. Restored **on arrival by the bar and nowhere else**: a `data-back` link writes down how far down this page the reader is and one record saying where they are being sent, and the page that *is* that, arriving within half a minute and with no hash of its own, honours it. Restoring on every load would fight the browser's own back-and-forward restoration and would drop a reader who followed an ordinary link into the middle of a page. Checked the same way a stored path is — `scrollTo` takes whatever it is given |
| the last thing you searched for | `src/shell/search-engine.mjs`, key `:search`, described above. Checked: a string, short, and less than half an hour old |

**A refresh starts over.** All four of those, bar the theme, are memories of a
JOURNEY — state one page hands the next because a click here makes a new
document, which is why they survive a navigation at all. Reload is the one
press that has never meant *go somewhere*, and it is what a reader presses when
a page looks wrong: handing them back a bar still pointing at yesterday's
sample is the site remembering its way back into whatever they were leaving. So
`forgetOnReload( )` empties the five position keys on a `reload` navigation and
on no other, at the top of `keepSiteLinksCurrent( )` — before the first lift
reads any of them, and never in an embedded playground, which does not call it
and whose host page's storage is not ours to clear. The search box forgets its
own key the same way, in `setUpSearch( )`, because the key is
`search-engine.mjs`'s: the module that owns a memory is the one that forgets
it.

**What a refresh must NOT drop is everything else this origin stores**, and it
is the larger half: the reader's WORK — the files in the editor (`:files`),
their drafts, the sample they are on — and the preferences they set once — the
theme, the split, the panel height, the samples browser's filters, the
checkers, Auto. A refresh that emptied the editor would be a catastrophe rather
than a fresh start, and one that squared up the splitter would be a bug of the
kind this fixes. The list is written out key by key and nothing clears by
prefix. The playground's own `:last-playground` is in it and costs nothing:
`main.mjs` writes this page down again at boot, so the Playground item still
opens the playground the reader is looking at, code and all. `tests/site-memory.spec.js`
holds both halves; the documentation's half of the same change is
`theme/site-memory.js` and `scripts/site-js/site.js` in **abap2UI5/docs**,
where the caller passes two more keys of its own (the chapter menu, the search
box).

**The playground is remembered too**, under `:last-playground`, and it did not
use to be. The argument against was that its URL carries the code in the editor
rather than a place — samples and docs are places, the playground is a
workbench. What that missed is the case it creates: a reader who opens a SAMPLE
here has code that is **not a draft**, and a sample that was picked and read is
deliberately not stored, so pressing Documentation and then Playground threw it
away and started them on the default sample. Their own edits survived that
trip; the sample they were reading did not, and nothing on the screen said why.
The URL is what carries it, so the URL is what is written down — on `pagehide`
and whenever the tab is hidden, because neither is promised on its own. Two
views never write: an **embedded** playground (furniture in somebody else's
page) and an **app-only** one (`?view=app`, `?view=full` — a running app, not a
place to come back to).

**And the bar goes back to a page that is still behind you** rather than
building it again — the Playground item first, then all four, because the
documentation's front door carries a runnable example that is a playground in
a frame. A link makes a new document, and a new playground boots the whole
runtime and runs the app from the top — two to three seconds, and the app's
own state gone with the document that held it. The one mechanism that hands a
running page back alive is the back/forward cache, and it applies to a page
the reader has been on. So when the page an item opens is still in the tab's
history, the click traverses to it there (`returnTo( )` in `site-memory.mjs`, which
the sample pages import through `samples/page.mjs`, and the documentation's `site.js`): through
the Navigation API where it exists — the nearest entry, either direction, that
is the same origin, path and query — and without it, the one case a page can
know, that it was opened from that page and nothing has been pushed onto the
history since. The item for the page the reader is on is left to the browser.
A traversal the browser cannot make follows the link after a moment, and a
page handed back alive spends the scroll record the link wrote on the way
out. Whether the page comes back **alive** is the browser's call: where it was
rebuilt instead, the shell prints `notRestoredReasons` to the console on
arrival (`main.mjs`), which is the one place the browser says why.

`tests/site-memory.spec.js` holds the round trip and the values that must be
refused, and the step back — what a browser test can see of it is that the
history did not grow, because this Chromium runs with the back/forward cache
off. The documentation half cannot be reached from here — it is another
host in a test run — and is a unit test over there
(`test/site-memory.test.mjs`) with a stubbed `location`.
