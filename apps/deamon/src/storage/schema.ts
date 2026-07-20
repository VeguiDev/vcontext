import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";

const ENTITY_TABLES = [
  "project_prompt",
  "document",
  "change_note",
  "task",
  "file_context",
] as const;

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

export function migrateVersionedProjectSchema(db: Database) {
  const existing = ENTITY_TABLES.find((table) => tableExists(db, table));

  if (existing && !columnExists(db, existing, "record_id")) {
    migrateLegacyProject(db);
  } else {
    createVersionedSchema(db);
    ensureInitialSnapshot(db);
  }
}

export function migrateLegacyProjectSchema(db: Database) {
  const existing = ENTITY_TABLES.find((table) => tableExists(db, table));
  if (existing && columnExists(db, existing, "record_id")) return;
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
  addColumnIfMissing(
    db,
    "file_context",
    "kind",
    "TEXT NOT NULL DEFAULT 'file'",
  );
}

function createVersionedSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshot (
      id TEXT PRIMARY KEY,
      message TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshot_parent (
      snapshot_id TEXT NOT NULL,
      parent_snapshot_id TEXT NOT NULL,
      parent_order INTEGER NOT NULL,
      PRIMARY KEY (snapshot_id, parent_snapshot_id),
      UNIQUE (snapshot_id, parent_order),
      FOREIGN KEY (snapshot_id) REFERENCES snapshot(id),
      FOREIGN KEY (parent_snapshot_id) REFERENCES snapshot(id)
    );
    CREATE TABLE IF NOT EXISTS branch (
      name TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES snapshot(id)
    );
    CREATE TABLE IF NOT EXISTS project_prompt (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      previous_revision_id TEXT,
      deleted_at INTEGER,
      prompt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES snapshot(id),
      FOREIGN KEY (previous_revision_id) REFERENCES project_prompt(id)
    );
    CREATE TABLE IF NOT EXISTS document (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      previous_revision_id TEXT,
      deleted_at INTEGER,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES snapshot(id),
      FOREIGN KEY (previous_revision_id) REFERENCES document(id)
    );
    CREATE TABLE IF NOT EXISTS change_note (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      previous_revision_id TEXT,
      deleted_at INTEGER,
      note TEXT NOT NULL,
      document_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES snapshot(id),
      FOREIGN KEY (previous_revision_id) REFERENCES change_note(id)
    );
    CREATE TABLE IF NOT EXISTS task (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      previous_revision_id TEXT,
      deleted_at INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      document_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('BACKLOG', 'RUNNING', 'COMPLETED', 'CANCELLED')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES snapshot(id),
      FOREIGN KEY (previous_revision_id) REFERENCES task(id)
    );
    CREATE TABLE IF NOT EXISTS file_context (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      previous_revision_id TEXT,
      deleted_at INTEGER,
      kind TEXT NOT NULL DEFAULT 'file' CHECK(kind IN ('file', 'directory', 'path')),
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES snapshot(id),
      FOREIGN KEY (previous_revision_id) REFERENCES file_context(id)
    );
    CREATE INDEX IF NOT EXISTS project_prompt_record_snapshot_idx ON project_prompt(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS document_record_snapshot_idx ON document(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS change_note_record_snapshot_idx ON change_note(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS task_record_snapshot_idx ON task(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS file_context_record_snapshot_idx ON file_context(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS snapshot_parent_parent_idx ON snapshot_parent(parent_snapshot_id);
  `);
}

function ensureInitialSnapshot(db: Database) {
  const snapshots = db
    .prepare("SELECT COUNT(*) AS count FROM snapshot")
    .get() as {
    count: number;
  };
  if (snapshots.count === 0) {
    const now = Date.now();
    const id = randomUUID();
    db.prepare(
      "INSERT INTO snapshot (id, message, created_at) VALUES (?, ?, ?)",
    ).run(id, "Initial snapshot", now);
    db.prepare(
      "INSERT INTO branch (name, snapshot_id, created_at, updated_at) VALUES ('main', ?, ?, ?)",
    ).run(id, now, now);
    return;
  }

  const branches = db.prepare("SELECT COUNT(*) AS count FROM branch").get() as {
    count: number;
  };
  if (branches.count === 0) {
    const snapshot = db
      .prepare(
        "SELECT id FROM snapshot ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .get() as { id: string };
    const now = Date.now();
    db.prepare(
      "INSERT INTO branch (name, snapshot_id, created_at, updated_at) VALUES ('main', ?, ?, ?)",
    ).run(snapshot.id, now, now);
  }
}

function migrateLegacyProject(db: Database) {
  for (const table of ENTITY_TABLES) {
    if (tableExists(db, table)) {
      db.exec(`ALTER TABLE ${table} RENAME TO ${table}_legacy_v1`);
    }
  }
  createVersionedSchema(db);

  const snapshotId = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO snapshot (id, message, created_at) VALUES (?, ?, ?)",
  ).run(snapshotId, "Migrate existing project data", now);

  const documentIds = migrateDocuments(db, snapshotId);
  migratePrompts(db, snapshotId);
  migrateFileContexts(db, snapshotId);
  migrateChanges(db, snapshotId, documentIds);
  migrateTasks(db, snapshotId, documentIds);

  db.prepare(
    "INSERT INTO branch (name, snapshot_id, created_at, updated_at) VALUES ('main', ?, ?, ?)",
  ).run(snapshotId, now, now);

  for (const table of [
    "task",
    "change_note",
    "file_context",
    "project_prompt",
    "document",
  ]) {
    const legacy = `${table}_legacy_v1`;
    if (tableExists(db, legacy)) db.exec(`DROP TABLE ${legacy}`);
  }
}

function migrateDocuments(db: Database, snapshotId: string) {
  const ids = new Map<number, string>();
  if (!tableExists(db, "document_legacy_v1")) return ids;
  const rows = db.prepare("SELECT * FROM document_legacy_v1").all() as Array<{
    id: number;
    title: string;
    content: string;
    created_at: number;
    updated_at: number;
  }>;
  const insert = db.prepare(`
    INSERT INTO document (
      id, record_id, snapshot_id, previous_revision_id, deleted_at,
      title, content, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    const recordId = randomUUID();
    ids.set(row.id, recordId);
    insert.run(
      randomUUID(),
      recordId,
      snapshotId,
      row.title,
      row.content,
      row.created_at,
      row.updated_at,
    );
  }
  return ids;
}

function migratePrompts(db: Database, snapshotId: string) {
  if (!tableExists(db, "project_prompt_legacy_v1")) return;
  const rows = db
    .prepare("SELECT * FROM project_prompt_legacy_v1")
    .all() as Array<{
    prompt: string;
    created_at: number;
    updated_at: number;
  }>;
  const insert = db.prepare(`
    INSERT INTO project_prompt (
      id, record_id, snapshot_id, previous_revision_id, deleted_at,
      prompt, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      randomUUID(),
      randomUUID(),
      snapshotId,
      row.prompt,
      row.created_at,
      row.updated_at,
    );
  }
}

function migrateFileContexts(db: Database, snapshotId: string) {
  if (!tableExists(db, "file_context_legacy_v1")) return;
  const rows = db
    .prepare("SELECT * FROM file_context_legacy_v1")
    .all() as Array<{
    kind?: string;
    filename?: string | null;
    path: string;
    hash?: string | null;
    description: string;
    created_at: number;
    updated_at: number;
  }>;
  const insert = db.prepare(`
    INSERT INTO file_context (
      id, record_id, snapshot_id, previous_revision_id, deleted_at,
      kind, filename, path, hash, description, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      randomUUID(),
      randomUUID(),
      snapshotId,
      row.kind ?? "file",
      row.filename ?? nameFromPath(row.path),
      row.path,
      row.hash ?? "",
      row.description,
      row.created_at,
      row.updated_at,
    );
  }
}

function migrateChanges(
  db: Database,
  snapshotId: string,
  documentIds: Map<number, string>,
) {
  if (!tableExists(db, "change_note_legacy_v1")) return;
  const rows = db
    .prepare("SELECT * FROM change_note_legacy_v1")
    .all() as Array<{
    note: string;
    document_id: number | null;
    created_at: number;
  }>;
  const insert = db.prepare(`
    INSERT INTO change_note (
      id, record_id, snapshot_id, previous_revision_id, deleted_at,
      note, document_id, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      randomUUID(),
      randomUUID(),
      snapshotId,
      row.note,
      row.document_id === null
        ? null
        : (documentIds.get(row.document_id) ?? null),
      row.created_at,
      row.created_at,
    );
  }
}

function migrateTasks(
  db: Database,
  snapshotId: string,
  documentIds: Map<number, string>,
) {
  if (!tableExists(db, "task_legacy_v1")) return;
  const rows = db.prepare("SELECT * FROM task_legacy_v1").all() as Array<{
    title: string;
    description?: string | null;
    document_id: number | null;
    status: string;
    created_at: number;
    updated_at: number;
  }>;
  const insert = db.prepare(`
    INSERT INTO task (
      id, record_id, snapshot_id, previous_revision_id, deleted_at,
      title, description, document_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      randomUUID(),
      randomUUID(),
      snapshotId,
      row.title,
      row.description ?? null,
      row.document_id === null
        ? null
        : (documentIds.get(row.document_id) ?? null),
      row.status,
      row.created_at,
      row.updated_at,
    );
  }
}

function tableExists(db: Database, table: string) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function columnExists(db: Database, table: string, column: string) {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

function addColumnIfMissing(
  db: Database,
  table: string,
  column: string,
  type: string,
) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function nameFromPath(value: string) {
  const trimmed = value.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || value;
}
