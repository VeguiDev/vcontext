import type { Database } from "better-sqlite3";

export function migrateRegistry(db: Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS project (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_path (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('local', 'remote')),
      path TEXT NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, type, path),
      FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      project_b_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(project_id, project_b_id),
      FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
      FOREIGN KEY (project_b_id) REFERENCES project(id) ON DELETE CASCADE
    );
  `);

  addColumnIfMissing(db, "project", "uuid", "TEXT");
}

export function migrateProject(db: Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_prompt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS change_note (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note TEXT NOT NULL,
      document_id INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES document(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS task (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      document_id INTEGER,
      status TEXT NOT NULL CHECK(status IN ('BACKLOG', 'RUNNING', 'COMPLETED', 'CANCELLED')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES document(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS file_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'file' CHECK(kind IN ('file', 'directory', 'path')),
      filename TEXT,
      path TEXT NOT NULL UNIQUE,
      hash TEXT,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  addColumnIfMissing(db, "task", "description", "TEXT");
  addColumnIfMissing(db, "file_context", "kind", "TEXT NOT NULL DEFAULT 'file'");
}

function addColumnIfMissing(db: Database, table: string, column: string, type: string) {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;

  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
