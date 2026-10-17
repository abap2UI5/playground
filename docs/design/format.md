# Format

> Design notes, moved out of `AGENTS.md`. Read this before touching Format, `FORMAT_RULES` or the document-formatting provider.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## Format

The `{ }` in the bar and Shift+Alt+F are **one** implementation —
`formatFiles( )` in `src/editor/registry-core.mjs`, run in the worker, reached
from the button through `format( )` in `src/editor/editor.mjs` and from the key
through the document-formatting provider in `src/editor/providers.mjs`. Two
ways in with two ideas of what formatting means is a bug somebody finds by
pressing the other one - and for a while that bug was here: the worker
formatted every open file for both, but Monaco takes an edit for the model it
asked about and no other, so the key dropped the rest and formatted one file
while the button formatted all, and README, this file and the About dialog
described three different things. The provider now writes the other files
through the same `writeSource( )` the button uses (`host.write`) and reports
through the same status line (an `abap2ui5-formatted` event the bar listens
to), so the key and the button leave the same files behind.

It is abaplint's pretty printer with abaplint's **layout fixes in front of
it**. The printer is two things and only two — keyword case and indentation —
so Format used to leave a tab, a trailing space, a double space, a `.` with a
space in front of it and two statements sharing a line exactly where they were.
The rules that repair those are ordinary abaplint rules with fixes, and
`FORMAT_RULES` there is the list: layout only, and separate from the rule set
the Config tab decides — somebody who turned a rule off to stop being nagged
did not thereby ask for their code to keep its tabs. Fixes, then print, then
round again, in a registry of its own holding the user's files and nothing
else: these rules need no corpus, and reconfiguring the registry that holds one
would be several seconds of reparse on a press of Format.

**"The double space" means a run after a keyword, an `=` or a bracket** - and
never the padding in front of a token, which is kept as alignment:
`a    =   b.` comes back `a    = b.`. That half is the house layout
(assignments, components and a builder chain's `v =` column are lined up by
padding), and folding every run rewrote 2,300 lines of the pinned samples.
The comment beside `double_space` in `FORMAT_RULES` says so, and
`tests/node/format.test.mjs` holds both halves.

What is left OFF the list is the load-bearing half. `keyword_case` and
`indentation` are the printer's own job, and applied as edits beside it they
corrupt the source — both are computed against the same offsets and applied one
after the other. `align_parameters`, `line_break_multiple_parameters` and
`keep_single_parameter_on_one_line` each take an abap2UI5 builder chain and
break every `)->a( n = … v = … )` line into two; a formatter that reformats the
house style is one nobody presses twice. And nothing on the list changes what
the code does: obsolete-statement rewrites, `prefer_inline` and the rest stay
behind **Fix them** in the Problems tab, which says how many and why.

Format runs over **every open file**, not the one on screen — a class and its
test include are one piece of work — one edit per file, so Ctrl+Z takes the
whole thing back; the status line says how many files changed, or *already
formatted*. `tests/format.spec.js` holds all of it, the chain that has to come
back byte for byte included.
