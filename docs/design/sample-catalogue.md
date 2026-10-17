# The sample catalogue and a page per sample

> Design notes, moved out of `AGENTS.md`. Read this before touching `src/catalogue/`, `tools/build-catalogue.mjs`, `tools/sample-*.mjs`, `tools/not-found-page.mjs` or `apps.json`.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## The sample catalogue — `src/catalogue/`, at `/samples/`

**<https://abap2ui5.github.io/playground/samples/>** — every sample of
`abap2UI5/samples`, `abap2UI5/samples-controls` and `abap2UI5/samples-stack`,
searchable. It is a **second document** on this site, with its own small bundle
(~7 KB): a reader who came to look something up must not download Monaco and
abaplint to do it, and a reader in the editor must not carry a page they may
never open. The two share `src/shell/ui5-libs.mjs` and the theme key, and that
sharing is why the page is bundled at all rather than copied.

It replaced three GitHub Pages sites, one per sample repository, retired
2026-09-03. Three pages that each had to explain that the other two existed
were the reason for a shared navigation block, its three copies and a check
policing the copies; one page needs none of it.

**What it has that the dialog cannot.** Its filters live in the URL
(`?q=table&lib=sap.m&rel=1.84`), so a search can be linked, sent or bookmarked
— and the page is a document with real text in it, so it can be found at all. A
list that arrives from another host after a click is invisible to a search
engine and has nothing to link to, which is why the index is built rather than
fetched (below). Its facets are the two questions the sidecars cannot answer:
*which samples BUILD `sap.m.Table`* — not the one filed under it — and *what
renders on the release my system runs*.

**`tools/build-catalogue.mjs`** writes `dist/samples/apps.json` before
`build-site` runs. It fetches **six committed files**, two per repository, and
joins each pair on `class`:

| | |
|---|---|
| `catalogue.json` | what that repository's tree holds |
| `catalogue-derived.json` | what the abap2UI5 linter knows: every control the class BUILDS, and the minimum UI5 release that implies |

Those files are the contract with the three repositories. The **library** a
control ships in is in neither of them and is decided here
(`src/shell/ui5-libs.mjs`): it is one UI5 taxonomy question, three repositories
each answering it would be three prefix tables that drift, and this is where
the question is actually asked — `UI5_LIBRARIES` beside it is the closed set
this site carries, so "does this render here" is that set against this mapping.
`runs` and `needs` are computed once, at build time, from that plus
`UI5_VERSION`; the page and the dialog only display them.

**An entry carries its path, not its URLs.** `file` (the class's path in its
repository) and, off `main`, `branch`; the repository is in `sources`. The
raw file and the GitHub page are one template each over those three facts,
written in `src/shell/catalogue-urls.mjs` and built where they are wanted -
the dialog, the catalogue page, the AI tools' `catalogueEntries()`, and
`tools/sample-pages.mjs` at build time, which still works on rows carrying
both. The index used to carry both URLs on all 804 entries: 135 KB of an
816 KB file (6 KB of its 110 KB compressed), the same two prefixes over and
over. `keywords` stay: the dialog, the catalogue page and the AI search all
match on them at the first keystroke, and the plugin commands and READMEs
in abap2UI5/abap2UI5 send agents to `apps.json` for exactly "title,
summary and keywords" - a second file would be a second fetch on every
catalogue visit and a contract broken for nothing. `samples/llms.txt`
documents the fields, `file` and `branch` among them. The helper still
takes an entry that carries `raw` and `github` - a cached index from before
the change - and checks a path by the build's own rule.

**It degrades per repository and per half.** No `catalogue.json` and that
repository contributes nothing and says so in `sources`; no
`catalogue-derived.json` and its samples are listed with the tree's facts and
without the derived ones. Neither is a failed build, and both are states that
really occur — the second is exactly the window between merging the playground
change and merging the three repository changes. A build with no catalogue at
all still publishes: the page says the catalogue could not be loaded, which is
the honest thing for it to say, and nothing else on this site depends on it.

**The deploy runs nightly** (`.github/workflows/pages.yml`), which a static
site would not otherwise need: the six files change when a sample is merged in
another repository, and that is no reason for anything to be pushed here.

**And it tells the documentation.** `scripts/build-site.mjs` over in
abap2UI5/docs borrows the bar, the bar's script and two stylesheets from this
deployment at build time, so a bar change here reached the manual only with
the manual's next push. The `notify-docs` job at the end of `pages.yml` sends
abap2UI5/docs a `repository_dispatch` (`playground-published`) after a
successful deploy; it needs a fine-grained token in this repository's secrets
as `DOCS_DISPATCH_TOKEN` (contents: write on abap2UI5/docs), and without one
it says so and does nothing — the manual's own nightly deploy, an hour after
this one, is the net under it.

**Capability markers.** abap2UI5/samples lets an author end a class's title
in `(A)`, `(C)` or `(A,C)` - a frontend action, an abap2UI5 custom control, or
both. `src/shell/sample-marks.mjs` reads them out loud, one legend for the
samples dialog, the catalogue's cards and `tools/sample-pages.mjs`: a
"frontend action" / "custom control" badge (searchable), a "Marked" fact on
the sample's page, and a title without the brackets. `samples/llms.txt`
explains the markers; `apps.json` is unchanged and still carries the title as
the repository wrote it. `tests/node/sample-marks.test.mjs` holds the reading.

**A card is one link, and it goes to the sample's own page.** Cards used to end
in three actions — Run it, Source, Docs — and they were the wrong three: they
left the site before the reader had seen what the sample *was*, and they made
the row look like the destination, so the page underneath it read as something
that did not exist. A card now carries the title (the link, stretched over the
whole card by `.card h3 a::after`, so a row is aimed at as a row), the badges,
the class, and one line saying what opening it gets — *Open the sample ›* and
whether it runs in this browser. Run, GitHub and the documentation are on the
page it opens, where a reader who has decided is standing — running it is a
demo box above the class that runs it *in* that page, and GitHub and the
documentation are facts in its list of facts. The one row that keeps a link of
its own is one with no page written for it: it links to the class on GitHub,
because that is all there is.

**The round trip is the point.** *Switch to Playground with this code* on a
sample's demo box goes to `../../?src=<raw>&from=catalogue&back=q=<class>` — in
this tab, which the label says — and `showSourceLink()` in `src/shell/main.mjs`
turns that into *Back to the catalogue* in the bar, narrowed to the sample they
came from, instead of pointing at the file on GitHub. Find it here, read it there, run it, come back and keep
looking. A static page cannot know the search a reader had, which is the one
thing this lost when Run moved off the card; `q=<class>` is the search with
exactly one hit. A `?src=` link from anywhere else still offers the GitHub
page, which is what that reader wants.

**The bar names the part of the site you are in.** On `/samples/` and on every
per-sample page the brand is the mark and *abap2UI5*, closed by a hairline
(`.brand::after`, 16px from the name like the two lines at the other end) —
nothing more, because the nav's Samples carries `aria-current`, which is what
makes it the bold item (`catalogue.css`) and what a screen reader announces,
and a brand that said *samples* too said it twice. The brand links to the catalogue rather than to
the playground, which is one nav item away; a bar that called these pages
"playground" was naming the neighbour rather than the room.

**The samples pages' right-hand end reads, in this order:** a hairline, the
nav — *Documentation*, *Samples*, *Playground* —, a hairline, LinkedIn and
GitHub, then one more button, drawn as a third mark, that opens **the menu**:
the light-or-dark switch, then the project's tools (linter, VS Code extension,
MCP server, app template, add-ons) and its repositories on GitHub — the list
the documentation's own Links menu carries. The menu is a `<details>`, so it
opens and closes with no script; an inline script closes it on a click
outside it and on Escape (`THEME_MENU`, below). Each hairline stands 16px from the words and
the marks beside it, because a line nearer to one neighbour reads as belonging
to it; `catalogue.css` says how that adds up out of the bar's gap, a link's
padding, the nav's gap and the mark's box. The catalogue and every per-sample
page carry that bar the same to the character, bar the hrefs — a reader who
opens a sample must not see the head change under them — so the per-sample
pages and the catalogue wire their menu and their switch with the SAME
inline script: `THEME_MENU` in `src/shell/theme-boot.mjs`, written into the
catalogue's `index.html` by `tools/site-documents.mjs` (the `__THEME_MENU__`
marker) and into every sample page as `MENU_SCRIPT` by
`tools/sample-frame.mjs`, so the two kinds of page cannot come to behave
differently. `catalogue.mjs` wires neither any more; nothing is kept in step
by hand. The
playground's own bar (`src/shell/index.html`, `src/shell/shell.css`) carries
the same group on the row above its toolbar — *Playground* as the current item, a span
rather than a link, because it is the page you are on and a stray click on it
would throw away a page that costs seconds to load, and the brand a span for
the same reason — with `extra.mjs` closing its menu; the documentation site's
bar (`theme/TheBar.vue` over there) is the fourth copy. Three
documents here carry the two marks and the menu by hand
(`src/shell/index.html`, `src/catalogue/index.html`,
`tools/sample-frame.mjs`, which every page `tools/sample-pages.mjs` writes shares): inline SVG, because a mark that is an empty square
until a stylesheet arrives is worse than one that never needed it, and a
shared partial would be a build step in front of a page whose whole point is
that it is a file. `tests/shell.spec.js` and `tests/catalogue.spec.js` hold
each bar to the other's ends.

### A page per sample — `tools/sample-pages.mjs`, at `/samples/<class>/`

The catalogue is one URL with 770 samples drawn into it by JavaScript. That is
right for somebody searching and useless for somebody searching **the web**:
there is no address for "the abap2UI5 port of `sap.m.Wizard`", so there is
nothing a search engine can return. The three repository pages it replaced were
the same shape — a masthead and an empty `<section id="results">` — so nothing
was lost in the move; nothing was ever there.

So every entry in the index also gets a **static page**: title, the demo kit's
own sentence, the class, the facts as a `<dl>` — which is also where the links
out live: the class on GitHub, SAP's own sample *running in the demo kit* for a
port of one (`sdk.openui5.org/entity/<entity>/sample/<sample>`, which needs the
entity too: seventy ports are filed under an entity in another namespace), the
documentation —, every control the class BUILDS (the linter's answer, each one
a link into the catalogue's control facet), its libraries, what it needs where
it cannot run, **the sample running**, **the class itself**, the neighbours
around it in its group, and back to the search. Beside all of it, from 1100px
up, an **"On this page"** column — the documentation's outline, in the place
the documentation puts it, down to the hairline on its left and the height its
first row starts at: a manual page's title and outline both begin 94px under
the bar, and these pages begin their crumb line and their outline there too, so
two pages a reader steps between do not start in three different places. It is built by `outline( )` in one pass over the finished markup: the
`<h2>`s get their ids and the aside gets its rows from the same walk, so a row
cannot point at a heading that does not exist, and a page with fewer than two
sections gets none (an outline of one is the same word twice on one screen).
The column also MARKS the section being read, the way the manual's does - the
entry at full strength instead of dimmed and a 2px bar in the accent on the
hairline beside it - by the rule VitePress uses, case for case: NOTHING at the
top of the page (a reader looking at the title is not in a section yet), the
last row at the bottom, and otherwise the last heading whose top has passed
under the bar, or none if no heading has. `setUpOutline()` in `src/catalogue/outline.mjs` sets the class; the bar is a
pseudo-element on the row rather than one element sliding between rows, which
is the only place this deliberately differs from over there.
Real text in the HTML, and
nothing a crawler has to run to see any of it: the scripts on a page are the
two-line theme read the other two documents also carry and the bar's menu with
its switch, inline (`THEME_SCRIPT`, `MENU_SCRIPT` in `tools/sample-frame.mjs`,
both from `src/shell/theme-boot.mjs`),
two small modules every page shares (`samples/page.mjs` - the site memory, the
outline and the line links - and `samples/search.mjs`), and the demo loader
below, and none of them writes a word of it. `sample.css` (`src/catalogue/sample.css`,
copied as it is) is written beside them and
loaded next to `catalogue.css`, which is the frame: these are the catalogue's
pages, and a second palette would drift from it on the first change to either.

**And the sample runs on it.** Above the class is a demo box: press it and
`src/embed/abap2ui5-embed.js` — the same loader any documentation page embeds,
so these pages are the first reader of the kit this site ships — mounts the
playground in an iframe, in the page, on this sample's `raw` URL. Nothing loads
until it is pressed, which is that loader's own rule and the only one that
scales: a playground is a whole ABAP runtime plus an abaplint parse of nine
hundred sources, and 770 pages that booted one on sight would be 770 pages
nobody waits for. A **"▶ Run it here"** link under the title
(`#run-it-here`) takes the reader to the box, and with JavaScript also presses
its start button (`setUpRunJump( )` in `src/catalogue/run-jump.mjs`, part of
`samples/page.mjs`) - a reader who said "run it" has said it; with the script
blocked it is still a plain anchor. A sample that cannot run here has neither
the link nor the box. Only samples that `run` here get a box — a start button that
could only ever fail is not an offer — and the box carries *Switch to
Playground with this code* for a reader who wants the whole window. It is also why the page
no longer opens with a row of buttons: Run runs it here now, and the two links
beside it were links in front of the answer.

What it mounts is `data-view="app"` at `data-height="620"`, in a box the width
of the column: **the app and nothing else** — no editor, no toolbar, no status
line.
A page that prints the whole class two screens down does not need a second copy
of it inside a frame, and a strip of the playground's own furniture across the
top of it is furniture rather than answer. The editor is on the box, in *Switch
to Playground with this code*, which is where a reader who wants to change a
line goes anyway. The height is the decision: the column is 1160px wide, and
420px in it was 2.8:1 — a letterbox, in which a UI5 page with a header and
a list had room for four rows before it scrolled inside a box the reader cannot
resize. 620 makes it a window rather than a strip, which is the shape of the
thing inside it. **The width is not a decision of its own any more.** It was
capped at 820px for a 5:4 frame, and that put the demo card 35px short of the
class card under it — the same sample, running and written, in two cards that
did not line up on the right. Both take the column now; 620 in it is still a
window. It is what the demo is read at rather than a
floor it grows from: an abap2UI5 app is a `Shell` around
a `Page` laid out at 100% of its box, so it never overflows one and the
loader's grow-on-overflow never fires (`src/embed/abap2ui5-embed.js` says why
at length).

**The ABAP is on the page, not behind a link.** The class *is* the sample, and
a page that described one and did not show it sent the reader to GitHub for the
answer and a search engine nothing but a description. `tools/sample-sources.mjs`
fetches it — **one tarball per ref** from codeload, so 770 classes cost about a
dozen requests instead of 770, cached on disk for a day and re-fetched by every
CI runner — and `tools/abap-highlight.mjs` colours it *here*, because these
pages carry no highlighter of their own: a scanner over comments, literals,
numbers and keywords, emitting the same token classes the bottom panel's own
highlighter does (`src/shell/highlight.mjs`), with every character escaped on
the way in.
Classes are printed whole up to **900 lines or 60 KB**, after which the page
says what it cut and links to the rest — the tail of samples-controls is table
data around a chain, and one of them is two megabytes. A class that could not
be fetched simply has no block, and its page is what it was before: a ref that
does not arrive costs its samples their code and never the build.

**And every line of it has an address.** `#L42` highlights a line and
`#L42-L58` a passage, which is the one thing a reader could do with the copy on
GitHub and not with the copy here — "look at line 40 to 55" is most of what one
person tells another about a sample. Each line is an element of its own
carrying that id, and the number beside it is a **CSS counter**, drawn by
`::before` from `sample.css`: the numbers are not in the text, so selecting the
block and copying it still gives ABAP that pastes, which is the whole reason
the class is printed here rather than linked. The gutter is `sticky` inside the
scroller, over an opaque background — an abap2UI5 view is a chain written wide,
and a number that has scrolled out of the box is a number nobody can read a
link off; the line carries the background and the number inherits it, so a
marked line is not a white column with a coloured line beside it.

**One line needs no script at all**: `:target` is the browser's own answer to
`#L42`, and it is what a page with its JavaScript blocked still does. The
script (`setUpLines()` in `src/catalogue/lines.mjs`, which does nothing on a
page that prints no class) exists for what `:target` cannot answer — the RANGE, which is a fragment
no element has an id for —, for the shift-click that composes one, and for the
*Copy link* button beside the class. It takes the single-line case over as it
runs, by marking the block `live` so the stylesheet's rule stops matching: one
line highlighted by one mechanism, never two by two. The selection is written
to the address bar with `replaceState` rather than pushed — the address bar is
the share link, and a reader who presses Back after picking three lines wants
the page they came from, not the two selections before this one. A link into
what the 900-line cut left out says so, rather than highlighting nothing.

What it costs is markup, and it is measured: an id and a link per line takes a
typical page from about 9 KB gzipped to 12 (the median of the 772), the set
from 7.4 MB to 10.4 — and, the figure that decides something, the Pages
artifact from 39 MB of sample pages to 55. **That is what moved the whole-site
budget in `tools/check-size.mjs` from 200 MB to 220**, and the line is
deliberate rather than a number pushed out of the way: the markup is repeated
a hundred and ninety thousand times, so what is on it was cut to the two attributes that
carry meaning (where the link points, and what a screen reader calls it — the
stylesheet reaches the element as `.ln > a` rather than by a class, which was
two megabytes on its own). The rest is the price of an address per line, and
it is paid in static documents nobody waits for rather than in the bundle
somebody came to write ABAP in.

Four rules hold the set together:

- **`page` is stamped on the index entry by the writer**, which is why it runs
  before `apps.json` is written. Which entries get a page is its rule — a class
  name that is a class name, an `https` source URL — and the catalogue's cards
  link to what was actually written rather than repeating that rule and
  drifting from it.
- **A title that names THIS page.** Ninety-eight of them used to name several:
  eight pages said "Binding · abap2UI5 sample", seven said "Table", seven
  "Message". For a series of samples the catalogue's `title` is the *series* —
  the sentence saying which one this is, is its `note` — so a result list, a
  row of browser tabs and a shared link all said the same thing over and over.
  The note is appended **only where the title collides**, which the writer can
  see because it holds the whole set; a title carrying both when it does not
  have to is half as much title. The `<h1>` is untouched: on the page itself
  the class name and the lead sentence are directly under it.
- **The printed class is reachable.** It scrolls sideways — 404px of it on the
  widest sample — and nothing inside it is in the tab order, because the line
  numbers are links and were deliberately taken out of it. So the block itself
  is the stop: `tabindex="0"`, `role="region"` and a label naming the class,
  which is what the manual does to its own listings and its tables.
- **Nothing pushes the page sideways.** A UI5 name is one word and some of them
  are 28 characters long — a title carrying the control it is about, a chip
  that *is* a control name, a documentation link printed as its address in a
  grid column that would not shrink below its longest unbreakable child. Each
  of those took the whole page with it on a phone: 98px at 320, still 5 at 414,
  on pages nobody had opened that narrow. `minmax(0, 1fr)`, `overflow-wrap`
  and a `max-width` on the chips; the printed class is the one thing still
  allowed to scroll, and it does that in its own box.
- **External data, escaped.** Everything on these pages comes from three
  repositories' committed files: every value is escaped into the markup, every
  link is dropped unless it is `https`, and a class name that is not a plain
  ABAP name gets no directory. A path is not a thing to build out of somebody
  else's JSON — and the printed ABAP is the same rule at scale: the highlighter
  escapes every character before any of it goes near a template literal, so a
  repository can never decide what is a tag here.
- **Linked, not only listed.** A page in a sitemap and in no link is a page a
  crawler may ignore. Every card's title links to its page, each page links to
  its neighbours, and the catalogue's *footer* — its static half, the part that
  needs no JavaScript — links to `samples/all/`, which names all 770.
- **No `robots.txt`.** This site is a project page under
  `abap2ui5.github.io/playground/`, and a crawler only reads `/robots.txt` at
  the domain root, which belongs to another repository. `sitemap.xml` is
  discovered by being submitted, or not at all; the links above are what
  actually does the work.
- **No `lastmod` either**, and that is the same kind of decision. It used to
  carry the day of the build on all 774 lines, which is not when those pages
  changed but when they were rebuilt — every deploy, every page. A crawler told
  that everything changed today, and again tomorrow, is told nothing, and stops
  reading the field. Nor can this build honestly say more: the manual takes each
  page's date from the commit that last touched its markdown because the
  markdown is in that repository, while these pages come from catalogues fetched
  over the network from three others, and neither the fetch nor this checkout
  carries that history. `lastmod` is optional in the protocol for this case.
- **What the page is, said in `ld+json`.** A sample page carries
  `SoftwareSourceCode` and a `BreadcrumbList` that mirrors the trail drawn above
  its title — the one piece of this markup a reader sees, as the trail over a
  search result instead of a bare URL. The full list carries `CollectionPage`
  with the count (and its own trail), the catalogue carries `CollectionPage`
  without one — that file is copied verbatim and a count in it would be wrong by
  the next upstream commit — and the playground itself carries `WebApplication`:
  free, needs no account and no system, which is the question somebody arriving
  from a search actually has.

**And the page for an address that is not a page.** `dist/404.html`, which is
what GitHub Pages serves for anything it cannot find under this deployment;
before it, that was GitHub's own white page with no bar, no search and no way
on. It carries the frame, the four sections and the box, and it *guesses*: the
771 class names and titles are in the page, about 40 KB, and the address is
scored against them — by the words it still carries once the ones nearly every
sample shares are dropped (`.../z2ui5_cl_smpc_app_wizard/` finds the Wizard
samples, `.../all.html` finds the full list), and, when a class-shaped address
leaves no word behind, by how near the NAME is (`.../z2ui5_cl_smp_app_49/`
finds the classes one character away). Nothing is fetched to answer, and
nothing is shown when nothing is close.

`SITE` (overridable with `PG_SITE_URL`) is the one absolute URL on this site,
and only these pages need it — a canonical link and a sitemap are absolute by
definition, everything else stays relative so the site still works under any
path. The 404 is the single exception, and for the same reason: it is served at
`/playground/samples/<typo>/` and at `/playground/<typo>` alike, so it links
through `BASE` — `SITE`'s own path — because a relative href there resolves
against whichever address missed. The pages are **not** in the service worker's allow list: they are static
documents nobody revisits offline, and 770 of them in a cache is not what
somebody who came to write ABAP asked for. `tests/sample-pages.spec.js` runs
against the real index, because a fixture would test a page that was never
written.

The service worker keeps the page and its index **on use, not in the precache,
and never ahead of the network** (`src/shell/sw.js`, `LIVE`): `apps.json`
alone is most of a megabyte, and somebody who came to write ABAP must not
download 770 samples to do it. It is written by the deploy that wrote the
bundle beside it — but the deploy that changes it is usually not the deploy
that changes the bundle (the nightly run, for a sample merged elsewhere), and
that deploy writes the same worker with the same cache; served cache-first,
the copy was yesterday's catalogue for every returning visitor. So the three
catalogue files ask the network and fall back to the cache, like the two
documents.

**The catalogue and every sample page are published under a
Content-Security-Policy** (`withPolicy( )` in `tools/html.mjs`, applied at
the write in `build-site.mjs` and `sample-pages.mjs`): this origin, the
inline scripts by hash of the very text written, images from anywhere over
https, nothing else. `tests/sample-pages.spec.js` reads every page kind back
for a hash per inline script and for the inline handler no hash can allow.
The playground's own document has none yet — module workers, WebAssembly,
Monaco's blob workers and UI5 in a frame are a separate piece of work.

**The catalogue draws first and writes second.** `render( )` runs on every
keystroke; the URL and the position memory follow 200ms later, once, in a
try/catch — Safari refuses `replaceState( )` after a hundred calls in thirty
seconds, and the two synchronous writes in front of every render were where a
fast typist's handler died. **A card is built once** (`cardFor( )`, a
`WeakMap` from row to node) and moved into place on every draw: building all
771 again on every keystroke, a dozen elements apiece and thrown away at the
next key, was the cost of a keystroke, not the filtering. A card that does
not match is left out rather than hidden, so the list and the count agree
and nothing counts a hidden card. The samples dialog's rows follow the same
rule (`rowFor( )` in `src/shell/examples.mjs`). The cards carry
`content-visibility: auto` so a
keystroke lays out the screenful that is visible rather than all 771; the
four filter lists are drawn at the width their longest option gives them and
the results box keeps its height until it is filled, which is what took the
page's layout shift from 0.19 to nothing (`tests/catalogue.spec.js` holds it
under 0.05).
