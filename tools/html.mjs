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
 * NOT the playground's own document. That one runs module workers, WebAssembly
 * and Monaco's blob workers and hosts UI5 in a frame; its policy is a
 * different piece of work. */
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
