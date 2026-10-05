// The one way a free-text search matches a row, for the two lists that offer
// one: the samples browser on the playground (src/shell/examples.mjs) and the
// sample catalogue page (src/catalogue/catalogue.mjs). Every word has to be
// somewhere in the row's haystack, in any order: "table select" finds the
// selection-modes sample whichever way round it was typed, which one string
// compared whole would not.
//
// The two used to disagree. The browser matched every word; the catalogue -
// the page a search is LINKED from, the one whose answer is worth keeping -
// matched the query as one substring, so "table edit" and "sap.m wizard" found
// rows in the dialog and "Nothing matches that" on the page. One helper, both
// callers, so the same words give the same answer on both.
//
// The bar's search box is a different question ("where is X in this project",
// ranked, with typo relaxation - src/shell/search-engine.mjs) and stays its own.

/** Lower-cased without changing the length: "İ" (a Turkish keyboard's capital
 *  I) lower-cases to two code units and "İNPUT" matched nothing at all; the
 *  dotless "ı" is folded with it, so all four spellings find the same rows.
 *  Haystacks go through the same function as queries. */
export const foldCase = (text) => String(text ?? "").replace(/\u0130/g, "I").toLowerCase().replace(/\u0131/g, "i");

/** The words of a query, lower-cased; an empty query is no words at all. */
export const termsOf = (query) => foldCase(String(query ?? "").trim()).split(/\s+/).filter(Boolean);

/** Whether every term is somewhere in the (already lower-cased) haystack. */
export const matchesTerms = (haystack, terms) => terms.every((t) => haystack.includes(t));
