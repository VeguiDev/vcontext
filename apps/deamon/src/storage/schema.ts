import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";

const ENTITY_TABLES = [
  "project_prompt",
  "document",
  "change_note",
  "task",
  "file_context",
  "file_outside_link",
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

  addColumnIfMissing(db, "project_link", "branch_name", "TEXT");
  addColumnIfMissing(db, "project_link", "snapshot_id", "TEXT");

  if ((db.pragma("user_version", { simple: true }) as number) < 1) {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`
      CREATE TABLE project_link_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        project_b_id INTEGER NOT NULL,
        branch_name TEXT,
        snapshot_id TEXT,
        created_at INTEGER NOT NULL,
        branch_key TEXT GENERATED ALWAYS AS (COALESCE(branch_name, '__NULL__')) STORED,
        snapshot_key TEXT GENERATED ALWAYS AS (COALESCE(snapshot_id, '__NULL__')) STORED,
        UNIQUE(project_id, project_b_id, branch_key, snapshot_key),
        FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
        FOREIGN KEY (project_b_id) REFERENCES project(id) ON DELETE CASCADE
      );
      INSERT INTO project_link_new (id, project_id, project_b_id, branch_name, snapshot_id, created_at)
      SELECT id, project_id, project_b_id, NULL, NULL, created_at FROM project_link;
      DROP TABLE project_link;
      ALTER TABLE project_link_new RENAME TO project_link;
    `);
    db.pragma("user_version = 1");
  }
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

/** Upgrade a v2 project to the sync-capable v3 layout without changing heads. */
export function migrateSyncProjectSchema(db: Database) {
  createVersionedSchema(db);

  if (columnNotNull(db, "branch", "snapshot_id")) {
    db.exec(`
      ALTER TABLE branch RENAME TO branch_v2;
      CREATE TABLE branch (
        name TEXT PRIMARY KEY,
        snapshot_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (snapshot_id) REFERENCES snapshot(id)
      );
      INSERT INTO branch (name, snapshot_id, created_at, updated_at)
      SELECT name, snapshot_id, created_at, updated_at FROM branch_v2;
      DROP TABLE branch_v2;
    `);
  }

  addColumnIfMissing(db, "snapshot", "object_hash", "TEXT");
  for (const table of ENTITY_TABLES) {
    addColumnIfMissing(db, table, "object_hash", "TEXT");
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS snapshot_object_hash_idx
      ON snapshot(object_hash) WHERE object_hash IS NOT NULL;
    CREATE TABLE IF NOT EXISTS record_identity (
      record_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project_prompt','document','change_note','task','file_context','file_outside_link')),
      created_at INTEGER NOT NULL,
      object_hash TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS remote (
      name TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS remote_ref (
      remote_name TEXT NOT NULL,
      name TEXT NOT NULL,
      snapshot_id TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (remote_name, name),
      FOREIGN KEY (remote_name) REFERENCES remote(name) ON DELETE CASCADE,
      FOREIGN KEY (snapshot_id) REFERENCES snapshot(id)
    );
    CREATE TABLE IF NOT EXISTS branch_upstream (
      branch_name TEXT PRIMARY KEY,
      remote_name TEXT NOT NULL,
      remote_branch TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (branch_name) REFERENCES branch(name) ON DELETE CASCADE,
      FOREIGN KEY (remote_name) REFERENCES remote(name) ON DELETE CASCADE,
      UNIQUE(remote_name, remote_branch)
    );
    CREATE INDEX IF NOT EXISTS remote_ref_snapshot_idx ON remote_ref(snapshot_id);
  `);

  for (const table of ENTITY_TABLES) {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_object_hash_idx
      ON ${table}(object_hash) WHERE object_hash IS NOT NULL`);
    db.prepare(
      `INSERT OR IGNORE INTO record_identity (record_id, entity_type, created_at)
       SELECT record_id, ?, MIN(created_at) FROM ${table} GROUP BY record_id`,
    ).run(table);
  }
}

/** Upgrade a v3 project with Git observation and durable sync state. */
export function migrateGitAwareProjectSchema(db: Database) {
  migrateSyncProjectSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshot_metadata (
      snapshot_id TEXT PRIMARY KEY,
      author_cloud_id TEXT,
      author_name TEXT NOT NULL,
      author_email TEXT,
      git_commit_sha TEXT UNIQUE,
      git_branch TEXT,
      git_dirty INTEGER NOT NULL CHECK(git_dirty IN (0, 1)),
      commit_message TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES snapshot(id) ON DELETE CASCADE,
      CHECK(git_commit_sha IS NULL OR length(git_commit_sha) IN (40, 64))
    );
    CREATE TABLE IF NOT EXISTS git_state (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      mode TEXT NOT NULL CHECK(mode IN ('branch', 'detached')),
      branch_name TEXT,
      detached_snapshot_id TEXT,
      previous_branch TEXT,
      warning TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (detached_snapshot_id) REFERENCES snapshot(id)
    );
    CREATE TABLE IF NOT EXISTS sync_job (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation TEXT NOT NULL CHECK(operation IN ('FETCH','PULL','PUSH','CREATE_REMOTE_BRANCH','LINK_SNAPSHOT_COMMIT')),
      dedupe_key TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER NOT NULL,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_conflict (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      branch_name TEXT,
      preview TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS snapshot_metadata_commit_idx ON snapshot_metadata(git_commit_sha);
    CREATE INDEX IF NOT EXISTS sync_job_retry_idx ON sync_job(next_retry_at, id);
    CREATE INDEX IF NOT EXISTS sync_conflict_pending_idx ON sync_conflict(resolved_at, id);
  `);
}

export function migrateFileOutsideLinkSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_outside_link (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      previous_revision_id TEXT,
      deleted_at INTEGER,
      source_file_context_id TEXT,
      target_project_slug TEXT NOT NULL,
      target_path TEXT,
      target_type TEXT NOT NULL CHECK(target_type IN ('file','directory','project')),
      target_branch_name TEXT,
      target_snapshot_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('lib','sdk','api','dependency','external_call','import')),
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      object_hash TEXT,
      FOREIGN KEY (snapshot_id) REFERENCES snapshot(id),
      FOREIGN KEY (previous_revision_id) REFERENCES file_outside_link(id)
    );
    CREATE INDEX IF NOT EXISTS file_outside_link_record_snapshot_idx ON file_outside_link(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS file_outside_link_source_idx ON file_outside_link(source_file_context_id);
  `);
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
    CREATE TABLE IF NOT EXISTS file_outside_link (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      previous_revision_id TEXT,
      deleted_at INTEGER,
      source_file_context_id TEXT,
      target_project_slug TEXT NOT NULL,
      target_path TEXT,
      target_type TEXT NOT NULL CHECK(target_type IN ('file','directory','project')),
      target_branch_name TEXT,
      target_snapshot_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('lib','sdk','api','dependency','external_call','import')),
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      object_hash TEXT,
      FOREIGN KEY (snapshot_id) REFERENCES snapshot(id),
      FOREIGN KEY (previous_revision_id) REFERENCES file_outside_link(id)
    );
    CREATE INDEX IF NOT EXISTS project_prompt_record_snapshot_idx ON project_prompt(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS document_record_snapshot_idx ON document(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS change_note_record_snapshot_idx ON change_note(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS task_record_snapshot_idx ON task(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS file_context_record_snapshot_idx ON file_context(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS file_outside_link_record_snapshot_idx ON file_outside_link(record_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS file_outside_link_source_idx ON file_outside_link(source_file_context_id);
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

function columnNotNull(db: Database, table: string, column: string) {
  const columns = db.pragma(`table_info(${table})`) as Array<{
    name: string;
    notnull: number;
  }>;
  return columns.some((entry) => entry.name === column && entry.notnull === 1);
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
