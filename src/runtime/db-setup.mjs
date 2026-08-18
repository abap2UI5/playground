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

// Kept from the first setup so the database can be rebuilt from scratch later
// without re-running the transpiled init. `schemas` carries one DDL dialect per
// supported database; `insert` is the seed data (the client row in T000, the
// TADIR entries the framework's own reflection reads).
let schemas;
let insert;

async function fresh() {
  const db = new BrowserSQLiteClient();
  // Assigned before connect(): the client reports itself as the SY-DBSYS of the
  // default connection, and only recognizes itself once it is that connection.
  globalThis.abap.context.databaseConnections["DEFAULT"] = db;
  await db.connect();
  await db.execute(schemas.sqlite);
  await db.execute(insert);
  return db;
}

export async function setup(abap, generatedSchemas, generatedInsert) {
  schemas = generatedSchemas;
  insert = generatedInsert;
  globalThis.abap = abap;

  // The runtime defaults to a console that writes to process.stdout, which does
  // not exist here - the first ABAP WRITE would be a ReferenceError. The
  // in-memory one collects the output instead, where the playground can show it.
  abap.console = new MemoryConsole();

  await fresh();
}

// Drop every table and rebuild it empty. The playground calls this before each
// run so a new app never sees the drafts of the previous one - a stale draft id
// in the frontend would otherwise resume an app the editor no longer describes.
export async function resetDatabase() {
  if (schemas === undefined) {
    throw new Error("resetDatabase called before setup");
  }
  const previous = globalThis.abap.context.databaseConnections["DEFAULT"];
  await fresh();
  try {
    await previous?.disconnect();
  } catch {
    // The old handle is unreachable either way; a failure to close it must not
    // take down the run that just got a working one.
  }
}
