# Build and runtime traps (the Findings)

> The **Findings** sections of the plan the playground was built from
> ([docs/history/PLAYGROUND_PLAN.md](../history/PLAYGROUND_PLAN.md)), moved here
> unchanged because they still hold: every trap in the build and the runtime -
> the transpiler flags without which nothing links, the type caches that must be
> cleared on redefine, the `frameOptions` story. Read them before touching
> `tools/` or `src/runtime/`. Phase numbers refer to the plan.

## Findings

**The most important part of this document.** What turned out differently from
the plan, what it cost, and above all: every trap that follows from no
documentation anywhere and shows up as an incomprehensible runtime error.
Anyone touching the build or the runtime reads this first — several of these
points cost hours each and are avoidable in one line.

The rule for new phases: extend this on completion — what was different, which
measurements, which upstream issues were opened.

### Phase 1 findings

**Measurements** (abap2UI5 @ 67f214d, abaplint 2.120.26, transpiler 2.13.59):

| | |
|---|---|
| Downport (`abaplint --fix`, 106 iterations) | ~3 min, 0 issues |
| Transpile | ~20 s, 735 objects |
| Bundle `dist/runtime/framework.mjs` | 8.7 MB, **0.8 MB gzip** |
| `sql-wasm.wasm` | 643 KB |
| Framework boot in the browser (import until ready) | ~1.2 s |

**Five traps, every one of them a hard stop.** They are here because not one of
them is evident from the documentation, and each surfaces as an
incomprehensible runtime error:

1. **`addCommonJS: true` is mandatory even though we build ESM.** Without the
   flag the transpiler writes `.mjs` files with *no imports or exports at all*,
   referring to each other by bare identifier (`class cl_abap_classdescr extends
   cl_abap_objectdescr`). That works in *no* loader, Node included — verified.
   With the flag there is a real module graph of `await import(...)` and
   `export {...}` that esbuild bundles normally. The flag's name is misleading:
   no CommonJS is produced.
2. **`keepNames: true` is mandatory.** open-abap implements RTTI through
   `@KERNEL` escapes that read the **JavaScript constructor name**
   (`cl_abap_typedescr=>describe_by_data` → `p_data.constructor.name`). Every
   bundler renames classes on a name collision — and `abap.types.String`
   collides with the global `String` immediately. Without `keepNames` every
   DESCRIBE returns the wrong type; the error appears as `CONVT_NO_NUMBER`
   while the type cache is being built, miles from the cause.
3. **`Buffer` is needed before any application code runs.**
   `cl_abap_char_utilities` builds MAXCHAR/MINCHAR from hex in its class
   constructor. The fix: the npm `buffer` package through esbuild's `inject`.
4. **The runtime's default console writes to `process.stdout`.** The first ABAP
   `WRITE` happens inside a class constructor in open-abap (a "todo" WRITE in
   `describe_by_data`) — that is, before one could assign `abap.console` at
   all. The fix: redirect the module
   `@abaplint/runtime/.../console/standard_out_console` to an in-memory console
   of our own, through an esbuild plugin.
5. **`crypto` must not be a throwaway stub.** `cl_system_uuid` checks
   `if (CRYPTO.randomUUID)` and otherwise falls back to `window.crypto` — a
   stub whose `randomUUID` *exists* and throws breaks that fallback. Every
   roundtrip draws a draft id through it. The fix:
   `src/runtime/node-crypto-shim.mjs` implements `randomUUID`/`randomBytes` for
   real over WebCrypto and throws only for `createHash`/`createHmac`
   (synchronous hashing does not exist in a browser — and abap2UI5 does not use
   it).

Further Node modules (`zlib`, `http`, `https`, `net`, `tls`, `fs`, `path`,
`url`, `util`) are imported by open-abap-core classes that abap2UI5 never
calls. They resolve to throwing stubs — the message names the missing module
rather than landing somewhere as "x is not a function".

**Not needed:** `express-icf-shim` and `steampunk-2305-api-intersect-702` (both
foreseen as dependencies in the original plan) — the `if_http_*` interfaces
come from open-abap-core, and the ICF route is not taken at all.

**Bundle size:** the bundle holds the entire open-abap standard library,
because `init.mjs` loads every object. Tree shaking is impossible as long as
ABAP resolves classes dynamically through `abap.Classes[name]`. 0.8 MB gzip is
uncritical for a playground.

### Phase 2 findings

**The planned fetch-ICF shim is dropped — it was the wrong road.**
`z2ui5_cl_ui5_http_handler` has, in `_main( is_req )`, a *public class method*
taking a plain structure (`method`, `body`, `path`, `t_params`) and returning a
plain structure (`body`, `status_code`, `status_reason`). The whole
`if_http_server` apparatus exists only to fill and empty those two structures.
Rather than reimplementing it, `zcl_pg_bridge` calls the method directly — 40
lines of ABAP instead of a fake ICF layer.

What falls away with it falls away rightly: compression, stateful sessions and
the `sap-contextid` header dance have no meaning on a static page, and the CSRF
check exists to reject cross-origin POSTs — here the request never leaves the
browser.

***Reading* structures from JavaScript is easy, *building* them is not.** Which
is why the bridge takes a string and returns a structure:
`res.get().body.get()`. The other way round would have meant assembling an
`abap.types.Structure` by hand.

**The app class name comes from the URL query**, not from a JSON field of its
own: the frontend sends `S_FRONT.SEARCH`, and
`z2ui5_cl_ui5_handler=>request_app_start` reads `app_start` out of it. For the
iframe that means appending `?app_start=<CLASS>` to the iframe URL, and nothing
else.

**A transpiled global class is self-sufficient** — no import, no export; it
reads `abap` from the global scope and ends by registering itself in
`abap.Classes`. For phase 5 that means live-transpiled user code can be loaded,
and loaded again, with `new Function("abap", src)`. A blob URL import would
actively hurt here, because the browser caches blob modules for the lifetime of
the page and a second Run would register the old version.

### Phase 3 findings

**The UI5 CDN is dropped — OpenUI5 ships with the site.** The original plan
called for `https://sdk.openui5.org/...` (abap2UI5's own default, too). What
spoke against it at first was only that the build environment blocks that
domain, so not a single render test ran. Thinking it through, the shipped
variant was the better one anyway:

- The version is pinned, which makes the playground reproducible.
- It survives an outage of sdk.openui5.org.
- The "everything static" rule from the working rules then really holds.
- **And the tests can render** — phases 5 and 6 depend on that.

The cost: `tools/build-ui5.mjs`, ~60 s of build time (plus a one-off framework
download) and **103 MB in `dist/app`**. That sounds like a lot and is not: UI5
loads library preload bundles on demand, and a typical app pulls a few MB. Page
size ≠ transfer size. GitHub Pages allows 1 GB.

**Less turned out to be more when trimming.** A first attempt also threw away
every translation (`messagebundle_*.properties`) and the RTL stylesheets — that
saved 22 MB and promptly produced 404s, because UI5 requests the bundles *by
locale* and does not quietly fall back to the base bundle. What remains removed
is only the unambiguously unreachable: `-dbg.js`, `.js.map`, `.less`,
`test-resources/` and `sap/ui/test/` — still 6266 files and a good third of the
tree.

**`sap-ui-version.json` has to be written by hand.** `ui5 build` produces the
file for library projects only, not for applications — but the frontend asks
for it on every start (`core/Server.js` reads `sap/ui/VersionInfo`). Without
it: a 404 plus a UI5 error message on every page load.

**The class name goes in through the iframe URL**, and the cache buster with
it. The fetch interception therefore compares only `origin` and `pathname`,
never the full URL — otherwise the counter in the query string would stop the
roundtrip from being recognizable as one.

**UI5 prefixes control ids with the view id** (`mainView--btnGreet`). Tests
should match on the suffix (`[id$="--btnGreet"]`) — that is the part the ABAP
actually chose. An input carries its value in the `-inner` element.

**An interface constant lives under its qualified name**: `z2ui5_if_app=>version`
is `abap.Classes["Z2UI5_IF_APP"]["z2ui5_if_app$version"]` in the transpilate,
not `.version`.

### Phase 4 findings

**No web worker — and that is not laziness.** `@abaplint/monaco` calls the
LanguageServer methods **synchronously** inside the Monaco providers, so the
registry has to live on the same thread. The problem was the first parse (~3 s
in Node, ~4 s in the browser), which would freeze the page. The fix:
`reg.parseAsync({progress})` — the `tick` hook is **awaited**, so one can yield
to the event loop inside it. A `setTimeout(0)` every 25 objects is enough: the
page stays responsive and shows progress. Careful: the progress object needs
`tickSync()` **as well**, or the second half of the parse
(`FindGlobalDefinitions`) throws.

After that everything is incremental: a change to the user's file costs
**3–4 ms** for the reparse plus diagnostics, whatever the size of the corpus.

**`keepNames: true` is needed in the page bundle too.** Without it abaplint
stops resolving `z2ui5_if_client` and reports "unable to resolve" — the same
failure mechanism as in the framework bundle (phase 1, point 2), one level up.
abaplint needs `Buffer` as well, while building its DDIC built-ins.

**abaplint has no completion API.** `@abaplint/monaco` does register a
`CompletionItemProvider`, but it returns nothing more than a handful of fixed
snippets (`method`, `bool`, `true`, …) — no symbols. The LanguageServer knows
`hover`, `gotoDefinition`, `rename`, `references`, `documentSymbol`,
`codeActions`, `documentFormatting` and `semanticTokens` — but no `completion`.
The name completion in the playground is therefore written here, and
deliberately modest: it completes **object names** from the registry, not
members. Anyone who wants to know what a method is called uses hover or go to
definition.

**The URI has to be exactly the registry's file name.**
`LanguageServer.diagnostics` looks the document up through
`reg.getFileByName(uri)`. Monaco's model URI and the abaplint `MemoryFile` name
have to be character-identical — otherwise zero diagnostics come back
silently, which looks exactly like "everything is fine".

**The pretty printer always indents**, even with every formatting rule turned
off: `PrettyPrinter` uses the rule config for options only, not as a switch.

### Phase 5 findings

**The planned in-browser downport is dropped with nothing in its place.** The
transpiler understands modern ABAP directly — tested with
`VALUE #( FOR i = 1 WHILE … )`, `COND #`, string templates, inline `DATA(…)`,
table expressions and the builder chain: 56 ms, no complaint. The downport in
the *framework* build stays regardless, because it is proven there and it
guards the library against 702 semantics; for user code it is superfluous.

**The transpiler always transpiles the whole registry** — `Transpiler.run(reg)`
iterates `reg.getObjects()`, and `addDependencies( )` does not change that: 684
objects, **18 seconds**. Useless behind a Run button.

The solution is a **proxy onto the registry** in which `getObjects()` returns
only the user's class. What matters there is `this`: the proxy returns methods
**unbound** (`Reflect.get(target, prop, receiver)`) so that they run with the
proxy as their receiver. That way `setConfig` (which marks objects dirty) and
`findIssues` iterate the filtered list as well. Bind to the original instead
and every compile marks the whole corpus dirty and forces a 3.5 s reparse. With
the right receiver: **10–50 ms**.

The transpiler **does not restore the config** it sets (a different release,
`errorNamespace: VOID_EVERYTHING`). The playground restores it afterwards
itself — through the proxy as well, or the restore costs another full reparse.

**`Transpiler.run` is async and cannot be unwrapped synchronously.** A first
attempt to read the promise synchronously worked nowhere — `compile( )` is now
properly `async`.

**The most important find of the phase: type caches are keyed on the class
name.** A second run with changed attributes produced `BINDING_ERROR - No class
attribute for binding found` for an attribute that was plainly there in the
source. The cause: `cl_abap_objectdescr=>mt_cache` (RTTI, open-abap) and the
`mt_attri_cache` / `mt_bool_cache` in `z2ui5_cl_ui5_util_context` still
describe the *old* version of the class after it is redefined.

`defineClass( )` therefore clears, after every load, every static attribute
whose name contains `cache` — **generically rather than by a list**, because a
list goes stale the moment abap2UI5 adds a cache. A cache cleared for nothing
costs a rebuild; one that is missed costs an error nobody can explain.

**A transpiled class is loaded with `new Function`, not as a blob module**:
blob URLs are cached by the browser for the lifetime of the page, so a second
Run would register the first version again.

### Phase 6 findings

**An aggregation element needs its container's namespace.** The form sample
failed at first with `failed to load 'sap/m/content.js'` — UI5 looked for a
control called `content` in `sap.m`, because `ele( \`content\` )` landed under a
`form:SimpleForm` without a prefix. The correct call is
`ele( n = \`content\` ns = \`form\` )`. The error is not a rendering failure but
a **loading** failure — the app terminates rather than looking wrong.

**Tests against UI5 need the control root, not the input element.** A checkbox
in a table renders a hidden `<input>` behind a styled box; what is clickable is
`[id$='-selectMulti']`, not `…-CB`.

**The status line alone is not a synchronization point.** After switching
samples it still says "running" from the previous app while the new one
compiles — a check can then run against the app that is being replaced.
`tests/helpers.mjs` therefore waits for the iframe's `src` to change (the run
counter is in it).

**A tab switch must hide nothing at desk width.** The first version of
`show( )` set `hidden` unconditionally, so picking a sample on a large screen
hid the editor. `show( )` now checks the media query and, at desk width, only
moves the tab marker.

**Share links are small enough.** A sample of ~2500 characters becomes under
700 as `deflate-raw` plus base64url — ABAP compresses beautifully. The code
sits in the **fragment**, so it never leaves the browser.

### Phase 7 findings

**What a visitor really downloads: ~3 MB compressed.** Broken down
(`npm run check:size`):

| | compressed | raw |
|---|---|---|
| `assets/shell.mjs` (Monaco, abaplint, transpiler) | 1.33 MB | 5.73 MB |
| `runtime/framework.mjs` (abap2UI5 + open-abap) | 0.80 MB | 8.51 MB |
| `editor/corpus.json` (the ABAP sources for the editor) | 0.60 MB | 3.80 MB |
| `runtime/sql-wasm.wasm` | 0.31 MB | 0.63 MB |

The published site is much larger at **127 MB** — almost entirely UI5, loaded
on demand. Page size and transfer size are two different things here, and the
budget in `tools/check-size.mjs` measures both separately.

**A CI run takes about 5 minutes** — including the downport, the transpile, the
UI5 build and 39 browser tests. Without caches it would be nearer ten.

**The test suite paid for itself twice**, in places no lint would have found:
the missing namespace on an aggregation (the app terminates while loading, not
while rendering) and the type caches after a second run. Both would have
reached a human only through using the thing.

### Phase 8 findings

**The better rule is positional.** "The class has to be called ZCL_PLAYGROUND"
was a crutch from the single-file days: it would have forced every deep link to
rename the class it points at. **The first file is the app** is shorter to
explain, makes multi-file and deep links possible at the same time, and the
error message ("the first file declares no class") is more concrete than
abaplint's "Class definition name must match filename".

**Duplicate file names hang Monaco.** Two `?src=` parameters pointing at the
same file left the page sitting at "starting…" — `createModel` with a URI that
was already taken. A duplicate object name is now an explained error rather
than a hang: an ABAP object has one name.

**Definition order: interfaces before classes.** A transpiled class reads its
interface's constants off the interface object *while being defined*; an
interface defined afterwards is not there yet.

**An embedding must not touch the reader's draft.** The embedded playground
neither reads nor writes `localStorage` — otherwise a documentation page would
overwrite the work somebody has open in a normal playground. There is a test of
its own for it, because the bug would otherwise be noticed only once it had
happened.

### Findings from the review

A review across the whole branch found six real defects that had survived every
test. They are here because they have a shape:

1. **A guard on a name rather than on a position.** The "the first file cannot
   be closed" rule checked the literal name `zcl_playground.clas.abap`. In a
   deep link the first file is called something else — it got a close cross,
   and closing it would have silently changed which class Run starts.
2. **A message that is deleted straight away.** The error from a broken `?src=`
   link was shown and hidden two lines later by the `hideOutput( )` at the
   start of `run( )`. **The test was green anyway**, because `toContainText`
   also reads hidden elements — the tests now assert `toBeVisible`.
3. **A check on one of three paths.** The `?src=` path validated file names;
   the share-link and localStorage paths did not. A fragment with a duplicate
   name made Monaco throw *before* `boot( )` reached its try/catch — the page
   stayed at "starting…" with every control disabled. One function now checks
   all three entrances.
4. **A build step that was not idempotent.** Injecting the bridge script ran on
   the cache-hit path too, so every incremental build appended another
   `<script>` — the second copy would have wrapped the `fetch` the first one
   installed. Verified: 1 → 2 → 1 after the correction.
5. **A cache that lives too long.** Completion memoized the object names
   forever, so any class the user added later was missing — although the
   comment promised "the user's own".
6. **A re-entry guard in the wrong place.** `runButton.disabled` protects the
   button only; Ctrl+Enter and the sample menu called `run( )` around it. Two
   runs would have fought over `frame.src` and the one-shot `load` listener.

The common denominator: four of the six are **state maintained in one place and
read in another**. And one of them shows that a green test is worth nothing
when it checks the wrong property.

### Addenda

**The app area now follows the system theme.** In dark mode the right half was
blindingly white, because the shell and the editor followed
`prefers-color-scheme` and UI5 did not. Both Horizon themes are in the build
anyway; the iframe is given the matching one through the `sap-ui-theme` query
parameter, which UI5 reads from the URL and which overrides the bootstrap
attribute.

A theme change while an app is *running* swaps UI5's theme at run time
(`sap/ui/core/Theming.setTheme`, falling back to
`sap.ui.getCore().applyTheme`) instead of reloading the frame. A reload would
restart the app — and throwing away a half-filled form because the sun went
down would be the wrong response to a sunset.

**The subpath was the last untested deployment risk.** GitHub Pages serves a
project site under `/<repo>/`, never at `/`. Everything in the code builds its
URLs through `new URL(x, document.baseURI)` — correct, and untested, because a
test at the root passes either way. `tools/serve.mjs` therefore mounts the tree
under a prefix as well, and `tests/subpath.spec.js` drives the whole path
there: load the framework, load the corpus, render the app, fire a roundtrip,
no 404.

**Two finds while tidying up at the end.** The page bundle's source map was
20 MB — a sixth of the published site, fetched only by a browser with devtools
open, and anyone debugging the playground has the sources anyway. It is now
built only with `PG_DEBUG=1`, the same switch the framework bundle already
used.

Measuring that change then showed that `dist/` was **never cleared**: the old
source map was still sitting there after the change and the number had not
moved. `build-site.mjs` now deletes the directories it owns (`assets/`,
`editor/`, `examples/`) before writing — a stale file nothing references any
more is indistinguishable from a current one. The published site afterwards:
**106 MB instead of 127 MB**.

### Findings from the second review (after the merge)

A second pass at a higher effort level found one serious defect and a run of
smaller ones. The serious one earns its entry:

**Inheritance was completely broken — and not one line of test knew.** Every
transpiled chunk runs in a function scope of its own, and almost every
reference it makes goes through `abap.Classes['...']` at *run* time — with
exactly one exception: the superclass. `class zcl_child extends zcl_base` names
it as a bare identifier, at *definition* time, and in an isolated scope that
identifier is unbound. Every `INHERITING FROM` — including from a framework
class like `cx_static_check` — ended as a `ReferenceError`. The transpiler even
says so: `output.objects[].requires` lists exactly these names. `compile( )` was
throwing the list away.

The fix has two halves and both are needed: a **prologue** per chunk binding
every `requires` name from `abap.Classes` (with a readable message if it is
missing — "Class extends value undefined" names neither class), and a
**topological order** within the batch, because the prologue binds what is in
`abap.Classes` *at that moment* — so a superclass from the editor has to have
run first. The old "interfaces first" sort was a special case of this and
survives as the starting order.

Why no test found it: **no sample and no test used `INHERITING FROM`.** The gap
was not in the testing but in the test plan — the language features the chunks
constrain *structurally* (definition-time rather than run-time resolution) had
never been mapped. Two tests now cover both cases: a superclass in the editor
(in the *second* file, so the ordering is checked too) and a superclass in the
framework.

The smaller finds of the same pass, one line each: a share link in the fragment
outranked the newer draft once work continued (the fragment is now removed on
the first edit); the share test opened the link in the same browser context and
would have passed with a completely broken decoder (its own context now);
`run( )` waited indefinitely on the iframe `load` and left Run disabled forever
behind a hanging frame (bounded at 30 s); completion cut alphabetically to 200
*before* ranking prefix matches to the front (rank first, then cut); the UI5
build hash hashed base names rather than paths and would have counted an
upstream restructure as a cache hit; `tools/serve.mjs` crashed process-wide on
a malformed percent escape in the URL; two dynamic `import( )` calls in
`main.mjs` promised code splitting a single-file bundle does not have (static
now); and the `?src=` fetches ran one after another rather than together.

### Findings from the embedding work

**A format that fails silently is worse than one that fails.** The first
version of the loader's `data-code` encoder wrote plain base64 JSON. The
fragment format needs a version character **and** deflate-raw — and a fragment
the playground cannot read is treated as somebody else's link and quietly
replaced by the built-in sample. A documentation page would have shown its
reader the wrong code with nothing anywhere turning red. The test for it
therefore does not check that the playground starts; it checks that the inline
text reaches the rendered UI5 control.

**Cost is per instance, not per page.** Demos on one page share the browser's
HTTP cache, so the ~3 MB is paid once — but each iframe parses the 910-source
corpus into its own heap and boots its own ABAP runtime. Bytes are the cheap
part; processor and memory are not. Which is why `abap2ui5-embed.js` renders a
button and mounts the frame on click, rather than autoloading.

**`ready` has to mean "there is something to see".** Announcing it when the
page has loaded would have an embedding page reveal a blank frame; it is sent
after the first run instead.

### Findings from the editor panel and the second linter

**The abap2UI5 linter answers a question abaplint cannot.** abaplint says
whether the ABAP compiles. `@abap2ui5/linter` reconstructs the XML the
`z2ui5_cl_ui5_view_builder` chain produces — without running a line of ABAP —
and checks it against a UI5 release. That covers the class of mistake the
playground could otherwise not show at all: a control or property that the
target release does not have, an icon that is in no icon font. They compile,
and at run time they render nothing and log nothing, so the reader sees a gap
where a button should be and goes looking in the wrong file.

**The two are kept apart in what they block.** An abaplint error stops Run,
because there is nothing to start. An abap2UI5 finding does not, because the
app runs and is wrong — and looking at the wrong app is the fastest way to
understand the finding. Blocking there would hide the evidence.

**Getting the linter into a browser is three pieces of plumbing, all of which
fail at *import* time rather than when called** — which is what makes them
worth writing down, because the symptom is a blank page, not a stack trace
pointing at the feature:

1. `lib/render.mjs` (the screenshot renderer) calls `createRequire( )` and
   `os.tmpdir( )` at module top level. Nothing in `checkAbapSource( )` reaches
   it — `openRenderer( )` is used only by `checkFiles( )` and
   `screenshotFiles( )`, which need a filesystem anyway — so the whole module
   is replaced at bundle time.
2. `lib/icons.mjs` and `lib/properties.mjs` build their default data paths with
   `path.join(path.dirname(fileURLToPath(import.meta.url)), …)` at top level.
   Both `fileURLToPath` and `path.join` are pure string work, so they are
   answered for real rather than stubbed. The throwing `path` stub was the
   second blank page.
3. Those two then `fs.readFileSync` their metadata. It is two JSON files that
   do not change between builds, so they are baked into the bundle and handed
   back by a `readFileSync` that knows those two names and nothing else.

All three are scoped to the linter by the importing module's path, so the rest
of the page keeps the ordinary stubs and a stray `readFileSync` anywhere else
still fails loudly. Cost: **+0.11 MB gzip** on the page bundle.

**`documentSymbol( )` does not take the same parameter shape as
`diagnostics( )`.** `diagnostics({ uri })` against
`documentSymbol({ textDocument: { uri } })`. Passing the first shape to the
second throws *inside* abaplint — and the outline panel had a try/catch around
it, so the exception became an empty list and read as "this file has no
symbols". The test that now covers the happy path is what found it; the catch
is still there, because a file being typed into is legitimately unparseable,
but it can no longer hide a wiring mistake.

**Two marker sources need two marker owners.** Monaco replaces all markers of
one owner at a time, so abaplint and the linter sharing an owner would have
whichever ran second erase the other's underlines.

### Findings from the config tabs and the about dialog

**The rule configuration got built after all, and the earlier reasoning still
holds — it just pointed at the wrong shape.** Phase 8 refused "188 switches for
the wrong rules", and that refusal was about a *wall of checkboxes*, not about
configurability. The tab is a text field holding the small object that actually
decides anything (the release, and the nine rules that are on). Any of
abaplint's rules can be added by name, and the full list is one disclosure away
rather than filling the screen. What a reader asks is "why is it not warning
here"; typing the rule name and pressing Apply answers it in a way no
documentation can.

**Applying a configuration is behind a button on purpose.** Changing the rules
dirties every object in the registry, so it costs a full reparse - a few
seconds. Reacting to typing would have made every keystroke pay it.

**The config views are excluded from the automatic rerender.** Everything else
in the panel is derived from the editor and rebuilt on every change; a text
field somebody is halfway through typing into is not, and rebuilding it under
their hands would throw the edit away.

**A test that asserted the absence of a message picked the wrong message.** The
first version enabled abaplint's line-length rule and checked that nothing
mentioned 255 characters beforehand - but the abap2UI5 linter reports that on
its own, because over 255 the object does not import at all. The test was
right and the premise was wrong. The second version picked a rule that is
genuinely style-only (`sequential_blank`), and then failed again because the
sample already had two blank lines where the test assumed one. Both failures
were the test telling the truth about what it had actually done.

**The about dialog is wired before the runtime is awaited**, outside boot()'s
try/catch. A playground whose startup failed is exactly when somebody wants the
link to the issue tracker, and a credits dialog that only works when everything
else already works is a credits dialog that is missing when it matters.


### Findings from putting it in a documentation site

The embedding feature had tests, a worked example and a README section, and it
had never been used by another site. abap2UI5/docs putting a Run button under
its ABAP examples was the first time, and it found **four defects, three of them
invisible** — the app was in the DOM, correct, and not on the screen, under a
status bar that said `running`.

**A demo is narrower than a desk.** Below 820px the two panes stop sitting side
by side and become tabs, and the tab machinery brings one of them to the front —
it brought the editor, which `?view=app` has hidden in CSS, and hid the app
behind it. So an app-only demo was an empty box. And 820px is not an edge case
for this feature, it is the normal case: the reading column of a documentation
page is narrower than that, so **every embedded demo on every page** would have
been blank. The whole of `?view=app` had only ever been tested at desk width.

**UI5 refuses to be framed by a stranger.** `frameOptions="trusted"` means "only
in a frame whose TOP window is the same origin". abap2UI5 ships it and is right
to — an app on a real system holds a session — but the app here is always in a
frame, and one whose top window is somebody else's manual. UI5 asks that window
for permission over postMessage, waits ten seconds for an answer no
documentation site knows to give, and then hides what it rendered. The
playground's own copy of the frontend now sets `allow`; the build rewrites the
attribute and fails if it is no longer there to rewrite. Note that this cannot
be done from the URL — UI5 ignores `sap-ui-frameOptions` as a query parameter,
which is the whole point of the option.

**`data-code` only ever worked for a class called `zcl_playground`.** The file
the code is put into was named that literally, and the playground refuses a file
whose name and class disagree — correctly, that is abapGit's rule. But a manual
prints its example under the name its reader is meant to create, so every
documentation page but one would have been refused before it ran. The name is
read from the source now. This one at least failed loudly.

**`definitions_top` was answering the wrong question.** The rule list is
explicitly "the ones that answer *would this work*", and this one does not: it
is a downport rule, on in abap2UI5's own configuration because the framework is
downported to 702 before it is transpiled. Nothing in the playground downports
what is in the editor. It was rejecting a `FIELD-SYMBOLS` after a `CREATE DATA` —
ABAP that compiles on every system this playground is about — and an abaplint
error stops Run, so the reader was told to fix code that had nothing wrong with
it. The rule list had been copied from a configuration written for a different
job, which is how one rule out of nine came to be about style.

**What the exercise measured.** All 61 complete app classes in the documentation
were run in a real playground, which is the only thing that can answer whether
an example runs. 38 started. Of the 23 that did not, 20 were the documentation
depending on a system — a business table, a CDS entity, an add-on, an
on-premise class — and **three were defects in the documentation that every
other check had missed**: two class names longer than the 30 characters ABAP
allows (invisible to its `check-examples`, which renames every example before
compiling it), and a UI5 binding string quoted with ABAP backticks, which UI5
answers with a syntax error and a blank page. A documentation example is not
checked until something has run it.
### Findings from autofix and the link back to GitHub

**Two fix APIs, two shapes.** abaplint has no single "fix everything" call: each
`Issue` answers `getDefaultFix( )` with an edit, `Edits.applyEditList(reg, edits)`
applies them to the registry, and it has to be run in a loop with a `parse( )`
between passes because one fix uncovers the next. The abap2UI5 linter is the
other way round - `applyFixes(source, findings)` is pure, takes a string and
returns one, and reports `deferred` for fixes that overlapped one already
applied. Both are bounded here: a rule whose fix does not settle would
otherwise spin.

**After applying, `held` has to be told.** The registry map that remembers what
the editor last had is what makes `updateFiles( )` cheap - but after a fix the
registry holds text the editor does not. Left alone, the next `updateFiles( )`
would see the editor's old text as a change and write it straight back over the
fix.

**An automatic rewrite has to be one Ctrl+Z.** The fixes are written back
through `pushEditOperations` with a full-range replace - one edit per file -
rather than `setValue`. A half-undone autofix is a state nobody asked for.

**The panel is built before the registry exists.** Adding a fixable-count to the
Problems view broke the whole page: `setUpInsight( )` renders at boot, and the
count asked abaplint something while the corpus was still parsing. The symptom
was the page sitting at "starting…" with every control disabled - the same
symptom as the duplicate-file-name bug in phase 8, and for the same underlying
reason: a throw on the boot path before anything catches it. Anything the panel
asks of the registry has to answer harmlessly before `connectRegistry( )`.

**And the same trap as the `?src=` message, caught this time before it
shipped.** The first version of the fix bar wrote its outcome into its own
label, then called `updateInsight( )` - which rerenders the bar and throws the
label away. The outcome goes to the status line instead, which survives the
render that its own success triggers.

**Switching file tabs was changing nothing.** The tab strip called `openFile( )`
and rerendered itself, and that was all - so the outline below the editor and
the link to where the file came from both went on describing the previous file.
Opening a file is not a change to the file set, which is why it never reached
`onChanged`; it now has a hook of its own.

**A test that was too strict about a fix it did not read.** The autofix test
asserted that `sequential_blank` removes the blank lines. It trims the run to
three rather than removing it, so the assertion failed on a fix that had worked
perfectly. What the test can honestly claim is that the source changed in the
direction the rule asks for.
### Findings from the fix samples, the panel controls and following a link

**A sample that is wrong on purpose breaks the promise the sample tests make.**
Every sample in the menu is checked by `tests/samples.spec.js`, and what it
checks is "it compiles and runs" - which the two quick-fix samples deliberately
do not. Rather than exempting them, the catalogue marks them `startsBroken` and
the test drives the repair: the finding is reported, the Fix button is pressed,
and the result runs. The promise still holds; for those two it means something
else, and the entry in the catalogue is what says so.

**Which method is left unimplemented decides whether the sample is any good.**
abaplint's fix writes an *empty* implementation. If the unimplemented method
were the one that builds the view, the fixed app would come up blank - a
demonstration ending in a white rectangle. It is `on_event`, which the first
render never calls, so the empty body the fix leaves behind is the right body.

**A fix that works can break a test that was right.** The namespace sample's
check looked for the input by control id. Once the fix lands, `SimpleForm`
renders its grid wrapper around that input, and the wrapper's id ends in the
same suffix - two matches, strict-mode violation. The test now checks the page
title, which is unique and is what proves the view rendered at all.

**Following a link's dependencies needs more than `NEW`.** The first version
matched `NEW zcl_x( )` and `CREATE OBJECT ... TYPE zcl_x`, which is how an app
navigates to another app - and missed the example already in the repository,
which calls its helper statically (`zcl_linked_helper=>shout( )`). Statically or
not, the file does not compile without it, so `=>` and `TYPE REF TO` are
followed as well.

**And comments had to be stripped first.** `zcl_linked_pair` opens with the
sentence "this app calls zcl_linked_helper" in a header comment. Without
removing comments, the file finds itself through its own prose.

**The follow is deliberately narrow**: siblings only, the same allow list a
linked URL passes, two levels, six files, and silence when a name is not there.
Most names are not there - they are in the framework corpus - and a link that
failed because a helper could not be guessed at would be worse than one that
opens what it can.

### Findings from merging the output window into the panel

**One panel at the bottom, five tabs.** The output window and the insight panel
were two things competing for the same edge of the screen. The panel moved out
of the left pane to the foot of the page - where the output window already was -
and the log became a tab of it.

**Moving it there would have hidden the one message that matters.** The panel is
hidden when embedded, and the left pane it lived in is hidden by `?view=app`. A
startup failure written into it would have been invisible in exactly the two
modes where the reader has no other channel. So the panel is *tucked* rather
than removed in those modes, and anything written to the log un-tucks it: an
error is not tooling, and it may take the screen without being asked.

**Then the merge made `run( )` say the same thing twice.** With two windows,
writing the abaplint errors into the output panel sat beside the problems list.
With one, it covers it - and the copy that wins is the poorer one: the log is
flat text, while each problem is a row that says which checker spoke and jumps
to the line. `run( )` now brings the reader to the problems list instead of
retyping it into the log. The log keeps what the list cannot hold: a structural
refusal, a startup failure, a dump, a link that would not load.

**Two of the tests that caught it were the ones written an hour earlier.** They
reached the log through an ABAP error - the path that had just stopped writing
it. A test that goes red because the thing it tests moved is the test doing its
job; it now triggers through a structural refusal, which is what the log is for.

**And one test lost its subject.** "The output panel does not outlive the error
it reported" was named after a window that no longer exists. What it was always
checking is that the report does not outlive the run, which is what it says now.

### Findings from putting the panel back under the editor

**The panel belongs under the source, not under the page.** Spanning both halves
made it too heavy for what it is; it lives in the left pane again.

**And the minimise button did not work - the test said it did.** `is-collapsed`
sets `height: auto` as a class, while the resize drag writes the height into the
element's **style attribute**, and an inline style beats any class. So for
anybody who had ever dragged the panel, collapsing did nothing at all. The test
passed because it never dragged first: it exercised the one path where no inline
height exists.

The button is gone, but the same trap sat in the click on the open tab, so the
cause is fixed rather than the symptom - collapsing puts the dragged height
aside and expanding gives it back. The new test drags **first**, and it was
checked against the old code to make sure it goes red there. A test whose
failure has never been seen is a test nobody has any reason to believe.

### Findings from the full screen button

**The cheap way would have tied the app to the tab that opened it.** The app in
the iframe gets its roundtrips from this page through `window.parent`, and a tab
opened from here has `window.opener` pointing back at exactly the same object -
same origin, a few lines in the bridge, done. It would also have made the new
tab a passenger: the next Run here calls `resetDatabase( )` and the popped-out
app loses its drafts mid-form, and closing this tab takes the app with it. So
the button opens the page again instead, `?view=app` and the code in the
fragment, and the new tab boots its own runtime out of its own URL. A few
seconds of boot buys a tab that owes nothing to anybody - and one that can be
shared, because it is only a link.

**`window.open` has to happen before the `await`, not after.** The fragment is
deflated asynchronously, and a window opened after an await is a pop-up as far
as the browser is concerned rather than something somebody clicked on. The tab
is opened empty in the click handler and its location replaced once the URL is
ready.

**And the test had to lose the draft first.** The new tab shares the browser
context, so it shares the stored draft - which carries the same marker the
fragment does. The test removes the draft before it clicks, leaving the URL as
the only road the code can travel; without that, the fragment could have been
empty and every assertion would still have passed.

### Findings from making the full screen view actually full

**`?view=app` could not simply lose its bar.** It is what a documentation page
embeds, and there the bar is the Run button - a demo that cannot be restarted is
a screenshot. So the tab the button opens got a mode of its own, `?view=full`:
app-only plus no bar at all. A tab needs no Run button of ours, having the
browser's reload and the editor it came from one click away.

**And a mode with no bar has nowhere left to report a failure.** The log panel
lives in the left pane, which app-only mode hides - so in that mode the status
line in the bar is the *only* channel, which is exactly what taking the bar away
would have removed. A startup failure would have left a blank tab explaining
nothing. `setStatus( )` therefore marks the page while a status is an error, and
the bar returns for as long as that lasts; a status that is no longer an error
takes it away again. The test drives it through a `?src=` nobody can follow and
then presses Run to watch the bar go.

### Findings from tables of your own and the State tab

Five things nothing documents, each found the hard way (`src/editor/tables.mjs`,
`src/editor/transpile-core.mjs`, `src/runtime/index.mjs`,
`src/runtime/app-state.mjs`):

1. **abaplint throws from `Registry.parse()` on a TABL field with no type.** A
   field with neither a `DATATYPE` nor a `COMPTYPE` + `ROLLNAME` is not
   reported, it is an exception out of the parse - which takes the editor's
   analysis down with it. So the table definition is validated by the
   playground's own check (`readTable( )` in `tables.mjs`) *before* abaplint is
   ever handed it, and a broken one is a problem in the panel instead.
2. **`Transpiler.run` over the filtered view of the user's objects returns
   `databaseSetup.schemas.sqlite` holding exactly the user's `CREATE TABLE`s**
   - nothing of the framework's - which is what `compile()` hands the runtime
   to create (`createStatements( )` in `transpile-core.mjs`).
3. **Private attributes are JavaScript `#private` fields** in the transpiled
   class, invisible to any reflection from outside. The one way in is
   `FRIENDS_ACCESS_INSTANCE`, which the transpiler emits for `FRIENDS`; the
   State tab's snapshot reads through it (`snapshot( )` in `app-state.mjs`).
4. **A DDIC entry needs the same restore-on-redefine as `abap.Classes`.** A
   table's chunk registers its type in `abap.DDIC`; a later set that does not
   carry it must put back whatever the previous set shadowed, exactly like the
   class map (`defineClasses( )` in `src/runtime/index.mjs` keeps the two
   put-back maps side by side). A table name may not reuse a framework or
   open-abap DDIC name at all.

5. **`DELETE dbtab FROM wa` deletes every row.** @abaplint/transpiler 2.14.3
   passes the runtime the table and a `WHERE`, never the work area, so the
   statement reaches SQLite as a bare `DELETE FROM dbtab` - `sy-subrc = 0`,
   `sy-dbcnt` the size of the table. `DELETE FROM dbtab WHERE key = ...`
   deletes the one row; `UPDATE dbtab FROM wa` is not affected. So **→ App**
   writes the WHERE form (`app-from-table.mjs`).

A data element (`ROLLNAME`) a field names must exist in the corpus, or the
transpiler types the field as `VoidType` and the table cannot be created.

### Findings from isolating the app frame

What putting the AI pages' app frame on an opaque origin (`sandbox` without
`allow-same-origin`, [runtime.md](runtime.md)) ran into. Each is in the code
it shaped.

1. **An opaque-origin iframe is uncacheable in Chromium** (measured). Its
   requests are keyed on a one-off network isolation key, so nothing it
   fetches is served from - or stays in - the HTTP cache the page primed, and
   no service worker controls it. That is why the isolation stops at the two
   AI pages, why `boot()` skips the warm-up there (`frameIsolated`), and why
   their frame is online-only ([load-time.md](load-time.md)).
2. **`localStorage`, `sessionStorage` and `document.cookie` THROW there** (a
   `SecurityError` on access), and UI5 and an app's code read them where they
   do not expect that. `Window.localStorage` is a configurable accessor, so
   `frontend-bridge.js` shims all three in memory for the document's
   lifetime. `history.replaceState` still works. `location.origin` is the
   URL's origin while `self.origin` is `"null"` - so the frame can still post
   to its parent BY NAME (`postMessage(m, location.origin)`), while the page
   has to post to `"*"` and therefore sends nothing secret.
3. **The abap2UI5 frontend's fallback error view writes into an inner
   sandboxed iframe's `contentDocument`**, which is `null` inside an opaque
   frame; the frontend then writes the error into its main document instead,
   which is what an isolated frame shows.
4. **A parent may `location.replace( )` a cross-origin child** (one of the
   two things it may do to it), so `navigate( )` in `frame-link.mjs` keeps
   Run from pushing history entries on an isolated frame too; reading the
   child's `location.href` throws, which is why the frame REPORTS its href
   (`state`) and the page reads that.
5. **The isolated frame's XHRs and fonts are cross-origin requests**: GitHub
   Pages answers with `access-control-allow-origin: *` (checked 2026-10-17),
   and `tools/serve.mjs` sends the same so the tests see what production does.
   Load-bearing; a host without it breaks the AI pages' frame.
6. **A worker's `caches`, `indexedDB`, `Worker` and `SharedWorker` live on
   the global's prototype chain**, not on `self` itself, so
   `src/runtime/lockdown.mjs` deletes them wherever the chain defines them
   (the browser's accessors go with the properties) and then pins each on
   `self` as `undefined`, read-only and non-configurable, so nothing later
   can define them again.
7. **A cache name is no secret**: `caches.keys()` lists it to any
   same-origin script, so an unguessable name was refused and the service
   worker hashes a cached hit before serving it (`verifiedHit( )` in
   `sw.js`) - 70-210 ms of WebCrypto for ~20 MB, off the page's thread.
8. **The frame's files are the same hole.** Leaving the UI5 tree under
   `app/` unchecked because "only the frame loads it" missed that the
   playground's frame is this origin: a link's view could write its own
   `sap-ui-core.js` into the cache and run first on every later visit.
   The hashes live in `app-hashes.json` beside the worker (6,030 files is
   0.6 MB - too much to parse at every start of the worker), named in it by
   its own hash, so a forged copy of the file is refused like a forged
   script (`tests/worker.spec.js`).

### Findings from the guides, Compare and the layout editor hand-over

1. **A chunk that imports a shell module splits the shell.** esbuild gives
   every set of entry points that reaches a module a chunk of its own, so
   `first-steps.mjs` importing `insight.mjs`, or `compare-dialog.mjs`
   importing `file-sets.mjs`, moved those out of `assets/shell.mjs` into new
   shared chunks - one more request on every page, and a shell budget that
   measured less than the shell. What a chunk needs is handed to its setup
   function instead ([load-time.md](load-time.md)).
2. **Monaco's diff editor wants a worker the page does not give it.** Its
   `IEditorWorkerService.computeDiff` posts to Monaco's editor worker, which
   this page never starts; `showDiff( )` in `monaco-editor.mjs` replaces that
   method with Monaco's own lines diff computer run on the page
   (`linesDiffComputers`), which is fast enough for a class.
