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
