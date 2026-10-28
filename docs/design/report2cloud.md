# Classic reports: report2cloud in the playground

A classic report in the editor (`zreport.prog.abap`, with its text pool
`zreport.prog.xml` beside it) runs. The Run converts it with report2cloud of
[abap-cloud-gui](https://github.com/abap2UI5-addons/abap-cloud-gui) into a
class of that addon's report runtime (`INHERITING FROM z2ui5_cl_cgui_report`)
and starts that class as the app. The report stays the file that is edited.
The class is never shown and never stored. The migration report the converter
writes goes to the Log, under "report2cloud".

## What is fetched, and when

Nothing of the addon is on the way of a page that never opens a report. Step 6
of the build (`tools/build-report2cloud.mjs`, [build-pipeline.md](build-pipeline.md))
writes three files under `dist/report2cloud/`, each fetched the first time a
report is converted:

| File | Who reads it | What it is |
| --- | --- | --- |
| `convert.mjs` | the registry worker | the converter (`tools/report2cloud/lib` of the pin), bundled from `src/editor/report2cloud-entry.mjs` |
| `library.json` | the registry worker | the ABAP of the report runtime (`src/01` of the pin, no test includes) |
| `runtime.json` | the page (`src/shell/report2cloud.mjs`) | the same classes, transpiled at build time into chunks |

- **The converter borrows the worker's abaplint.** The bundle has no copy of
  `@abaplint/core`. Its imports resolve to bindings of
  `globalThis.__pgAbaplint`, which the worker sets before the import
  (`lentAbaplint()` in `registry-core.mjs`). A second copy would weigh two
  megabytes. Worse, an abaplint node made by one copy is not an instance of
  the other copy's classes.
- **The library joins the corpus once**, as dependencies (`addLibrary()`).
  After that, a converted class checks against the classes it inherits from
  and calls.
- **The runtime is transpiled once, at build time**, with
  `transpileObjects()`. A Run compiles the editor's files with that same
  function, so the chunks are exactly like the user's. They are defined
  before the user's on every Run of a converted report. The report runtime
  is twenty thousand lines, so a Run does not transpile it again.

## A Run of a report

1. `structuralProblem()` accepts a report as the first file and refuses one
   anywhere else.
2. `convertedSet()` sends the report and its text pool to the worker
   (`convertReport`).
3. If the converter refuses a construct, the Run stops there. Each refusal is
   an underlined problem in the report, on the same path as a transpiler
   error (`error.problems`).
4. Otherwise, the Run compiles the class files in place of the report and the
   text pool, followed by the other files. It starts the class.

A report can come from a link as well: `?src=` takes `.prog.abap` and
`.prog.xml`. In the AI Studio, the model can write both files too.

## Limits

- **One report, first.** A report is the app, never a helper of one, so it
  is refused anywhere but first.
- **The pin decides what converts.** The converter and the runtime both come
  from the same commit of abap-cloud-gui, and a converted class runs only
  against the runtime of that commit. They are never mixed with another
  version. A bump is the sha in `tools/fetch-deps.mjs`, like every pin, and
  the build checks that the addon still transpiles against the framework pin.
- **The converted class is not editable here.** A change belongs in the
  report. Taking the class out to a system is the converter's own CLI.
