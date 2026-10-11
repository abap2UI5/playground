// Where a catalogued sample's ABAP is, from the facts the index carries.
//
// An entry of samples/apps.json names its class's FILE - the path inside its
// repository - and, where that is not `main`, the BRANCH it is delivered on;
// the repository itself is in the index's `sources`, one block per
// repository. The two URLs every reader wants - the raw file, which is what
// `?src=` opens and the Pilot fetches, and the GitHub page, which is what a
// row links to - are one template each over those three facts, and they are
// written here rather than into the index: 804 entries carried both in full,
// 135 KB of an 816 KB file that is nothing but the same two prefixes repeated.
//
// The shape rule is the build's (tools/build-catalogue.mjs, which refuses an
// entry whose path or branch does not pass it) and is checked again here,
// because the index of an earlier deploy can come out of the service
// worker's cache - and so can one from before the two URLs left it, whose
// `raw` and `github` are taken as they are.
const FILE = /^[\w./-]+\.clas\.abap$/;
const BRANCH = /^[\w.-]+$/;

export const isSampleFile = (file) => typeof file === "string" && FILE.test(file) && !file.startsWith("/") && !file.includes("..");
export const isBranch = (branch) => typeof branch === "string" && BRANCH.test(branch) && !/^\.+$/.test(branch);

function located(entry, sources) {
  const repo = (sources || []).find((s) => s.id === entry.source)?.repo;
  if (typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return undefined;
  if (!isSampleFile(entry.file)) return undefined;
  const branch = entry.branch ?? "main";
  if (!isBranch(branch)) return undefined;
  return { repo, branch, file: entry.file };
}

/** The raw file, or undefined where the entry does not say where it is. */
export function rawUrlOf(entry, sources) {
  const at = located(entry, sources);
  if (at) return `https://raw.githubusercontent.com/${at.repo}/${at.branch}/${at.file}`;
  return typeof entry.raw === "string" && /^https:\/\/raw\.githubusercontent\.com\//.test(entry.raw) ? entry.raw : undefined;
}

/** The file's page on GitHub, or undefined. */
export function githubUrlOf(entry, sources) {
  const at = located(entry, sources);
  if (at) return `https://github.com/${at.repo}/blob/${at.branch}/${at.file}`;
  return typeof entry.github === "string" && /^https:\/\/github\.com\//.test(entry.github) ? entry.github : undefined;
}
