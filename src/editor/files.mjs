// @ts-check
// What "the code" is, now that it can be more than one class.
//
// A playground holds a small set of ABAP source files, exactly as abapGit names
// them: `zcl_playground.clas.abap`, `zif_thing.intf.abap`, and beside a class
// its test include, `zcl_playground.clas.testclasses.abap`. The name is not
// decoration - abaplint derives the object's name and type from it, and the
// class inside has to agree with it, which is what a real system enforces too.
//
// One file is special, and it is the first one: the playground starts the class
// it declares. That is the whole rule - it needs no fixed name, so a class
// linked in from somewhere else runs under the name it already has. The first
// file cannot be closed, because closing it would silently change what runs.
//
// Beside the ABAP, a database table: its definition, `ztab.tabl.xml`, and the
// rows it starts with, `ztab.tabu.json` - see tables.mjs, which says why
// those two names.
import { tableXml } from "./tables.mjs";

// What the first file is called in a playground that starts empty.
export const MAIN_FILE = "zcl_playground.clas.abap";

const NAME_PATTERN = /^([a-z][a-z0-9_]*)\.(clas|intf)\.abap$/;
// The test include of a class: the local test classes abapGit keeps in a
// file of their own beside the class, and ABAP Unit runs.
const TEST_PATTERN = /^([a-z][a-z0-9_]*)\.clas\.testclasses\.abap$/;
// A table's definition, and the rows it starts with - which are a second file
// of the table the way a test include is a second file of its class.
const TABLE_PATTERN = /^([a-z][a-z0-9_]*)\.tabl\.xml$/;
const SEED_PATTERN = /^([a-z][a-z0-9_]*)\.tabu\.json$/;

export function parseName(fileName) {
  const test = TEST_PATTERN.exec(fileName);
  if (test) return { object: test[1].toUpperCase(), kind: "clas", include: "testclasses" };
  const table = TABLE_PATTERN.exec(fileName);
  if (table) return { object: table[1].toUpperCase(), kind: "tabl" };
  const seed = SEED_PATTERN.exec(fileName);
  if (seed) return { object: seed[1].toUpperCase(), kind: "tabl", include: "tabu" };
  const match = NAME_PATTERN.exec(fileName);
  if (!match) return undefined;
  return { object: match[1].toUpperCase(), kind: match[2] };
}

// Whether a file is ABAP source - what the checkers and the outline read -
// rather than one of a table's two files.
export const isAbapFile = (fileName) => /\.abap$/.test(String(fileName));

// The class file a test include belongs to.
export const classFileOf = (fileName) => fileName.replace(/\.clas\.testclasses\.abap$/, ".clas.abap");

// The file a second file belongs to - a test include's class, a seed file's
// table - or undefined for a file that belongs to nothing.
export function ownerFileOf(fileName) {
  if (TEST_PATTERN.test(fileName)) return classFileOf(fileName);
  if (SEED_PATTERN.test(fileName)) return fileName.replace(/\.tabu\.json$/, ".tabl.xml");
  return undefined;
}

// The files that go when this one is closed: the second files that belong to it.
export function dependentsOf(fileName) {
  if (NAME_PATTERN.test(fileName) && fileName.endsWith(".clas.abap")) {
    return [fileName.replace(/\.clas\.abap$/, ".clas.testclasses.abap")];
  }
  if (TABLE_PATTERN.test(fileName)) return [fileName.replace(/\.tabl\.xml$/, ".tabu.json")];
  return [];
}

// Why a name is not usable, in a sentence somebody can act on, or undefined
// when it is fine. `existing` is what is open already; `all` the whole set a
// file is joining, which is what a test include is checked against - its
// class may come later in a link or a stored draft, and still be there.
export function nameProblem(fileName, existing = [], all = existing) {
  const parsed = parseName(fileName);
  if (!parsed) {
    return (
      `A file is named like it is in abapGit: a lower-case object name, then ` +
      `.clas.abap for a class or .intf.abap for an interface - or ` +
      `.clas.testclasses.abap for a class's unit tests, .tabl.xml for a ` +
      `database table and .tabu.json for its rows. For example ` +
      `zcl_detail.clas.abap.`
    );
  }
  if (existing.includes(fileName)) return `There is already a file called ${fileName}.`;
  const owner = ownerFileOf(fileName);
  if (owner && !all.includes(owner)) {
    return parsed.include === "tabu"
      ? `${fileName} holds the rows of ${owner}, which is not open - add the table first.`
      : `${fileName} holds the tests of ${owner}, which is not open - add the class first.`;
  }
  return undefined;
}

// The abapGit metadata sidecar. abaplint reads the object's name out of it, and
// for a class also whether it may have class-local types; without one the file
// is not an object at all and nothing in it resolves.
export function sidecarFor(fileName) {
  const parsed = parseName(fileName);
  // A test include is a second file of its class, which has the sidecar; a
  // table's definition IS its XML, and its rows are no object of their own.
  if (!parsed || parsed.include || parsed.kind === "tabl") return undefined;
  const xmlName = fileName.replace(/\.abap$/, ".xml");
  // Named after the object: one constant description on every sidecar failed
  // abaplint's identical_descriptions (on in app-template's config) as soon
  // as an export carried a second class or an interface.
  const descript = `playground ${parsed.object.toLowerCase()}`;

  if (parsed.kind === "intf") {
    return {
      name: xmlName,
      source: `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_INTF" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <VSEOINTERF>
    <CLSNAME>${parsed.object}</CLSNAME>
    <LANGU>E</LANGU>
    <DESCRIPT>${descript}</DESCRIPT>
    <EXPOSURE>2</EXPOSURE>
    <STATE>1</STATE>
    <UNICODE>X</UNICODE>
   </VSEOINTERF>
  </asx:values>
 </asx:abap>
</abapGit>`,
    };
  }

  return {
    name: xmlName,
    source: `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <VSEOCLASS>
    <CLSNAME>${parsed.object}</CLSNAME>
    <LANGU>E</LANGU>
    <DESCRIPT>${descript}</DESCRIPT>
    <STATE>1</STATE>
    <CLSCCINCL>X</CLSCCINCL>
    <FIXPT>X</FIXPT>
    <UNICODE>X</UNICODE>
   </VSEOCLASS>
  </asx:values>
 </asx:abap>
</abapGit>`,
  };
}

// A skeleton for a file that was just added, so it is a valid object from the
// moment it exists rather than a page of red underlines.
// The name has passed nameProblem( ) by then, so parseName( ) answers.
export function skeletonFor(fileName) {
  const { object, kind, include } = /** @type {NonNullable<ReturnType<typeof parseName>>} */ (parseName(fileName));
  const name = object.toLowerCase();

  if (kind === "tabl") return include === "tabu" ? "[\n]\n" : tableXml(name);

  if (include === "testclasses") {
    return (
      `CLASS ltcl_${name.replace(/^z?cl_/, "")} DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.\n\n` +
      `  PRIVATE SECTION.\n` +
      `    METHODS first FOR TESTING.\n\n` +
      `ENDCLASS.\n\n\n` +
      `CLASS ltcl_${name.replace(/^z?cl_/, "")} IMPLEMENTATION.\n\n` +
      `  METHOD first.\n\n` +
      `    cl_abap_unit_assert=>assert_equals( act = 1 exp = 1 ).\n\n` +
      `  ENDMETHOD.\n\n` +
      `ENDCLASS.\n`
    );
  }

  if (kind === "intf") {
    return `INTERFACE ${name} PUBLIC.\n\n\n\nENDINTERFACE.\n`;
  }
  return (
    `CLASS ${name} DEFINITION PUBLIC CREATE PUBLIC.\n\n` +
    `  PUBLIC SECTION.\n\n` +
    `  PROTECTED SECTION.\n  PRIVATE SECTION.\n\n` +
    `ENDCLASS.\n\n\n` +
    `CLASS ${name} IMPLEMENTATION.\n\n` +
    `ENDCLASS.\n`
  );
}

// The URI a file lives under in both abaplint and Monaco. They have to agree
// exactly: abaplint's language server looks a document up by its uri, and a
// mismatch returns no diagnostics at all, which looks like "no problems".
export const uriFor = (fileName) => `file:///${fileName}`;

// Files arriving from outside the editor - a shared link, a stored draft, a
// linked URL - reduced to a set the editor can actually hold, or rejected.
//
// This exists because the failure it prevents is invisible: a duplicate or
// malformed name makes Monaco throw while the page is still starting, and the
// page then sits at "starting…" with every control disabled and nothing said.
export function checkFileSet(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("There are no files in this.");
  }
  const seen = new Set();
  const all = files.map((f) => f?.name);
  for (const file of files) {
    if (typeof file?.name !== "string" || typeof file?.source !== "string") {
      throw new Error("A file is missing its name or its contents.");
    }
    const problem = nameProblem(file.name, [...seen], all);
    if (problem) throw new Error(problem);
    seen.add(file.name);
  }
  const first = parseName(files[0].name);
  if (first?.kind !== "clas" || first.include) {
    throw new Error(`The first file is the app, so it has to be a class - ${files[0].name} is not.`);
  }
  return files.map(({ name, source }) => ({ name, source }));
}
