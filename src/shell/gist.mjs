// The open files as a GitHub gist, and a gist as the open files.
//
// A share link carries the code in its fragment and a zip takes it to a
// system; a gist is the third way out - a URL with a history, that GitHub
// hosts, that a colleague opens on github.com and that this page opens
// again with ?gist=<id>. It is written with the reader's own token
// (POST https://api.github.com/gists, which answers a browser: GitHub's API
// allows CORS with a bearer token) and read without one - a public or
// secret gist's files are in GET /gists/<id> for anybody with the id.
//
// The token is the reader's, typed into the Share dialog and held in
// memory while the page is open - never stored, for the reason the AI
// chats never store a key (chat.mjs): a link's ABAP runs in this origin and
// can read what this origin stores. A fine-grained token with the gist
// scope and nothing else is all it needs.
//
// What goes into a gist is the ABAP: the .clas.abap, .intf.abap and
// .clas.testclasses.abap files as they are in the editor, the app first.
// GitHub lists a gist's files alphabetically and this page starts the class
// in the FIRST file, so the import does not trust the order it gets: the
// file whose class implements z2ui5_if_app goes first, else the first class.
export const GIST_API = "https://api.github.com/gists";

// The files a gist may bring into the editor - the same three kinds a
// ?src= link may name (deep-link.mjs).
const ABAP_FILE = /\.(clas|intf)\.abap$|\.clas\.testclasses\.abap$/i;

/** The gist id in whatever the reader pasted: a bare id, a gist.github.com
 *  URL (with or without the user), an api.github.com/gists URL, or a
 *  gist.githubusercontent.com raw URL. Undefined when there is none. */
export function gistIdFrom(text) {
  const value = String(text ?? "").trim();
  if (value === "") return undefined;
  if (/^[0-9a-f]{6,64}$/i.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "gist.github.com") {
    const id = parts.length >= 2 ? parts[1] : parts[0];
    return /^[0-9a-f]{6,64}$/i.test(id ?? "") ? id : undefined;
  }
  if (url.hostname === "api.github.com" && parts[0] === "gists") return /^[0-9a-f]{6,64}$/i.test(parts[1] ?? "") ? parts[1] : undefined;
  if (url.hostname === "gist.githubusercontent.com") return /^[0-9a-f]{6,64}$/i.test(parts[1] ?? "") ? parts[1] : undefined;
  return undefined;
}

/** This page, opening that gist. */
export function playgroundUrlFor(id, base = globalThis.location?.href ?? "https://abap2ui5.github.io/playground/") {
  const url = new URL(base);
  url.search = `?gist=${encodeURIComponent(id)}`;
  url.hash = "";
  return url.href;
}

/** The request body for POST /gists: the ABAP files by name, the
 *  description naming the app and the share link, secret unless asked. */
export function gistPayload(files, { description, shareUrl, isPublic = false } = {}) {
  const abap = files.filter((f) => ABAP_FILE.test(f.name));
  if (abap.length === 0) throw new Error("There is no ABAP file to put in a gist.");
  const out = {};
  for (const f of abap) {
    // GitHub refuses an empty file; a class with nothing in it is still a file here.
    out[f.name.toLowerCase()] = { content: f.source === "" ? "\n" : f.source };
  }
  const cls = abap[0].name.replace(/\.clas\.abap$/i, "").toUpperCase();
  const said = description?.trim() || `abap2UI5 playground - ${cls}`;
  return {
    description: shareUrl ? `${said} - ${shareUrl}` : said,
    public: Boolean(isPublic),
    files: out,
  };
}

/** The files of GET /gists/<id>'s answer, the app first; throws when there is
 *  no ABAP in it. A file GitHub truncated (over a megabyte) is refused rather
 *  than opened half. */
export function filesFromGist(gist) {
  const entries = Object.values(gist?.files ?? {}).filter((f) => f && ABAP_FILE.test(f.filename ?? ""));
  if (entries.length === 0) throw new Error("This gist carries no ABAP object file (.clas.abap, .intf.abap, .clas.testclasses.abap).");
  const truncated = entries.find((f) => f.truncated);
  if (truncated) throw new Error(`${truncated.filename} in this gist is larger than the API hands out in one piece.`);
  const files = entries
    .filter((f) => typeof f.content === "string")
    .map((f) => ({ name: f.filename.toLowerCase(), source: f.content }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // The app first: the class implementing z2ui5_if_app, else the first class.
  const isClass = (f) => /\.clas\.abap$/.test(f.name);
  const app = files.find((f) => isClass(f) && /INTERFACES\s+z2ui5_if_app\b/i.test(f.source)) ?? files.find(isClass);
  if (!app) throw new Error("This gist has no class to start - the first file of a playground is the app.");
  return [app, ...files.filter((f) => f !== app)];
}

const explain = async (response, verb) => {
  let detail = "";
  try {
    const json = await response.json();
    detail = json?.message ? `: ${json.message}` : "";
  } catch {
    // No body worth reading.
  }
  if (response.status === 401) return new Error(`GitHub did not accept the token${detail}`);
  if (response.status === 403) return new Error(`GitHub refused to ${verb} the gist - the token may lack the gist scope, or the rate limit is reached${detail}`);
  if (response.status === 404) return new Error(`GitHub has no such gist${detail}`);
  if (response.status === 422) return new Error(`GitHub refused the gist's contents${detail}`);
  return new Error(`GitHub answered ${response.status}${detail}`);
};

const HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };

/** Reads a gist: [{ name, source }], the app first. */
export async function fetchGist(id, { fetch: doFetch = globalThis.fetch, signal = AbortSignal.timeout(20000) } = {}) {
  if (!/^[0-9a-f]{6,64}$/i.test(id ?? "")) throw new Error(`${id} is not a gist id.`);
  let response;
  try {
    response = await doFetch(`${GIST_API}/${id}`, { headers: HEADERS, signal });
  } catch (e) {
    if (e?.name === "TimeoutError") throw new Error("api.github.com did not answer within 20 seconds.");
    throw new Error("api.github.com could not be reached - check the connection, or whether a proxy or extension blocks it.");
  }
  if (!response.ok) throw await explain(response, "read");
  return filesFromGist(await response.json());
}

/** Writes a gist with the reader's token; answers { id, url, playgroundUrl }. */
export async function createGist(files, { token, description, shareUrl, isPublic = false, fetch: doFetch = globalThis.fetch } = {}) {
  if (!token?.trim()) throw new Error("A GitHub token is needed to create a gist.");
  const body = gistPayload(files, { description, shareUrl, isPublic });
  let response;
  try {
    response = await doFetch(GIST_API, {
      method: "POST",
      headers: { ...HEADERS, authorization: `Bearer ${token.trim()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("api.github.com could not be reached - check the connection, or whether a proxy or extension blocks it.");
  }
  if (!response.ok) throw await explain(response, "create");
  const gist = await response.json();
  return { id: gist.id, url: gist.html_url, playgroundUrl: playgroundUrlFor(gist.id) };
}
