import { Database as BunDatabase } from "bun:sqlite";
import type BetterSqlite3 from "better-sqlite3";

export type Database = BetterSqlite3.Database;

/** Bun's SQLite implementation adapted to the better-sqlite3 surface we use. */
const Database = BunDatabase as any;
if (!Database.prototype.pragma) {
  Database.prototype.pragma = function pragma(source: string) {
    return this.query(`PRAGMA ${source}`).all();
  };
}

if (!Database.prototype.backup) {
  Database.prototype.backup = async function backup(destination: string) {
    const escaped = destination.replace(/'/g, "''");
    this.exec(`VACUUM INTO '${escaped}'`);
  };
}

if (!Object.getOwnPropertyDescriptor(Database.prototype, "inTransaction")) {
  Object.defineProperty(Database.prototype, "inTransaction", {
    get() {
      return true;
    },
  });
}

export default Database;
