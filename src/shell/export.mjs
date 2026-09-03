// The open files as an abapGit package - what somebody takes to a system.
//
// A playground draft used to end at the clipboard: copy the class out of the
// editor, paste it into the ABAP editor over there, hope nothing in between
// mangled it. abapGit's offline import takes a zip of a repository instead,
// and the playground already names its files the way abapGit does and holds
// the metadata sidecar abaplint needs for each of them (files.mjs) - the
// same sidecar abapGit reads. So the zip is the files, the sidecars, and the
// one file at the root that tells abapGit where to look.
//
// Three things are normalised on the way out, all of them things that made
// an import or a later diff noisy: line endings become LF, trailing
// whitespace goes, and every file ends in a newline - see the abap-check
// notes in the framework repository, where each of those has cost somebody
// an afternoon.
import { parseName, sidecarFor } from "../editor/files.mjs";
import { zipStored } from "./zip.mjs";

// The repository settings, as abapGit writes them for a fresh repository:
// English, sources under /src/, prefix folder logic - the layout every
// abap2UI5 repository uses.
const ABAPGIT_XML = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_ABAPGIT" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DATA>
    <MASTER_LANGUAGE>E</MASTER_LANGUAGE>
    <STARTING_FOLDER>/src/</STARTING_FOLDER>
    <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>
    <IGNORE>
     <item>/.gitignore</item>
     <item>/LICENSE</item>
     <item>/README.md</item>
     <item>/package.json</item>
     <item>/.travis.yml</item>
     <item>/.gitlab-ci.yml</item>
     <item>/abaplint.json</item>
     <item>/azure-pipelines.yml</item>
    </IGNORE>
   </DATA>
  </asx:values>
 </asx:abap>
</abapGit>
`;

export const normalisedSource = (source) =>
  source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n*$/, "\n");

// The entries the zip holds, for the files given - the sidecar of a file
// follows the file, and a file the playground could not name (which
// checkFileSet keeps out of the editor in the first place) is skipped
// rather than exported under a name abapGit would refuse.
export function abapGitEntries(files) {
  const entries = [{ name: ".abapgit.xml", data: ABAPGIT_XML }];
  for (const file of files) {
    const sidecar = sidecarFor(file.name);
    if (!sidecar) continue;
    entries.push({ name: `src/${file.name}`, data: normalisedSource(file.source) });
    entries.push({ name: `src/${sidecar.name}`, data: sidecar.source + "\n" });
  }
  return entries;
}

// The zip, named after the app - the class in the first file.
export function abapGitZip(files) {
  const app = parseName(files[0]?.name)?.object.toLowerCase() ?? "playground";
  return { name: `${app}.zip`, bytes: zipStored(abapGitEntries(files)) };
}

// Hands the browser a file to save. An anchor with a download attribute and
// a blob URL, clicked - the one way a page can start a download without a
// server, and the URL is given back the moment the click has been handled.
export function download(name, bytes, type = "application/zip") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
