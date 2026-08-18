// Putting the code in the URL, so a playground can be linked.
//
// The source travels in the fragment rather than the query, which keeps it out
// of server logs and referers - it never leaves the browser. It is deflated
// first, because ABAP compresses extremely well (a sample goes from about 2500
// characters to under 700) and because a URL that fits in a chat message gets
// used.
//
// The format is one character of version, then base64url. If a future change
// needs a different encoding, an old link still says which one it was written
// with, instead of decoding to noise.
const VERSION = "1";

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

export async function encodeSource(source) {
  const bytes = new TextEncoder().encode(source);
  const deflated = await through(new CompressionStream("deflate-raw"), bytes);
  return VERSION + toBase64Url(deflated);
}

export async function decodeSource(fragment) {
  if (!fragment?.startsWith(VERSION)) {
    throw new Error("This link was not written by this playground.");
  }
  const inflated = await through(new DecompressionStream("deflate-raw"), fromBase64Url(fragment.slice(1)));
  return new TextDecoder().decode(inflated);
}

// The shared link for the current source: this page, with the code behind #.
export async function shareUrl(source) {
  const url = new URL(window.location.href);
  url.hash = await encodeSource(source);
  return url.href;
}

// The source a link carries, or undefined when the page was opened plainly.
// A fragment that will not decode is not an error worth stopping for - the
// playground opens on its sample and says so.
export async function sourceFromLocation() {
  const fragment = window.location.hash.replace(/^#/, "");
  if (fragment === "") return undefined;
  return decodeSource(fragment);
}

export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}
