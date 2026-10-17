# The two checkers, what is kept between visits, and the Fix-them contract

> Design notes, moved out of `AGENTS.md`. Read this before touching abaplint, the abap2UI5 linter, the Config tabs, stored settings, the draft or Fix them.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## The two checkers, and the Fix-them contract

- **abaplint** (`src/editor/registry.mjs`) answers *does this compile*, against
  the real framework sources at release v750, with a deliberately small rule
  set — only rules that answer "would this work", never house style. An
  abaplint error blocks Run.
- **The abap2UI5 linter** (`src/editor/lint-core.mjs` in the registry
  worker, `src/editor/abap2ui5-lint.mjs` on the page, `@abap2ui5/linter`)
  reconstructs the view the builder chain produces and
  checks it against UI5 **1.71**, the floor abap2UI5 holds its shipped apps to.
  A finding does not block Run: the app runs and is wrong somewhere, and
  looking at it is the fastest way to understand the finding. Its
  `trailing-whitespace`, `crlf-line-ending` and `missing-final-newline` rules
  are off here (`settingsFor( )`): the buffer is not a serialised file, and the
  abapGit zip normalises all three on the way out (`src/shell/export.mjs`).

Both configurations are live in the panel's **abaplint** and **abap2UI5 lint**
tabs (`src/shell/insight-config.mjs`); the defaults stay the curated lists. Every
Problems row links the page that explains its rule (`rule ↗`, outside the row's
button): rules.abaplint.org through the `codeDescription` abaplint's
diagnostics carry, the linter's rules page through `ruleUrl( )` in
`src/editor/abap2ui5-lint.mjs` — the finding's own `url` where the pinned
linter sets one, the page's `#<rule-id>` anchor where it does not. The Monaco
markers carry the same link as their `code`, which is the shape abaplint's
already had. The two
use separate Monaco marker owners — sharing one would have each erase the
other's underlines.

A changed configuration is kept in `localStorage` (`src/shell/checker-settings.mjs`
— the checkers hold and validate a configuration, the *page* decides to remember
one) and restored in `boot()` *before* the corpus is fetched, because abaplint's
half decides how the corpus is parsed and restoring it afterwards would parse
nine hundred objects twice. Three rules go with that: a stored setting is validated exactly like a typed
one and silently dropped when it stops making sense (a rule abaplint has since
retired); a setting that equals the default is **forgotten rather than stored**,
so the curated lists can move between deploys and reach somebody who pressed
Reset; and an embedded playground never restores either — a demo in somebody's
documentation has to read the same to every reader, the same reason it never
restores a draft.

The **theme** follows the middle rule too (`src/shell/theme.mjs`): the button
at the bar's right-hand end — the sample catalogue's button, in the catalogue's
own end group (the nav, the button, a hairline, LinkedIn and GitHub) — stores a
choice only while it differs from what the system says, so a page switched back
follows the system again, and an embedded playground never restores one.
(The switch is in the menu behind the bar's last button now. `theme.mjs`
keeps the playground's switch; the catalogue and the sample pages carry the
inline `THEME_MENU` from `src/shell/theme-boot.mjs`, and every document reads
the stored choice before the first paint with `THEME_BOOT` from the same
module - see [one-site.md](one-site.md).)

## A missing full stop

abaplint reports a statement it cannot parse as "Statement does not exist in
the configured ABAP version (or a parser error)", and the commonest reason by
far is a full stop that is not there: `DATA lv_b TYPE i` followed by
`DATA lv_c TYPE i.` is ONE statement, reported at its first line with a row
of follow-on errors. `src/editor/parser-hint.mjs` (`explainDiagnostic( )`,
applied in `src/editor/analysis.mjs`) adds the question - a missing full
stop? - to a `parser_error` where the shape says so, and moves the Problems
row to the line that wants the full stop; the underline is left where
abaplint put it. abaplint itself is not patched, and the heuristic is asked
only about a statement abaplint already refused, so a wrong guess costs a
question mark, never a false error. It also mends abaplint's
`version(or` into `version (or`. `tests/node/parser-hint.test.mjs` holds it.

## What is kept between visits: the draft and the file on screen


The **draft** follows the middle rule for the same reason: a file set identical
to one of the samples the page carries is not stored (`isSample()` in
`src/editor/samples.mjs`, applied in `remember()`). Reading a sample is not work
to continue, and storing it as a draft pinned that visitor to a frozen copy of
it — the sample was improved in a later deploy and they went on being opened on
the old one, findings and all, labelled "from your last session". One keystroke
makes it a draft again, and `tests/shell.spec.js` holds both halves.

Beside the draft, which file was on screen (`OPEN_FILE_KEY` in
`src/shell/persistence.mjs`, written by `fileOpened()`, the first file
forgotten rather than stored), so a reload lands on the test include that was
being written. The draft is written on the editor's own 150 ms debounce, so
there is nothing to flush on `pagehide`; every read and write is through
`storage.mjs`, and a stored value of the wrong shape is no draft at all
(`tests/persistence.spec.js`). A link - a fragment, `?src=`, `?gist=` -
outranks both and leaves them stored.

What it does **not** do any more is delete the draft that was there. A sample
used to go into the editor as an undoable edit — every sample the playground
carried was called `zcl_playground.clas.abap`, so `setFiles()` reused the model
and the reader's work stayed one Ctrl+Z away. The samples come out of
abap2UI5/samples now and bring their own class names, so the model the work was
in is disposed with its file and Undo cannot reach it. `replaceWith()` in
`main.mjs` works out which of the two happened and the status line says the true
one — *one Undo away* or *comes back if you reload* — and the stored draft is
what makes the second sentence true.

## Fix them

**Fix them** (`applyFixes()` in `src/editor/editor.mjs`) applies both checkers'
fixes to everything open: abaplint's structural fixes first, then the linter's,
each in a bounded loop because one fix uncovers the next — both a round trip
to the worker per file, guarded so a file typed into meanwhile is left alone. The rewrite is
written back through `pushEditOperations` as **one edit per file**, so a single
Ctrl+Z takes the whole thing back. Nothing without a correct answer is guessed
at — an icon that does not exist stays reported. Keep all of that true when
changing anything near it.

The bar over the Problems list says what the press will repair, by kind -
"2 errors and 1 warning can be fixed automatically" - and which errors it
leaves ("- the 3 errors cannot"), so nobody takes the button for the way to
make the ABAP compile (`fixableSaid( )` in `src/shell/insight-problems.mjs`).
It is counted off the rows, each of which carries a `fixable` flag from its
checker (`registry-core.mjs` sets it on abaplint's diagnostics); where the
rows fall short of the checkers' own total it says the plain number. The
contract above is unchanged.
