/*
 * The bar's search box, as the file the sample catalogue and all 772
 * per-sample pages load.
 *
 * It is its own bundle rather than part of catalogue.mjs for one reason: the
 * per-sample pages have no bundle of their own - they are HTML written by
 * tools/sample-pages.mjs, with their behaviour inlined - and this box is far
 * too big to inline 772 times. One module beside them, fetched once and cached
 * for every page the reader opens afterwards, is the same file the catalogue
 * itself loads.
 *
 * The playground has no search box any more (its page is one row, the
 * brand, the tool's name and the workbench), so this is the module's only
 * way onto a page.
 */
import { setUpSearch } from "../shell/search-box.mjs";

setUpSearch();
