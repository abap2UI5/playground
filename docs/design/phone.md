# On a phone, and the Auto switch

> Design notes, moved out of `AGENTS.md`. Read this before touching the narrow layout, the toolbar, the bottom panel's strip or Auto.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## On a phone

Below 820px (`src/shell/shell.css`, one media query; `setUpTabs()` in
`src/shell/layout.mjs`) the split becomes two tabs, ABAP and App, because half
of a phone is not a pane. Two more things follow from the same arithmetic, and
both are easy to undo by tidying up:

- **The toolbar compacts rather than wrapping.** The header is two rows: the
  project's bar, which behaves as the catalogue's does (the brand's word and
  the two marks go below 620px, the search shrinks to its glyph below 820, and
  the four sections become their marks below 620), and the workbench beneath
  it, which is what this is about. At desk width it is one row; on a phone the
  single bar this used to be wrapped to four — a fifth of the screen, spent
  before the editor or the app got any of it. What repeats itself goes (the
  version line, which the About dialog carries as well), the paddings shrink,
  and the `.spacer` that holds the right-hand group at the edge is dropped so
  it stops pushing the last control onto a row of its own. Nothing is
  *removed*: every control is still there and still reachable, which is what
  `tests/shell.spec.js` holds it to, along with the height of **both rows
  together**: 128px of a 760px phone, measured on the running page. That is
  28px more than the one row it replaced, and what those 28px buy on a phone is
  the four sections and the search, which the old row had dropped entirely.
  The version line still goes at 1560; the two widths that dropped the brand's
  word at 1440 and the whole nav at 1280 are gone with the crowded row that
  needed them.
- **The panel starts folded away** (`setUpInsight()` in `src/shell/insight.mjs`).
  It is a fixed 11rem under an editor that has about 25 to give, so on a narrow
  screen it opens collapsed to its tab strip — where the Problems badge still
  carries the count, so it says whether it is worth the room before taking any.
  Folded or open is remembered from then on
  (`abap2ui5-playground:insight-collapsed`), and only when somebody *said* so:
  the panel opens itself when something is written to the log, and a failure
  taking the screen is not a request to have it open tomorrow. The strip carries
  a **toggle** at its far end — clicking the open tab has always collapsed the
  panel too, but nothing on the screen said so — and the ten tabs scroll among
  themselves underneath it, so the control that gives the room back never
  scrolls out of reach. The edge that has more tabs beyond it fades out
  (`insight.mjs` sets the classes as the strip scrolls - without it "Roundtr"
  cut at the toggle read as the end of the strip), and the tab that opens is
  scrolled into view, by hand rather than with `scrollIntoView( )`, which
  scrolls every ancestor. Where the pointer is a finger (`(pointer: coarse)`) the
  strip grows to a height a finger can hit and the toggle to a width one can,
  and the toggle's hit area reaches up past the resize grip, which otherwise
  sits over its top edge and turns a tap that lands there into a drag of
  nothing; `tests/insight.spec.js` taps it under touch emulation.
- **Monaco's horizontal scrollbar is hidden below 820px** (`shell.css`). Every
  line of a class is wider than a phone's editor, so it was always there - a
  grey slider 12 pixels tall over the start of the last line, which read as
  something left behind ("the grey block"); a finger scrolls the code sideways
  by swiping. The vertical one stays: it says how long the class is.
- **Run brings the app forward**, the way picking a sample always did: with one
  pane on screen, pressing Run and being left looking at the code is a dead end.
  `run()` answers whether it got as far as starting an app, and only then does
  the caller switch — a run that stopped on an abaplint error left the problems
  list open, and that is what the reader has to be looking at. Both halves are
  in `tests/shell.spec.js`; the same `if (started)` guards a sample picked in
  the examples browser, which had switched either way.

**Auto, the switch beside Run** (`main.mjs`, `tests/shell.spec.js`). On, Run
itself goes inactive — there is nothing left for it to do — and every change
to the ABAP starts the app again 700 ms after the typing stops. Off by
default, because a run is a fresh database and a fresh app in the frame,
which throws away whatever was on screen: not what somebody halfway through a
form in their own app wants, and exactly what somebody watching a view take
shape wants. Three details are easy to undo by tidying up: Run's disabled
state has three reasons now (the page has not started, a run is under way,
autorun has the job) and they are decided in one place, because a run
finishing under autorun used to hand the button back; a run of any kind
clears the pending timer, so opening a sample is not followed by a second run
of the same text; and a change that arrives while a run is under way is run
after it rather than dropped. It follows the storing rule the theme and the
checker settings follow — kept only while it differs from the default, and
never restored in an embedded playground. Autorun does not bring the app
forward on a phone the way pressing Run does: it fires while somebody is
typing, and taking the editor off the screen mid-word is not what they asked
for. For the same reason its run never moves the caret (`run({ quiet })`): a
pressed Run takes it to the first error, or to the line a dump was raised at,
and an autorun did the same - so a pause in the middle of a statement, which
is an abaplint error, sent the rest of the statement to wherever that error
was.
