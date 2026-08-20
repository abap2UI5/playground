// Putting the code in the URL, so a playground can be linked.
//
// The source travels in the fragment rather than the query, which keeps it out
// of server logs and referers - it never leaves the browser. It is deflated
// first, because ABAP compresses extremely well (a sample goes from about 2500
// characters to under 700) and because a URL that fits in a chat message gets
// used.
//
// The format is one character of version, then base64url. Version 1 carried a
// single ABAP source; version 2 carries a JSON array of files, because the
// playground can hold more than one. Old links still decode - a version byte
// costs one character and saves every link ever shared.
const VERSION = "2";

const toBase64Url = (bytes) => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const fromBase64Url = (text) => {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

async function through(stream, bytes) {
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

export async function encodeFiles(files) {
  const payload = JSON.stringify(files.map(({ name, source }) => ({ name, source })));
  const deflated = await through(new CompressionStream("deflate-raw"), new TextEncoder().encode(payload));
  return VERSION + toBase64Url(deflated);
}

export async function decodeFiles(fragment, mainFile) {
  const version = fragment?.[0];
  if (version !== "1" && version !== "2") {
    throw new Error("This link was not written by this playground.");
  }
  const inflated = await through(new DecompressionStream("deflate-raw"), fromBase64Url(fragment.slice(1)));
  const text = new TextDecoder().decode(inflated);

  if (version === "1") return [{ name: mainFile, source: text }];

  const files = JSON.parse(text);
  if (!Array.isArray(files) || files.length === 0 || files.some((f) => typeof f?.source !== "string")) {
    throw new Error("This link does not carry any ABAP.");
  }
  return files;
}

// The shared link for what is open: this page, with the code behind #.
export async function shareUrl(files) {
  const url = new URL(window.location.href);
  url.hash = await encodeFiles(files);
  return url.href;
}

// The same code in a page that is only the app - no editor and no bar - which
// is what the full screen button opens in a new tab. The query is rebuilt
// rather than carried over: a tab of its own is not an embedded playground, and
// a ?src= kept from this page would send the new tab fetching files the
// fragment already holds - the ones in the editor now, edits and all.
export async function appUrl(files) {
  const url = new URL(window.location.href);
  url.search = "?view=full";
  url.hash = await encodeFiles(files);
  return url.href;
}

// The files a link carries, or undefined when the page was opened plainly.
// A fragment that will not decode is not an error worth stopping for - the
// playground opens on its sample and says so.
export async function filesFromLocation(mainFile) {
  const fragment = window.location.hash.replace(/^#/, "");
  if (fragment === "") return undefined;
  return decodeFiles(fragment, mainFile);
}

export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}
