// Node's `crypto`, as far as the browser can honestly provide it.
//
// open-abap's cl_system_uuid asks for `crypto` and falls back to
// window.crypto.randomUUID when the module has no randomUUID of its own - but
// only when the property is absent, and a stub that throws on call still has
// the property. Every abap2UI5 roundtrip mints a draft id through it, so this
// is on the hot path, not an edge case.
//
// Randomness the browser has natively. Hashing it has only asynchronously
// (WebCrypto's digest is a promise, Node's createHash is not), so a hash is
// computed here, in JavaScript: SHA-256, which is what abap2UI5 asks for.
// From 1.147.0 on every roundtrip hashes the model the browser holds
// (z2ui5_cl_ui5_util_context=>hash_string through cl_abap_message_digest,
// whose kernel line is `crypto.createHash(node).update(data, "hex").digest("hex")`),
// and a stub that threw here killed the roundtrip as a JS error the framework's
// CATCH never saw: "Network error: crypto.createHash is not available" on
// every app, found by the pin bump to 1.147.0 (bump-sources, 2026-10-14).
// Any other algorithm, and createHmac, still say so instead of pretending.
const unavailable = (name) => () => {
  throw new Error(
    `crypto.${name} is not available in the playground: the browser's crypto API is asynchronous ` +
      `and Node's is not, so there is nothing to map it onto.`,
  );
};

// randomUUID exists only in a secure context (https, or localhost); served
// over plain http - a phone on the LAN, an http mirror - every roundtrip failed
// with "randomUUID is not a function". getRandomValues exists everywhere, and a
// version 4 UUID is sixteen random bytes with two fields set.
export function randomUUID() {
  if (typeof globalThis.crypto.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function randomBytes(size) {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}

// --- SHA-256, synchronous, FIPS 180-4 ----------------------------------------
// Straight from the specification: the 64 round constants, the message padded
// to a multiple of 64 bytes with its bit length at the end, 64 rounds per
// block over eight 32-bit words. Node's `crypto.createHash("sha256")` gives the
// same bytes; `tests/crypto-shim.spec.js` holds the two together.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(bytes) {
  const length = bytes.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  // the bit length, big-endian, in the last eight bytes (two 32-bit halves)
  const bits = length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  new DataView(out.buffer).setUint32(0, h[0]);
  for (let i = 1; i < 8; i++) new DataView(out.buffer).setUint32(i * 4, h[i]);
  return out;
}

// What `update( )` takes, as Node reads it: a Buffer or typed array as it is,
// a string by its encoding - "hex" (open-abap's digest hands its xstring over
// this way), "base64", else UTF-8.
function toBytes(data, encoding) {
  if (data instanceof Uint8Array) return data;
  if (typeof data !== "string")
    throw new TypeError(
      "crypto.createHash: update( ) takes a string or a byte array",
    );
  if (encoding === "hex") {
    if (data.length % 2 || /[^0-9a-fA-F]/.test(data))
      throw new TypeError("crypto.createHash: not a hex string");
    const bytes = new Uint8Array(data.length / 2);
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = parseInt(data.substr(i * 2, 2), 16);
    return bytes;
  }
  if (encoding === "base64")
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new TextEncoder().encode(data);
}

const ALGORITHMS = { sha256: sha256, "sha-256": sha256 };

/** Node's `createHash(algorithm)`: `update(data[, encoding])` chains, `digest([encoding])`
 *  answers hex, base64 or the bytes. SHA-256 only; another algorithm says so. */
export function createHash(algorithm) {
  const fn = ALGORITHMS[String(algorithm).toLowerCase()];
  if (!fn) {
    throw new Error(
      `crypto.createHash("${algorithm}") is not available in the playground: only sha256 is computed here ` +
        `(the browser's own digest is asynchronous, so the hash is JavaScript of the playground's)`,
    );
  }
  const parts = [];
  let done = false;
  const hash = {
    update(data, encoding) {
      if (done) throw new Error("crypto.createHash: update( ) after digest( )");
      parts.push(toBytes(data, encoding));
      return hash;
    },
    digest(encoding) {
      if (done) throw new Error("crypto.createHash: digest( ) called twice");
      done = true;
      const total = parts.reduce((n, p) => n + p.length, 0);
      const all = new Uint8Array(total);
      let at = 0;
      for (const p of parts) {
        all.set(p, at);
        at += p.length;
      }
      const out = fn(all);
      if (encoding === "hex")
        return [...out].map((x) => x.toString(16).padStart(2, "0")).join("");
      if (encoding === "base64") return btoa(String.fromCharCode(...out));
      return Buffer.from(out);
    },
  };
  return hash;
}

export const createHmac = unavailable("createHmac");

export default { randomUUID, randomBytes, createHash, createHmac };
