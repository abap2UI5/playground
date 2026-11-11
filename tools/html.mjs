// The one thing done to every document this build writes on its way out.
//
// The sources are written in the house style, with the reasoning for every
// decision beside it - and in an HTML file that reasoning is a comment, which
// travels to the reader as bytes: 9.8 kB of the playground's 37 kB document,
// a third of its compressed weight, and four kilobytes of the catalogue's.
// Nobody reads a comment in a served page. So it is stripped here, after every
// marker the build substitutes has been substituted, and the source keeps
// every word. Outside <script> only: a script's text is what its hash is
// taken from over in the documentation, and a "<!--" inside JavaScript is
// legal JavaScript that is not this build's to rewrite.
export function stripHtmlComments(html) {
  return html
    .split(/(<script\b[\s\S]*?<\/script>)/)
    .map((part, i) => (i % 2 ? part : part.replace(/<!--[\s\S]*?-->/g, "")))
    .join("");
}

/* ---- WHAT A PAGE MAY LOAD ----------------------------------------------
 *
 * The catalogue and the per-sample pages are static documents that load
 * their own modules, their own stylesheets and their own font, and nothing
 * from anywhere else - so they say so, in a Content-Security-Policy, the way
 * the manual next door has since its own audit. GitHub Pages sets no
 * headers of ours, so it is a <meta>; a meta policy cannot carry
 * frame-ancestors and these pages do not need it.
 *
 * The inline scripts - the theme line, the menu behind the bar's last
 * button, the 404's suggestions - are allowed by hash, taken from the very
 * text this writes, so a script that changes changes its hash with it and
 * nothing can drift. The JSON-LD blocks are data, not scripts, and the
 * policy does not apply to them. Styles stay 'unsafe-inline': the
 * highlighter writes a class per token but UI5's own frames and the embed's
 * styles are inline. Images may come from anywhere over https - a sample's
 * facts can carry a screenshot from the demo kit - and everything else is
 * this origin: the search index at /docs/, the embed's playground frame,
 * apps.json.
 *
 * The playground's own three documents (the workbench, ai/, pilot/) carry a
 * policy of their own - playgroundPolicy( ) below. */
import { createHash } from "node:crypto";

export function inlineScriptsIn(html) {
  const out = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] || "";
    if (/\bsrc=/.test(attrs)) continue;
    if (/type="application\/ld\+json"/.test(attrs)) continue;
    out.push(m[2]);
  }
  return out;
}

export const hashOf = (script) => `'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`;

export function contentSecurityPolicy(inlineScripts) {
  return [
    "default-src 'self'",
    ["script-src", "'self'", ...inlineScripts.map(hashOf)].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    /* The search index is fetched by its published, absolute address
       (src/shell/search-box.mjs) - the same origin on the site, another one
       on a dev server or under the tests, where these pages sit on
       localhost and the index is answered by a route. Named, so the box
       works wherever the page is opened. */
    "connect-src 'self' https://abap2ui5.github.io",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** The finished document with its policy in the head - called on what is
 *  WRITTEN, after the comments are stripped, so the hashes are of the text
 *  a browser will read. */
export function withPolicy(html) {
  const at = html.indexOf('<meta charset="utf-8">');
  if (at < 0) throw new Error("withPolicy: no <meta charset> to put the policy after");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(inlineScriptsIn(html))}">`;
  const cut = at + '<meta charset="utf-8">'.length;
  return `${html.slice(0, cut)}\n${meta}${html.slice(cut)}`;
}

/* ---- THE PLAYGROUND'S OWN DOCUMENTS ------------------------------------
 *
 * The workbench (index.html) and the two AI pages are the same document
 * (tools/site-documents.mjs). What they run that the catalogue pages do not:
 *
 *  - two module workers (the registry, the ABAP runtime) from this origin.
 *    The runtime evaluates each transpiled chunk with `new Function` and
 *    instantiates SQLite's wasm - inside the worker, which a document's
 *    <meta> policy does not reach: a worker loaded from a URL takes its
 *    policy from its own response, and GitHub Pages sends none. So no
 *    'unsafe-eval' and no 'wasm-unsafe-eval' here; `tests/csp.spec.js`
 *    listens for a violation through boot, Run, the debugger and the AI pages.
 *  - the app in a frame of this origin, whose document (dist/app/index.html)
 *    is a document of its own and is not under this policy either.
 *  - Monaco, which writes styles inline; so does UI5 in the frame and the
 *    page itself (heights, the splitter): style-src keeps 'unsafe-inline'.
 *  - fetches: this origin; raw.githubusercontent.com and
 *    gist.githubusercontent.com (?src=, deep-link.mjs' allow list, and the
 *    AI's read_sample); api.github.com (?gist=, writing a gist).
 *  - the AI pages, and only they, talk to a model: api.anthropic.com, or any
 *    OpenAI-compatible server the reader types - https anywhere, or plain
 *    http to a local one (llm-provider.mjs). There is no list to narrow that
 *    to, so connect-src is wide there and nowhere else.
 *
 * Inline scripts by hash, as above; `<base href="../">` on the AI pages is
 * this origin. */
export function playgroundPolicy(inlineScripts, { models = false } = {}) {
  const connect = models
    ? ["'self'", "https:", "http:"]
    : ["'self'", "https://raw.githubusercontent.com", "https://gist.githubusercontent.com", "https://api.github.com"];
  return [
    "default-src 'self'",
    ["script-src", "'self'", ...inlineScripts.map(hashOf)].join(" "),
    "style-src 'self' 'unsafe-inline'",
    // Attachments are previewed from blob: and data: URLs on the AI pages.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    ["connect-src", ...connect].join(" "),
    "worker-src 'self'",
    "frame-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** A playground document with its policy, right after <meta charset>. */
export function withPlaygroundPolicy(html, options) {
  const at = html.indexOf('<meta charset="utf-8">');
  if (at < 0) throw new Error("withPlaygroundPolicy: no <meta charset> to put the policy after");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${playgroundPolicy(inlineScriptsIn(html), options)}">`;
  const cut = at + '<meta charset="utf-8">'.length;
  return `${html.slice(0, cut)}\n${meta}${html.slice(cut)}`;
}
