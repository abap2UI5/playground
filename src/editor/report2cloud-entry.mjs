// The converter as the registry worker imports it (tools/build-report2cloud.mjs
// bundles this into dist/report2cloud/convert.mjs): report2cloud of the
// abap-cloud-gui pin, a classic report to a class of its report runtime, and
// the migration report that says what it did and what is left.
export { convert, defaultClassName } from "../../deps/abap-cloud-gui/tools/report2cloud/lib/convert.mjs";
export { migrationReport } from "../../deps/abap-cloud-gui/tools/report2cloud/lib/report.mjs";
export { parseTextpool } from "../../deps/abap-cloud-gui/tools/report2cloud/lib/textpool.mjs";
