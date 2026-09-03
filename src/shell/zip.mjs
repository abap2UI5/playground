// A zip file, written by hand.
//
// The one thing the playground downloads is an abapGit package: a handful of
// small text files, which is the case a zip library is least needed for. The
// format is a local header per entry, a central directory that repeats the
// headers, and one record saying where the directory is - all little-endian,
// all documented in PKWARE's APPNOTE, and forty lines is what it costs to
// write without pulling in a dependency the page would then carry for
// everybody who never presses Download.
//
// Entries are stored, not deflated: ABAP compresses well, but the zip goes
// straight into abapGit's import dialog, and a file of a few kilobytes is not
// worth a second code path. Every name is treated as UTF-8 (the flag bit says
// so), and the timestamp is the moment of writing, in DOS format, which is
// what the container offers.

const encoder = new TextEncoder();

// CRC-32 as the zip format specifies it - the same polynomial as gzip and
// PNG, table-driven, over the stored bytes.
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// A date as the two 16-bit words the format keeps it in.
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// `entries` is a list of { name, data }, data a string or a Uint8Array.
// Returns the zip as bytes.
export function zipStored(entries, now = new Date()) {
  const { time, day } = dosTime(now);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed: 2.0
    local.setUint16(6, 0x0800, true); // flags: names are UTF-8
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // no extra field

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true); // central directory header
    record.setUint16(4, 20, true); // version made by
    record.setUint16(6, 20, true); // version needed
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, 0, true);
    record.setUint16(12, time, true);
    record.setUint16(14, day, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, data.length, true);
    record.setUint32(24, data.length, true);
    record.setUint16(28, name.length, true);
    record.setUint16(30, 0, true); // extra
    record.setUint16(32, 0, true); // comment
    record.setUint16(34, 0, true); // disk
    record.setUint16(36, 0, true); // internal attributes
    record.setUint32(38, 0, true); // external attributes
    record.setUint32(42, offset, true);

    locals.push(new Uint8Array(local.buffer), name, data);
    central.push(new Uint8Array(record.buffer), name);
    offset += 30 + name.length + data.length;
  }

  const directorySize = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  const parts = [...locals, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
