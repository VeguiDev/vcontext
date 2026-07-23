import { Database as BunDatabase } from "bun:sqlite";

/** The small better-sqlite3-compatible surface used by the daemon. */
const Database = BunDatabase as any;

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