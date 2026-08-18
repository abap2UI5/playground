// What "the code" is, now that it can be more than one class.
//
// A playground holds a small set of ABAP source files, exactly as abapGit names
// them: `zcl_playground.clas.abap`, `zif_thing.intf.abap`. The name is not
// decoration - abaplint derives the object's name and type from it, and the
// class inside has to agree with it, which is what a real system enforces too.
//
// One file is special, and it is the first one: the playground starts the class
// it declares. That is the whole rule - it needs no fixed name, so a class
// linked in from somewhere else runs under the name it already has. The first
// file cannot be closed, because closing it would silently change what runs.

// What the first file is called in a playground that starts empty.
export const MAIN_FILE = "zcl_playground.clas.abap";

const NAME_PATTERN = /^([a-z][a-z0-9_]*)\.(clas|intf)\.abap$/;

export function parseName(fileName) {
  const match = NAME_PATTERN.exec(fileName);
  if (!match) return undefined;
  return { object: match[1].toUpperCase(), kind: match[2] };
}

// Why a name is not usable, in a sentence somebody can act on, or undefined
// when it is fine.
export function nameProblem(fileName, existing = []) {
  if (!NAME_PATTERN.test(fileName)) {
    return (
      `A file is named like it is in abapGit: a lower-case object name, then ` +
      `.clas.abap for a class or .intf.abap for an interface. For example ` +
      `zcl_detail.clas.abap.`
    );
  }
  if (existing.includes(fileName)) return `There is already a file called ${fileName}.`;
  return undefined;
}

// The abapGit metadata sidecar. abaplint reads the object's name out of it, and
// for a class also whether it may have class-local types; without one the file
// is not an object at all and nothing in it resolves.
export function sidecarFor(fileName) {
  const parsed = parseName(fileName);
  if (!parsed) return undefined;
  const xmlName = fileName.replace(/\.abap$/, ".xml");

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
    <DESCRIPT>playground</DESCRIPT>
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
    <DESCRIPT>playground</DESCRIPT>
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
export function skeletonFor(fileName) {
  const { object, kind } = parseName(fileName);
  const name = object.toLowerCase();

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
