// The database the transpiled framework talks to.
//
// abap2UI5 keeps its per-roundtrip state ("drafts") in database tables, so it
// needs a database even on a page that has no backend. @abaplint/database-sqlite
// provides one on top of sql.js - SQLite compiled to WebAssembly - which is
// exactly as real as the one abap2UI5's own CI runs against under Node. It
// lives in memory and dies with the tab.
//
// This module is wired into the generated build/output/init.mjs through the
// transpiler's `setup` option, so it runs before any ABAP does.
import { SQLiteDatabaseClient } from "@abaplint/database-sqlite";
import { MemoryConsole } from "@abaplint/runtime";
import initSqlJs from "sql.js";

// SQLiteDatabaseClient calls initSqlJs() with no arguments, which leaves sql.js
// to guess where its .wasm file is - and emscripten's guess is wrong as soon as
// the page is not at the site root (GitHub Pages serves projects under
// /<repo>/). Resolving against import.meta.url is right at every depth and on
// every host, so the client is subclassed for that one line.
const WASM_URL = new URL("./sql-wasm.wasm", import.meta.url).href;

class BrowserSQLiteClient extends SQLiteDatabaseClient {
  async connect(data) {
    const SQL = await initSqlJs({ locateFile: () => WASM_URL });
    this.sqlite = new SQL.Database(data);
    const connections = globalThis.abap?.context?.databaseConnections;
    if (connections && connections["DEFAULT"] === this) {
      globalThis.abap.builtin.sy.get().dbsys?.set(this.name);
    }
  }
}

// The empty database, as bytes. Taken once, right after the transpiled init has
// created the schema and seeded it (the client row in T000, the TADIR entries
// the framework's own reflection reads), and every reset after that starts
// from this image rather than from the DDL.
//
// Rebuilding from the DDL is what a reset used to do, and it is what makes a
// Run slow where it shows: twenty-seven CREATE TABLEs and seven hundred
// INSERTs, one prepared statement each, about 85 ms per press of Run on a
// desk and several times that on a phone. Opening SQLite on a 140 KB image is
// a copy of the bytes into its file system - under a millisecond - and the
// result is byte-for-byte the database the DDL would have produced, because
// that is where the image came from. sql.js copies the array on open, so the
// image is never written to and serves every reset for the life of the page.
let image;

// Opens a connection and makes it the framework's default one. Assigned before
// connect(): the client reports itself as the SY-DBSYS of the default
// connection, and only recognizes itself once it is that connection.
async function open(data) {
  const db = new BrowserSQLiteClient();
  globalThis.abap.context.databaseConnections["DEFAULT"] = db;
  await db.connect(data);
  return db;
}

export async function setup(abap, schemas, insert) {
  globalThis.abap = abap;

  // The runtime defaults to a console that writes to process.stdout, which does
  // not exist here - the first ABAP WRITE would be a ReferenceError. The
  // in-memory one collects the output instead, where the playground can show it.
  abap.console = new MemoryConsole();

  const db = await open();
  await db.execute(schemas.sqlite);
  await db.execute(insert);
  // export( ) closes and reopens the file underneath, which invalidates
  // prepared statements - there are none yet, nothing has run.
  image = db.export();
}

// Drop everything and start from the empty database again. The playground
// calls this before each run so a new app never sees the drafts of the
// previous one - a stale draft id in the frontend would otherwise resume an
// app the editor no longer describes.
export async function resetDatabase() {
  if (image === undefined) {
    throw new Error("resetDatabase called before setup");
  }
  const previous = globalThis.abap.context.databaseConnections["DEFAULT"];
  await open(image);
  try {
    await previous?.disconnect();
  } catch {
    // The old handle is unreachable either way; a failure to close it must not
    // take down the run that just got a working one.
  }
}
