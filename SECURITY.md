# Security policy

## Reporting a vulnerability

Please use the GitHub Security Advisory
["Report a Vulnerability"](https://github.com/abap2UI5/playground/security/advisories/new)
tab. Do not open a public issue for a security report.

Expect an acknowledgement within a few days. This project is developed
alongside other work, so a fix is agreed rather than promised by a date — the
advisory is where that conversation happens.

## Supported versions

Only what is **currently deployed** at
[abap2ui5.github.io/playground](https://abap2ui5.github.io/playground/) is
supported. There are no released versions to patch: `main` is the site, and a
fix is deployed by merging it.

## What this site is, from a security point of view

- **There is no server.** The ABAP in the editor is transpiled to JavaScript
  and run **in the visitor's own browser**, against a bundled OpenUI5. No
  backend, no SAP system, no account, and nothing a visitor types is sent
  anywhere. The site is static files on GitHub Pages.
- **The code you write is yours and stays local.** A share link carries every
  open file in the **URL fragment** (deflate-raw, `src/shell/share.mjs`), and a
  fragment is never sent to a server by the browser. Anyone you hand the link
  to can read it, which is the point of sharing — treat a share link as public.
- **`?src=` has a host allow list, deliberately short.** The playground fetches
  on behalf of whoever opened the link, so an unrestricted parameter would make
  it a small proxy for reading arbitrary URLs into a page on this origin. It
  accepts same-origin URLs and `https://raw.githubusercontent.com` or
  `https://gist.githubusercontent.com`, and refuses everything else by name
  (`src/shell/deep-link.mjs`). Widening that list is a security decision, not a
  convenience one — a report that the check can be bypassed is very welcome.
- **The app runs in a frame on the same origin.** It is not sandboxed away from
  the shell: the two exchange `postMessage` for height and embedding. Code a
  visitor pastes in therefore runs with the privileges of the page, which is
  their own code in their own browser — but it is the reason the `?src=` allow
  list matters, since that is the one path by which *somebody else's* code
  arrives.
- **A service worker caches the heavy assets** (`src/shell/sw.js`), which makes
  it a same-origin request interceptor with storage that outlives the tab — so
  it is deliberately as small as that job allows. It answers only `GET`, only
  for its own origin and its own directory, and only for an allow list of the
  site's own build outputs: the shell bundle, the framework, the corpus,
  SQLite, the editor font and the UI5 build. Anything carrying a query string
  is refused outright, and so is everything the playground fetches on somebody
  else's behalf — linked ABAP, the sample catalogues, the app frame's own
  document. It never rewrites a response, and it caches only a clean `200`.
  Each cache is named after the build that filled it and the previous one is
  deleted when a new worker takes over, so nothing survives a deploy.
- **Every dependency is pinned exactly**, including the transpiler, abaplint
  and the linter, because all three end up inside the bundle a visitor
  downloads.

## Out of scope

- What the checkers *report* about your ABAP — that is the product, not a
  vulnerability. Open an issue; rule questions belong in
  [abap2UI5/linter](https://github.com/abap2UI5/linter/issues).
- Anything a visitor does to their own browser tab with code they wrote
  themselves.
