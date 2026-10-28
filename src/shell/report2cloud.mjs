// @ts-check
// report2cloud on Run: the first file is a classic report (zreport.prog.abap,
// with its text pool zreport.prog.xml beside it when there is one), and the
// Run converts it first - in the registry worker, by the converter of
// abap-cloud-gui (src/editor/registry-worker.mjs, convertReport) - into a
// class of abap-cloud-gui's report runtime. The class is what is compiled and
// started; the report stays in the editor as the reader wrote it, and the
// migration report says in the Log what was mapped and what is left.
//
// The class inherits from the report runtime, which is in no bundle a page
// downloads: it comes as chunks transpiled at build time
// (dist/report2cloud/runtime.json, tools/build-report2cloud.mjs), fetched on
// the first conversion and handed to the runtime before the class's own on
// every Run - defineClasses( ) puts back what a Run defined, so they are
// defined again each time, like the user's.
//
// What the converter cannot map is refused at its line: the Run stops there,
// and the lines are underlined and listed under Problems the way the
// transpiler's refusals are - in the AI Studio they are the model's work list.
import { convertReport } from "../editor/registry.mjs";
import { isReportFile } from "../editor/files.mjs";

export const isReportSet = (files) => files.length > 0 && isReportFile(files[0].name);

/** @type {Promise<{ commit: string, chunks: { name: string, js: string }[] }> | undefined} */
let runtime;
function loadRuntime() {
  if (!runtime) {
    runtime = fetch(new URL("report2cloud/runtime.json", document.baseURI)).then((response) => {
      if (!response.ok) throw new Error(`report2cloud/runtime.json: ${response.status}`);
      return response.json();
    });
    runtime.catch(() => {
      runtime = undefined;
    });
  }
  return runtime;
}

// The set a Run compiles in place of the report: the class the converter
// wrote first (the app), its local types and implementations beside it, then
// the reader's other files but the text pool - and the report runtime's
// chunks, to be defined before the class's. Throws, with the refused lines as
// problems, when the converter refused a statement.
export async function convertedSet(files) {
  const [report, ...rest] = files;
  const poolName = report.name.replace(/\.abap$/, ".xml");
  const pool = rest.find((f) => f.name === poolName);
  const [result, lib] = await Promise.all([
    convertReport({ name: report.name, source: report.source, textpool: pool?.source }),
    loadRuntime(),
  ]);
  if (!result.ok) {
    const error = /** @type {Error & { problems?: unknown }} */ (
      new Error(
        `report2cloud refused ${result.refusals.length} statement${result.refusals.length > 1 ? "s" : ""} of ${report.name} - ` +
          `rewrite them in the report and run again:\n${result.refusals.map((r) => `${r.message} (line ${r.line})`).join("\n")}`,
      )
    );
    error.problems = result.refusals.map((r) => ({ file: report.name, line: r.line, message: `report2cloud: ${r.message}` }));
    throw error;
  }
  const main = `${result.className}.clas.abap`;
  // The class's XML is the playground's to write (sidecarFor in files.mjs),
  // as for every class in the editor.
  const own = Object.entries(result.files)
    .filter(([name]) => !name.endsWith(".xml"))
    .map(([name, source]) => ({ name, source }))
    .sort((a, b) => (a.name === main ? -1 : b.name === main ? 1 : a.name.localeCompare(b.name)));
  return {
    files: [...own, ...rest.filter((f) => f !== pool)],
    library: lib.chunks,
    report: result.report,
  };
}
