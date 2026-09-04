// Named drafts: the work of more than one sitting.
//
// The playground keeps one draft on its own - whatever was last in the
// editor, restored on the next visit (see remember( ) in main.mjs). One is
// enough for "carry on where I was" and not for "the three things I was
// trying last week": picking a sample, or opening a link, quietly replaces
// it, and the previous draft is one Undo away and then gone. Share links are
// the way out of the browser; this is the way across days inside it - a
// list of file sets under names of the reader's choosing, in the samples
// browser, where everything that can be opened is listed.
//
// Kept in localStorage through storage.mjs, like everything else that is.
// Never in an embedded playground, which has no samples button either.
import { readStoredJson, writeStoredJson } from "./storage.mjs";

const KEY = "abap2ui5-playground:drafts";
const LIMIT = 50;

// The list as stored, checked on the way in: a stored value in any other
// shape is treated as no drafts rather than trusted.
export function listDrafts() {
  const stored = readStoredJson(KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (d) =>
      typeof d?.name === "string" &&
      Array.isArray(d.files) &&
      d.files.every((f) => typeof f?.name === "string" && typeof f?.source === "string"),
  );
}

// Why a name cannot be used, or undefined when it can.
export function draftNameProblem(name) {
  const trimmed = (name ?? "").trim();
  if (trimmed === "") return "Give the draft a name.";
  if (trimmed.length > 60) return "A shorter name, please - sixty characters is plenty.";
  return undefined;
}

// Saves the files under the name, replacing a draft of that name. Newest
// first, and bounded: fifty drafts is a folder, not a list.
export function saveDraft(name, files) {
  const trimmed = name.trim();
  const rest = listDrafts().filter((d) => d.name !== trimmed);
  const draft = { name: trimmed, at: Date.now(), files: files.map(({ name, source }) => ({ name, source })) };
  return writeStoredJson(KEY, [draft, ...rest].slice(0, LIMIT));
}

export function deleteDraft(name) {
  return writeStoredJson(
    KEY,
    listDrafts().filter((d) => d.name !== name),
  );
}
