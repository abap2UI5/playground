# The public surfaces

> Design notes, moved out of `AGENTS.md`. Read this before touching share links, `?src=`, `?gist=`, `?embed=`/`?view=`, the samples dialog or `src/embed/` - anything abap2UI5/docs consumes.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## The public surfaces — the docs site consumes these

These are contracts, not conveniences: **abap2UI5/docs** puts Run buttons and
embedded demos under its examples using exactly these. A docs change that
depends on *new* playground behaviour must ship **after** the playground
deploy — readers get the published playground, never your checkout.

- **Share links**: every open file in the URL fragment, deflate-raw and
  base64url with a version prefix (`src/shell/share.mjs`). The fragment never
  leaves the browser. A fragment the playground cannot read is replaced by
  the sample and reported - the status line says the link could not be
  followed and the Log carries the decoder's own sentence - which is why an
  external page must build URLs with `window.abap2ui5Embed.url()`, never by
  hand.
- **`?src=<url>`** (`src/shell/deep-link.mjs`): opens ABAP from same-origin or
  GitHub's raw hosts (`raw.githubusercontent.com`,
  `gist.githubusercontent.com`) — an allow list on purpose, not an open read
  proxy. A `github.com/<o>/<r>/blob/<ref>/<path>` page URL, which is what a
  reader copies out of the address bar, is translated to the raw file behind
  it before the list looks at it (`rawFor()`). Several `src` parameters open
  several files; **the first file is the
  app**. Classes the app needs are looked for beside it: siblings only, at most
  6 files, 2 levels deep, silent when a name is not found.
- **`?gist=<id>`** (`src/shell/gist.mjs`): opens the ABAP files of a GitHub
  gist, read from `api.github.com/gists/<id>` without a token - an id, not a
  URL, so it widens nothing the allow list above keeps narrow. GitHub lists a
  gist's files alphabetically, so the class implementing `z2ui5_if_app` is
  put first (else the first class); a file GitHub truncated is refused rather
  than opened half. A `src` beside it wins. Never on the Pilot's page. The
  Share dialog's **Gist** section writes one (`POST /gists`, secret) with the
  reader's token - held in `share-dialog.mjs`'s memory for the visit, never in
  the field after a press and never stored, for the reason the AI key is not
  - and answers the `?gist=` link. Once code a link brought has run in this
  visit (`markLinkedCodeRan( )` in `src/shell/linked-code.mjs`, called by
  `run( )`), the section takes no token until the reader has ticked that they
  know (`#share-gist-caution`, `#share-gist-trust`, once per visit): that code
  runs in this origin and could read the field. `tests/gist.spec.js` holds the id parsing,
  the payload and the order; `tests/shell.spec.js` the page.
- **`?embed=1`**: drops the chrome, and never reads or writes the stored
  draft — an embedding must not overwrite a reader's work.
- **`?readonly=1`** (embedded only): the editor takes no typing
  (`lockEditor( )` in `src/editor/monaco-editor.mjs` - a floor the View tab's
  edit mode cannot lift), and Format, Undo, Redo, Fix them and the View tab's
  Edit are hidden (`body.is-read-only`); Run stays, because reading and
  running is the point.
- **`?lines=12-18,25`** (embedded only; `L42-L58` and `#L42-L58` read the
  same, the shape a sample page's line links have): marks those lines in the
  app's file and scrolls to the first (`parseLines( )` in
  `src/shell/embed.mjs`, `markLines( )` in the editor). `setUpEmbeddedEditor(
  params, { run })` in `embed.mjs` applies both, called by `main.mjs` right
  after `createEditor( )`.
- **`?view=app`**: hides the editor too — the app on its own, for a paragraph
  about what an app does rather than how it is written. **`?view=full`** is the
  same view under the name the Full screen button opens it by. Neither
  **fetches Monaco**: `createEditor()` in `src/editor/editor.mjs` keeps the
  files in `file-store.mjs` on these pages — the registry worker still checks
  and compiles them, an abaplint error still stops Run — and imports
  `monaco-editor.mjs`, the 0.82 MB chunk, on no other - nor its stylesheet,
  which the inline script links only where the chunk is preloaded. Every page used to
  download, evaluate and instantiate the editor into the hidden pane;
  `tests/embed.spec.js` holds an app-only page to never asking for the chunk
  or the stylesheet and the playground to asking for both. Neither carries
  the bar: everything it offers is a click away in the "open this in the
  playground" link an embedding page prints beside the frame, and what it did
  instead was put a strip of this site's furniture across somebody else's
  paragraph. It returns while the status line reports an error, because it is
  the only channel that mode has left.
- **The Samples button** (`src/shell/examples.mjs` — the ids and the module
  keep the older name). A **big modal**: near enough the whole viewport, the
  page behind it dimmed and blurred, the filters in a side of their own and the
  rows in as many columns as the width allows. It is a list of 770-odd samples
  and it used to be a 44rem column of one-line rows, which is a keyhole onto
  one. It lists the reader's own **named drafts** first, as one folded line
  at the top - "Your drafts" and their count, open or closed as the reader
  left it, and opened by a search that matches a draft
  (`src/shell/drafts.mjs`, `tests/drafts.spec.js` — a name and Save keep
  what is open under it in localStorage, fifty at most, opened and deleted
  where they are listed; the one unnamed draft `remember()` keeps is
  unchanged), then everything the catalogue holds. A sample the page carries
  is listed ONCE, as its catalogue row, and clicking it opens the carried copy;
  "In the page" lists only a carried sample the index does not have. The count
  ("N of M samples") leaves the drafts out, so it is the catalogue's own
  number (804). In catalogue order:
  the learning path in its own reading order, the ports grouped by library,
  the stack samples by technology. It reads **one file, and it is this site's
  own** — `samples/apps.json`, written at build time by
  `tools/build-catalogue.mjs` (see [sample-catalogue.md](sample-catalogue.md)). It used to fetch the three
  repositories' catalogues itself from `raw.githubusercontent.com` and shape
  them here; the catalogue page needs the same list in the same shape, and two
  implementations of one list is exactly the drift those repositories avoid by
  generating their views from one scan. Every row links to its **ABAP** on
  GitHub, and a carried sample to the same file in abap2UI5/samples; it used to link to
  `src/editor/samples.mjs`, so a reader asking where the code lives landed in
  the JavaScript that quoted it. Down the side are the filters, kept
  between visits: the three repositories as one tinted group (Learn, Controls,
  Stack — on), "Only samples that run in this browser" (off; on, it drops
  what needs a system or a library this build has not got), "Leave out samples
  that need SAPUI5" (off; on, it drops what needs SAPUI5) and "Include samples
  that need a UI5 newer than 1.71" (on; off, it drops what needs a UI5 above
  the floor) — and, at the foot of it, the link to the catalogue page, which is
  where a search that is worth keeping goes. Under the boxes are the catalogue
  page's own three **facets** — *uses control*, *library*, *runs on UI5* —
  filled from the index and kept the same way. They are the two questions the
  sample repositories' catalogues cannot answer and the reason the index
  carries the linter's derived half at all, so the dialog asks them rather than
  sending the reader to the page for them; the built-ins and the drafts drop
  out under a facet, because a row the index knows nothing about is not a match
  for one, where under a box they stay — every box is about the repositories.
  The **search** takes several words, in any order, and matches a row's
  controls, libraries and group as well as its title and summary. A row is two
  lines: what it is called, with the group, the release where it is above the
  floor and what it needs where it cannot run (the long form as the badge's
  tooltip, and the title's `(A)`/`(C)` capability markers shown as
  "frontend action" / "custom control" badges, searchable, from
  `src/shell/sample-marks.mjs`), then what it does and the class it is — beside it the link to its
  ABAP and, where the repository has one, to its documentation page.
  A chosen entry becomes the raw URL of its class and goes through the `?src=`
  loading path above — there is one loader, and this is a menu in front of it.
  Nothing is fetched before the button is clicked; no index means the carried samples
  and the drafts alone, silently. Rows that cannot run here are listed and say
  why, their buttons disabled — a sample somebody cannot find is worse than one
  they cannot run — and *which* rows those are is decided once, at build time,
  not judged here. Everything else is run and judged by the two checkers and
  Run, exactly like typed code; a catalogued sample the transpiler cannot
  compile fails visibly there, and that is the designed behaviour, not a bug.
- **What a link opens on, and what it adds.** A link - a share fragment,
  `?src=`, `?gist=`, `?from=catalogue`, and every embed and `?view=` page -
  never gets the first-steps strip ([panel.md](panel.md)): somebody sent it
  with something particular to show. Embeds and app-only pages get neither
  the lesson bar, nor **Compare** and **Reset to original**, nor the UI5
  select. On the playground the files a link opened ARE the original those two
  buttons compare with (`original.mjs`, `openedFiles( )` in `file-sets.mjs`) -
  as are a sample and a named draft; a restored last session and the AI's
  writes have none, and the buttons say so in their tooltip rather than
  disappearing. `tests/original.spec.js` holds them.
- **Open in Layout Editor** (`src/shell/layout-editor.mjs`, a section of the
  Share dialog, `tests/layout-editor.spec.js`) hands the app class - the first
  file only; the layout editor edits one class - to
  [abap2UI5/layout-editor](https://abap2ui5.github.io/layout-editor/), the way
  back from its long-standing "Open in Playground". Two hand-overs: an app
  class unchanged since it was opened from GitHub goes as `?src=<raw URL>`
  (`unchangedRawUrl( )` in `original.mjs`, handed to the dialog's chunk from
  `main.mjs`; only `raw.githubusercontent.com` and
  `gist.githubusercontent.com`, the two hosts the layout editor's `?src=`
  reads); anything else is copied to the clipboard AND carried as
  `#playground=<share fragment>` - this site's own share format ("2" +
  base64url(deflate-raw(JSON `[{ name, source }]`))). The layout editor
  reads that fragment as of abap2UI5/layout-editor's branch
  `claude/zealous-feynman-nf350a` (`openClassFromPlayground( )` in its
  `src/ui/files.js`, on load and on `hashchange`; `filesFromPlaygroundFragment( )`
  in `src/handoff.js`: the hash cleared, decoded, the first file imported as
  Open ABAP class does); a layout editor deployed without it
  ignores the fragment, and the clipboard is what works there. The format is
  therefore a contract with that repository too.
- **`embed/abap2ui5-embed.js`**: turns an element into a click-to-load demo —
  `data-src` (one URL or several, first is the app), `data-code` (inline ABAP;
  the file is named after the class in it), `data-view`, `data-height`,
  `data-label`, `data-auto`, and `data-readonly`, `data-lines` (the two
  query parameters above) and `data-reset`, which shows a "Reset example"
  button under a demo once it has been edited.
  `window.abap2ui5Embed.setUp()` for pages that swap content without
  reloading; `window.abap2ui5Embed.url()` builds a playground URL and takes
  `readonly` and `lines` too. The frame posts `ready`, `status`, `height` and
  `edited` (`{ edited: true|false }`, sent only when it changes - the first
  line of `remember()` in `main.mjs` calls `announceEdited( )`) to its parent,
  and the loader turns `edited` into a bubbling `abap2ui5-edited`
  `CustomEvent` on the element (`detail.edited`). One message goes IN:
  `{ source: "abap2ui5-embed", type: "reset" }`, accepted only from
  `window.parent` and sent by `data-reset`'s button, which writes the page's
  code back into the editor as an undoable edit and runs it. The showcase,
  `src/embed/index.html`, is "Eight shapes" a page can take;
  `tests/embed.spec.js` holds the three additions. Click-to-load is deliberate: every demo boots its own runtime and
  parses the whole corpus.

**And one measurement that runs the other way.** abap2UI5/docs decides which of
its examples carry a Run button and gates the bookkeeping around it, but says
plainly in its own AGENTS.md that whether a buttoned example *starts* is the one
question its CI cannot answer — only a playground can, and a playground is a
build of this repository. `tests/docs-examples.spec.js` is that half: hand it
the worklist (`npm run runnable -- --json` in a docs checkout) and it opens
every example here and checks the status line and the app frame.

```sh
RUNNABLE_JSON=/tmp/runnable.json npm test -- docs-examples
```

It is **not part of `npm test`** — no worklist, no tests — because it is a
measurement rather than a gate: the input lives in another repository and the
run takes minutes. A failure is not automatically the documentation's, either.
An example may name framework API newer than the commit `tools/fetch-deps.mjs`
pins, and then the playground is right to refuse it and the pin is what moves.
