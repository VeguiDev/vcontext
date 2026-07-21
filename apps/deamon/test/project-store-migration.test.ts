import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import type { ProjectStore } from "../src/storage/project-store.js";
import type { RegistryStore } from "../src/storage/registry-store.js";

describe("legacy project migration", { concurrency: false }, () => {
  let home = "";
  let previousHome: string | undefined;
  let store: ProjectStore;
  let registry: RegistryStore;

  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "vcontext-migration-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;
    const [{ RegistryStore }, { ProjectService }] = await Promise.all([
      import("../src/storage/registry-store.js"),
      import("../src/project/project-service.js"),
    ]);
    registry = new RegistryStore();
    const project = registry.create({ name: "Legacy Project" });
    const root = path.join(home, "projects", project.slug);
    fs.mkdirSync(root, { recursive: true });
    const db = new Database(path.join(root, "data.db"));
    db.exec(`
      CREATE TABLE project_prompt (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE document (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE change_note (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note TEXT NOT NULL,
        document_id INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE task (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        document_id INTEGER,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE file_context (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        filename TEXT,
        path TEXT NOT NULL UNIQUE,
        hash TEXT,
        description TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO project_prompt VALUES (1, 'Preserve me', 10, 11);
      INSERT INTO document VALUES (1, 'Legacy doc', 'Legacy body', 20, 21);
      INSERT INTO change_note VALUES (1, 'Legacy change', 1, 30);
      INSERT INTO task VALUES (1, 'Legacy task', 'Details', 1, 'RUNNING', 40, 41);
      INSERT INTO file_context VALUES (
        1, 'file', 'index.ts', 'src/index.ts', 'hash', 'Legacy path', 50, 51
      );
    `);
    db.close();

    store = await new ProjectService(registry).openStore(project);
  });

  after(async () => {
    store.close();
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  it("converts legacy rows into one initial versioned state", () => {
    const branch = store.branch();
    const document = branch.document.find()[0]!;
    const task = branch.task.find()[0]!;
    const change = branch.change.find()[0]!;

    assert.equal(typeof document.id, "string");
    assert.equal(typeof document.record_id, "string");
    assert.notEqual(document.id, document.record_id);
    assert.equal(document.created_at, 20);
    assert.equal(document.updated_at, 21);
    assert.equal(task.document_id, document.record_id);
    assert.equal(change.document_id, document.record_id);
    assert.equal(change.updated_at, change.created_at);
    assert.equal(branch.prompt.find()[0]?.prompt, "Preserve me");
    assert.equal(branch.fileContext.find()[0]?.path, "src/index.ts");
    assert.deepEqual(
      store.branches.find().map((entry) => entry.name),
      ["main"],
    );
    assert.equal(
      store.requireSnapshot(branch.snapshot_id!).message,
      "Migrate existing project data",
    );
  });
});
