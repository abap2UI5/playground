// The open files as an abapGit package - what somebody takes to a system.
//
// A playground draft used to end at the clipboard: copy the class out of the
// editor, paste it into the ABAP editor over there, hope nothing in between
// mangled it. abapGit's offline import takes a zip of a repository instead,
// and the playground already names its files the way abapGit does and holds
// the metadata sidecar abaplint needs for each of them (files.mjs) - the
// same sidecar abapGit reads.
//
// So the zip is a repository rather than a bag of files: the sources under
// `src/`, their sidecars, the `.abapgit.xml` that tells abapGit where to look,
// and a README saying what the thing is and where it came from. The last two
// are what make it something a reader can push to GitHub as it stands instead
// of a download they have to explain to themselves later - and the layout is
// the one abap2UI5/app-template uses, so an exported draft and a project
// started from the template are the same shape.
//
// Three things are normalised on the way out, all of them things that made
// an import or a later diff noisy: line endings become LF, trailing
// whitespace goes, and every file ends in a newline - see the abap-check
// notes in the framework repository, where each of those has cost somebody
// an afternoon.
import { parseName, sidecarFor } from "../editor/files.mjs";
import { zipStored } from "./zip.mjs";

// The repository settings, in the shape abap2UI5/app-template carries them:
// the repository's name, English, sources under /src/, prefix folder logic -
// the layout every abap2UI5 repository uses.
//
// No IGNORE list. abapGit only serialises what is under the starting folder,
// so the README at the root is outside its business already, and the list the
// older form of this file carried named eight files this zip has never held.
//
// The byte order mark is deliberate: it is what abapGit itself writes for
// this one file, so a repository exported here and one abapGit serialised
// have the same bytes at the top and a later pull is not a diff on line 1.
const abapgitXml = (name) => `\uFEFF<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
 <asx:values>
  <DATA>
   <NAME>${name}</NAME>
   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>
   <STARTING_FOLDER>/src/</STARTING_FOLDER>
   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>
  </DATA>
 </asx:values>
</asx:abap>
`;

export const normalisedSource = (source) =>
  source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n*$/, "\n");

// The name of the thing being exported: the app, which is the class in the
// first file - the same rule the playground uses everywhere else for "which of
// these files is the app". It names the zip, the repository in `.abapgit.xml`
// and the README's heading, so all three agree.
const appNameOf = (files) => parseName(files[0]?.name)?.object.toLowerCase() ?? "playground";

// What the reader finds when they open the zip a week later: what this is,
// what each file is, how to get it running, and - when the export came with a
// share link - where it came from, which is the one question a folder of ABAP
// on a disk cannot answer for itself.
//
// Deliberately without a date. It would be the most obvious thing to put in
// and it would make two exports of the same code two different files, which
// costs a diff every time somebody re-exports and buys nothing the link does
// not already say.
function readme(files, url) {
  const app = appNameOf(files).toUpperCase();
  const lines = [
    `# ${app}`,
    "",
    "An [abap2UI5](https://github.com/abap2UI5/abap2UI5) app, exported from the",
    "[abap2UI5 playground](https://abap2ui5.github.io/playground/).",
    "",
    "abap2UI5 apps are ABAP and nothing else: a class implements `Z2UI5_IF_APP`",
    "and builds its UI5 view in ABAP. There is no UI5 project, no OData service",
    "and no frontend build - the framework renders the view and carries every",
    "roundtrip back into the class.",
    "",
    "## What is in here",
    "",
  ];
  for (const file of files) {
    const parsed = parseName(file.name);
    if (!parsed) continue;
    const what = parsed.include
      ? "unit tests"
      : parsed.kind === "intf"
        ? "interface"
        : file === files[0]
          ? "the app"
          : "class";
    lines.push(`- \`src/${file.name}\` - ${parsed.object}, ${what}`);
  }
  lines.push(
    "",
    "Each source has the `.xml` sidecar beside it that abapGit reads, and",
    "`.abapgit.xml` at the root says the sources live under `src/`.",
    "",
    "## Getting it running",
    "",
    "1. Install the [abap2UI5 framework](https://github.com/abap2UI5/abap2UI5)",
    "   in your system with [abapGit](https://abapgit.org/), and create the ICF",
    "   endpoint for its HTTP handler - the",
    "   [documentation](https://abap2ui5.github.io/docs/) walks through both.",
    "2. Import this repository: abapGit → **+ Online** if you have pushed it",
    "   somewhere, or **+ Offline** and this zip if you have not.",
    "3. Activate, then open `<your endpoint>?app_start=" + app + "`.",
    "",
  );
  if (url) {
    lines.push(
      "## Where it came from",
      "",
      "This code, exactly as it is here, runs in the browser at",
      "",
      `<${url}>`,
      "",
      "- change it there and export again, or press **Open in the playground**",
      "  from any documentation page that embeds it.",
      "",
    );
  }
  lines.push(
    "## Learn more",
    "",
    "- [Documentation](https://abap2ui5.github.io/docs/) - the rendered docs site",
    "- [app-template](https://github.com/abap2UI5/app-template) - a starter",
    "  repository with the abaplint and abap2UI5-linter gates already wired up,",
    "  which is the shape this export follows",
    "- [samples](https://github.com/abap2UI5/samples) - example apps by topic,",
    "  and [samples-controls](https://github.com/abap2UI5/samples-controls) -",
    "  the UI5 demo kit rebuilt in ABAP",
    "",
  );
  return lines.join("\n");
}

// The entries the zip holds, for the files given - the sidecar of a file
// follows the file, and a file the playground could not name (which
// checkFileSet keeps out of the editor in the first place) is skipped
// rather than exported under a name abapGit would refuse.
//
// `url` is the share link for exactly these files, when the caller has one -
// the Share dialog has just built it - and is what the README points back at.
export function abapGitEntries(files, url) {
  const entries = [
    { name: ".abapgit.xml", data: abapgitXml(appNameOf(files)) },
    { name: "README.md", data: readme(files, url) },
  ];
  for (const file of files) {
    const sidecar = sidecarFor(file.name);
    if (!sidecar) continue;
    entries.push({ name: `src/${file.name}`, data: normalisedSource(file.source) });
    entries.push({ name: `src/${sidecar.name}`, data: sidecar.source + "\n" });
  }
  return entries;
}

// The zip, named after the app - the class in the first file.
export function abapGitZip(files, url) {
  return { name: `${appNameOf(files)}.zip`, bytes: zipStored(abapGitEntries(files, url)) };
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
