// Node's `crypto`, as far as the browser can honestly provide it.
//
// open-abap's cl_system_uuid asks for `crypto` and falls back to
// window.crypto.randomUUID when the module has no randomUUID of its own - but
// only when the property is absent, and a stub that throws on call still has
// the property. Every abap2UI5 roundtrip mints a draft id through it, so this
// is on the hot path, not an edge case.
//
// Randomness the browser has natively. Hashing it does not, at least not
// synchronously: WebCrypto's digest is a promise and Node's createHash is not,
// so there is no honest way to bridge them. Nothing in abap2UI5 calls it (only
// cl_abap_message_digest and cl_abap_hmac do, and neither is reachable from the
// framework), so it says so instead of pretending.
const unavailable = (name) => () => {
  throw new Error(
    `crypto.${name} is not available in the playground: the browser's crypto API is asynchronous ` +
      `and Node's is not, so there is nothing to map it onto.`,
  );
};

export function randomUUID() {
  return globalThis.crypto.randomUUID();
}

export function randomBytes(size) {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}

export const createHash = unavailable("createHash");
export const createHmac = unavailable("createHmac");

export default { randomUUID, randomBytes, createHash, createHmac };
