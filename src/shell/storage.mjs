// localStorage, for a browser that may not have one.
//
// Everything the playground stores is a convenience - a dragged height, a
// split, the draft you were last working on, yesterday's catalogue. None of it
// is worth a broken page, and in three ordinary situations reaching for it
// throws rather than returning nothing:
//
//   - Safari and Firefox with third-party storage blocked, which is the
//     embedded playground's normal case: a demo in somebody's documentation
//     page is third-party storage by definition;
//   - a browser in a mode that refuses site data outright;
//   - a full quota, where the read still works and only the write throws.
//
// The throw is what made this worth a module. setUpSplitter( ) reads the
// stored split in boot( ), before the try/catch that reports a startup
// failure - so a SecurityError there left the page on "starting…" with every
// control disabled and nothing said, which is the worst shape a failure can
// take. Wrapping the calls turns all of it into "no preference stored".
//
// Both directions answer rather than throw: read gives null, write gives false
// for the caller that wants to know. Nothing in the playground currently does,
// which is the point.
export function readStored(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
    return true;
  } catch {
    // A quota that is full or a storage that is refused. The preference is not
    // kept and the page carries on with what it has.
    return false;
  }
}

export function removeStored(key) {
  try {
    globalThis.localStorage?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// The two JSON helpers, because every caller here stores JSON and every one of
// them was writing the same try/catch around the parse. A value that will not
// parse is a value that is gone.
export function readStoredJson(key) {
  const raw = readStored(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function writeStoredJson(key, value) {
  try {
    return writeStored(key, JSON.stringify(value));
  } catch {
    // A value with a cycle in it, which is a bug rather than a full disk - but
    // still not worth taking the page down for.
    return false;
  }
}
