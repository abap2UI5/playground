# Testing: what the suite costs and why it is shaped this way

> Design notes, moved out of `AGENTS.md`. Read this before touching `tests/`, `playwright.config.js` or the CI workflows.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## Every test boots its own playground

`npm test` on its own runs against whatever `dist/` already holds, so on a fresh
clone it fails as a 30-second `webServer` timeout rather than as "nothing is
built" — `npm run check` is the entry point that cannot be typed in the wrong
order. It leaves out exactly one thing `check.yml` does: `npx playwright install
chromium`, a browser download rather than a step, which `npm test` then asks for
by name (CONVENTIONS section 3 asks for that omission to be named here).

Every test boots its own playground - about three and a half seconds of
the four seconds a typical test takes - and that is deliberate, measured
and kept. Two ways of spending less were looked at on 2026-10-10. Fewer
workers than Playwright's default of half the cores (a boot keeps three
threads busy, so "a worker per three cores"): on 4 cores the shell, boot,
embed and editor specs took 215 s on two workers and 317 s on one, because
a boot's three threads are not busy at once and two of them idle for most
of a test. And one boot per file with a shared page for the specs that
only read: there are almost none - `bfcache.spec.js` boots nothing,
`site-memory.spec.js` is about what each visit leaves in storage,
`view-edit.spec.js` saves on every test, and `shell.spec.js` edits, shares,
switches Auto and moves the splitter; the handful that only look (the bar's
two ends, the phone layouts) each need a viewport of their own. A shared
page would have bought a minute and cost the isolation that lets a failure
be read on its own. The full suite is 422 tests and more, and about
twenty-five minutes on 4 cores in one run - which is why CI runs it in four
shards (three thirds of Chromium and WebKit on its own), and the wall clock
is the build plus the slowest shard. (It was 382 tests and about sixteen
minutes when the measurement above was taken.)

The tests are the gate: everything runs through a real browser, and
`tests/samples.spec.js` imports the list of samples the page carries (`build/samples/index.json`) and drives every entry —
a sample without a test is not possible. CI:

| | |
|---|---|
| `check.yml` | every non-main branch and pull request: the composite build action (`.github/actions/build`, with caches for `deps/`, `~/.ui5` and the downport), the size budget, `npm test`. The tests run in **four shards**, one runner each: three thirds of the Chromium project (`--project=chromium --shard=n/3`) and the WebKit project on its own (`--project=webkit`, the only runner that installs WebKit) - split by test count over one combined list, the near-free file checks filled the first shard and every WebKit boot landed in the last. The build is two minutes with its caches warm, so the wall clock is the build plus the slowest shard. In CI, two Playwright workers per runner, traces on a retry only, and the service worker blocked in every spec but `worker.spec.js` (`playwright.config.js`) |
| `pages.yml` | pushes to `main`, and nightly: the same four test shards, a fifth runner that builds the artefact beside them, then deploy `dist/` to GitHub Pages once all five are green and the `lint` job with them — a red test never publishes |
| `lint` (in both) | one runner beside the shards: `npm run lint`, `npm run typecheck`, `npm run test:unit` - no build, no browser |
| `upstream.yml` | weekly: build and test against upstream `HEAD` without moving the pins, and open or extend an issue when that fails, so a bump stays a two-line commit |

## Every spec starts with the first steps closed

A fresh browser profile is a first visit, and a first visit on the default
sample gets the first-steps strip over the editor's last lines
([panel.md](panel.md)) - which no test but one is about. So
`playwright.config.js` gives every test a `use.storageState` with
`abap2ui5-playground:first-steps=closed` for the test server's origin (in the
config rather than `tests/helpers.mjs`, because most specs open the page with
`page.goto( )`). `tests/onboarding.spec.js` empties it again
(`test.use({ storageState: … })`); a context a test makes for itself with
`browser.newContext( )` starts empty and sees the strip.

## What the newer specs hold

- `onboarding.spec.js` - the first-steps strip (when it shows and when not,
  its four buttons, closing for good) and the lesson bar.
- `original.spec.js` - Compare with the original (the diff dialog) and Reset
  to it, one Ctrl+Z away.
- `ui5-floor.spec.js` - the bar's UI5 select and the lint tab kept in step,
  stored, and the check run again.
- `layout-editor.spec.js` - Open in Layout Editor's two hand-overs (`?src=`
  for an unchanged GitHub class, clipboard + `#playground=` otherwise).
- `tables.spec.js` - a table of the reader's own, created afresh at every Run.
- `state.spec.js` - the State tab, attributes per roundtrip with the changes
  marked.
- `isolation.spec.js` - the AI pages' app frame on an opaque origin, reaching
  neither page, location, storage nor `caches`; a forged message ignored; the
  playground's frame offered no page object; the runtime worker, and an app's
  `WRITE '@KERNEL'`, finding no cache, database or nested worker.
- `worker.spec.js` also plants a forged `shell.mjs` and chunk in the cache:
  not run, the cache restored.

## The second layer: `tests/node/`

Playwright used to be the only test layer. The pure modules - the builder
chain read, written and patched, share links, the zip, gists, deep links,
the matcher, the parser hint, the sample markers, the tables, Format's rules
- are now held by `node:test` as well (`npm run test:unit`, over
`tests/node/*.test.mjs`): no build and no browser, seconds rather than
minutes. `tests/node/dom.mjs` gives them a DOM over `@xmldom/xmldom` where
they need one, and the chain tests run on a fixture copied from
abap2UI5/samples (`z2ui5_cl_smp_app_494`, `tests/node/fixtures/`).
`playwright.config.js` ignores `node/**`, so neither runner picks up the
other's files. CI runs them in the `lint` job with `npm run lint` and
`npm run typecheck`, beside the shards.

`PORT` moves the test server and the tests' `baseURL` together
(`playwright.config.js`), so two checkouts can test at once:
`PORT=8091 npm test`.

