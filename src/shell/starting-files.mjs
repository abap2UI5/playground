// What the editor opens on: a link somebody was sent, the draft they were
// last working on, or the sample. Read once, by boot( ) in main.mjs, while
// the corpus parses - see "What a visitor waits for" in
// docs/design/load-time.md for why that await must not hold anything else
// up.
import { checkFileSet, MAIN_FILE } from "../editor/files.mjs";
import { DEFAULT_FILES, DEFAULT_SAMPLE } from "../editor/samples.mjs";
import { fetchLinkedFiles, followNavigation, linkedSources, REPOSITORY_HOSTS, setOrigin } from "./deep-link.mjs";
import { fetchGist, gistIdFrom } from "./gist.mjs";
import { confirmLinkedCode } from "./linked-code.mjs";
import { aiPage, embedded, params, pilotPage } from "./page.mjs";
import { readSession } from "./persistence.mjs";
import { filesFromLocation } from "./share.mjs";
import { AI_FILE, AI_STARTER } from "./ai-starter.mjs";

// The answers of startingFiles( ) that are somebody else's code - from here
// on a run of them makes the page no place for a secret (linked-code.mjs).
const FROM_A_LINK = new Set(["a shared link", "a link", "a gist"]);
export const fromALink = (from) => FROM_A_LINK.has(from);

// The one answer that is the reader's own work rather than something opened.
export const FROM_LAST_SESSION = "your last session";

// Where each file of a sample the page carries lives in abap2UI5/samples,
// for the bar's Source link: the index names the first file's page, and the
// files of one sample sit beside each other there.
export function rememberSampleOrigins(sample, files) {
  const at = sample?.github?.lastIndexOf("/") ?? -1;
  if (at < 0) return;
  for (const f of files) setOrigin(f.name, `${sample.github.slice(0, at + 1)}${f.name}`);
}

// Where the editor starts, in order of how deliberate the choice was: a link is
// what somebody was sent, a stored draft is what they were last working on, and
// the sample is the fallback. An embedded playground never restores a draft -
// it shows what the page that embedded it asked for.
//
// Answers { files, from, openFile } - and beside them what boot( ) says once
// the page is far enough along to have somewhere to say it: `failure`, when a
// ?src= link could not be followed or the code in a shared link could not be
// read, and `declined`, when the Pilot's reader said no to a link's code.
export async function startingFiles() {
  if (aiPage) return { files: [{ name: AI_FILE, source: AI_STARTER }], from: "a minimal class" };
  let failure;
  let declined = false;
  const sample = () => {
    rememberSampleOrigins(DEFAULT_SAMPLE, DEFAULT_FILES);
    return { files: DEFAULT_FILES, from: "sample", failure, declined };
  };
  // On the Pilot's page a link's code runs beside the API key the reader
  // types (src/shell/linked-code.mjs): opened only once they said so, and
  // the sample otherwise - said in the status line, like a link that failed.
  const trusted = async (what) => {
    if (!pilotPage) return true;
    if (await confirmLinkedCode(what)) return true;
    declined = true;
    return false;
  };
  try {
    const shared = await filesFromLocation(MAIN_FILE);
    if (shared) {
      const files = checkFileSet(shared);
      if (await trusted(`A shared link with ${files.length === 1 ? files[0].name : `${files.length} files, ${files[0].name} first`}.`)) {
        return { files, from: "a shared link" };
      }
      return sample();
    }
  } catch (e) {
    // A fragment that will not decode is somebody else's link or a truncated
    // paste. Opening on the sample beats an error page nobody can act on -
    // and saying so beats opening on the sample as if that were the link:
    // the Share dialog promises the sender that a torn link "says so".
    failure = new Error(
      `The code in this link could not be read - a pasted link may have been cut short. ${e?.message || e}`,
    );
  }

  // ?src=<url> - what a documentation page links when it wants to show one of
  // its examples running. Failing here is worth saying out loud: somebody
  // followed a link expecting particular code and did not get it.
  if (linkedSources(params).length > 0) {
    try {
      if (!(await trusted(`A link to ${linkedSources(params).join(", ")}.`))) return sample();
      // No gist on the Pilot's page: a gist is anybody's (REPOSITORY_HOSTS).
      const linked = checkFileSet(await fetchLinkedFiles(params, pilotPage ? { hosts: REPOSITORY_HOSTS } : {}));
      // An app that calls another app is only half an app on its own. The
      // classes it instantiates are looked for next to it and opened too, so a
      // link to a sample that navigates somewhere actually navigates.
      const alongside = await followNavigation(linked);
      return { files: checkFileSet([...linked, ...alongside]), from: "a link" };
    } catch (e) {
      failure = e;
    }
  }
  // ?gist=<id> - a gist the Share dialog wrote (src/shell/gist.mjs), read
  // from api.github.com without a token. Beside ?src= and below it: a link
  // that carries both is a documentation link first. Never on the Pilot's
  // page, where a link's code runs beside the reader's key and a gist is
  // anybody's (REPOSITORY_HOSTS).
  if (params.has("gist") && linkedSources(params).length === 0) {
    const id = gistIdFrom(params.get("gist"));
    try {
      if (pilotPage) throw new Error("The AI Agent opens no gist - open it in the playground instead.");
      if (!id) throw new Error(`${params.get("gist")} is not a gist id.`);
      const files = checkFileSet(await fetchGist(id));
      for (const f of files) setOrigin(f.name, `https://gist.github.com/${id}`);
      return { files, from: "a gist" };
    } catch (e) {
      failure = e;
    }
  }
  if (!embedded && !pilotPage) {
    try {
      // A draft that will not parse, or a storage that will not answer, is a
      // draft that is gone - readStoredJson says so with undefined. What is
      // still worth catching here is checkFileSet( ) refusing what it read.
      const stored = readSession();
      if (stored) {
        return { files: checkFileSet(stored.files), openFile: stored.openFile, from: FROM_LAST_SESSION, failure };
      }
    } catch {
      // A stored draft the editor cannot hold - a name that stopped being
      // valid, a first file that is not a class. Opening on the sample beats
      // refusing to start.
    }
  }
  return sample();
}
