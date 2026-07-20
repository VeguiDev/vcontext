import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { ProjectMigrationRunner } from "../src/project/migration-runner.js";
import {
  ProjectMigrationError,
  ProjectPostMigrationError,
  type LoadedProjectMigration,
  type ProjectMigration,
} from "../src/project/migration-types.js";

const fixtures: RunnerFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

describe("ProjectMigrationRunner", () => {
  it("tracks pending and applied migrations and is a no-op when current", async () => {
    const fixture = await createFixture([
      migration("1.0.0", "Create data", ({ scopedDb }) => {
        scopedDb.exec("CREATE TABLE data (value TEXT)");
      }),
    ]);
    assert.deepEqual(
      fixture.runner.pending().map((entry) => entry.version),
      ["1.0.0"],
    );

    const first = await fixture.runner.migrate();
    assert.deepEqual(first.applied, ["1.0.0"]);
    assert.equal(first.status.current_version, "1.0.0");
    assert.equal(first.status.pending.length, 0);

    fs.writeFileSync(
      path.join(fixture.directory, "project.json"),
      JSON.stringify({ schema_version: "99.0.0" }),
    );
    assert.equal(fixture.runner.status().current_version, "1.0.0");

    const second = await fixture.runner.migrate();
    assert.deepEqual(second.applied, []);
  });

  it("supports legacy databases without migration metadata", async () => {
    const fixture = await createFixture([
      migration("1.0.0", "Preserve legacy", ({ scopedDb }) => {
        scopedDb.exec(
          "ALTER TABLE legacy_data ADD COLUMN migrated INTEGER DEFAULT 1",
        );
      }),
    ]);
    fixture.scopedDb.exec(
      "CREATE TABLE legacy_data (value TEXT); INSERT INTO legacy_data VALUES ('kept')",
    );

    await fixture.runner.migrate();
    const row = fixture.scopedDb
      .prepare("SELECT value, migrated FROM legacy_data")
      .get() as { value: string; migrated: number };
    assert.deepEqual(row, { value: "kept", migrated: 1 });
  });

  it("runs pre-migration before the transaction and stops when it fails", async () => {
    const candidate = migration("1.0.0", "Pre failure", () => undefined);
    candidate.preMigrate = () => {
      throw new Error("not ready");
    };
    const fixture = await createFixture([candidate]);

    await assert.rejects(
      fixture.runner.migrate(),
      /Pre-migration failed.*not ready/,
    );
    assert.equal(fixture.runner.status().applied.length, 0);
  });

  it("rolls back critical changes and tracking when migrate fails", async () => {
    const fixture = await createFixture([
      migration("1.0.0", "Broken", ({ scopedDb }) => {
        scopedDb.exec("CREATE TABLE rolled_back (id INTEGER)");
        throw new Error("boom");
      }),
    ]);

    await assert.rejects(fixture.runner.migrate(), /Migration failed.*boom/);
    assert.equal(tableExists(fixture.scopedDb, "rolled_back"), false);
    assert.equal(fixture.runner.status().current_version, "0.0.0");
    assert.equal(fixture.runner.status().applied.length, 0);
  });

  it("records failed post-migration work and retries it idempotently", async () => {
    let attempts = 0;
    const candidate = migration("1.0.0", "Post retry", ({ scopedDb }) => {
      scopedDb.exec("CREATE TABLE committed (id INTEGER)");
    });
    candidate.postMigrate = () => {
      attempts += 1;
      if (attempts === 1) throw new Error("post failed");
    };
    const fixture = await createFixture([candidate]);

    await assert.rejects(
      fixture.runner.migrate(),
      (error) => error instanceof ProjectPostMigrationError,
    );
    assert.equal(tableExists(fixture.scopedDb, "committed"), true);
    assert.deepEqual(fixture.runner.status().incomplete_post_migrations, [
      "1.0.0",
    ]);

    const retried = await fixture.runner.migrate();
    assert.deepEqual(retried.post_migrations_retried, ["1.0.0"]);
    assert.deepEqual(retried.status.incomplete_post_migrations, []);
    assert.equal(attempts, 2);
  });

  it("refuses an applied migration whose source checksum changed", async () => {
    const candidate = migration("1.0.0", "Checksum", () => undefined);
    const fixture = await createFixture([candidate]);
    await fixture.runner.migrate();
    const changed = { ...candidate, checksum: "changed" };
    const runner = fixture.createRunner([changed]);

    assert.throws(() => runner.pending(), /Checksum mismatch.*1\.0\.0/);
  });

  it("creates and retains a consistent backup for required migrations", async () => {
    const candidate = migration("1.0.0", "Destructive", ({ scopedDb }) => {
      scopedDb.exec("CREATE TABLE after_backup (id INTEGER)");
    });
    candidate.requiresBackup = true;
    const fixture = await createFixture([candidate]);
    fixture.scopedDb.exec("CREATE TABLE before_backup (value TEXT)");

    const result = await fixture.runner.migrate();
    assert.equal(result.backup_paths.length, 1);
    assert.equal(fs.existsSync(result.backup_paths[0]!), true);
    const backup = new Database(result.backup_paths[0]!, { readonly: true });
    try {
      assert.equal(tableExists(backup, "before_backup"), true);
      assert.equal(tableExists(backup, "after_backup"), false);
    } finally {
      backup.close();
    }
  });

  it("migrates only through a requested target version", async () => {
    const fixture = await createFixture([
      migration("1.0.0", "One", () => undefined),
      migration("1.1.0", "Two", () => undefined),
      migration("2.0.0", "Three", () => undefined),
    ]);

    const result = await fixture.runner.migrateTo("1.1.0");
    assert.deepEqual(result.applied, ["1.0.0", "1.1.0"]);
    assert.deepEqual(
      result.status.pending.map((entry) => entry.version),
      ["2.0.0"],
    );
  });

  it("rejects unknown applied migrations and pending migrations older than applied", async () => {
    const one = migration("1.0.0", "One", () => undefined);
    const two = migration("2.0.0", "Two", () => undefined);
    const fixture = await createFixture([one, two]);
    fixture.scopedDb
      .prepare(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      )
      .run("9.0.0", "Unknown", "x", 1);
    assert.throws(() => fixture.runner.pending(), /unknown applied migration/);

    fixture.scopedDb.prepare("DELETE FROM schema_migrations").run();
    fixture.scopedDb
      .prepare(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      )
      .run(two.version, two.name, two.checksum, 2);
    assert.throws(() => fixture.runner.pending(), /older than already applied/);
  });
});

interface RunnerFixture {
  directory: string;
  mainDb: Database.Database;
  scopedDb: Database.Database;
  runner: ProjectMigrationRunner;
  createRunner(migrations: LoadedProjectMigration[]): ProjectMigrationRunner;
  close(): void;
}

async function createFixture(
  migrations: LoadedProjectMigration[],
): Promise<RunnerFixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "vcontext-runner-"));
  const mainDb = new Database(":memory:");
  const scopedDb = new Database(path.join(directory, "data.db"));
  const project = {
    id: 1,
    uuid: "uuid",
    slug: path.basename(directory),
    name: "Fixture",
    description: null,
    created_at: 1,
    updated_at: 1,
  };
  const createRunner = (entries: LoadedProjectMigration[]) =>
    new ProjectMigrationRunner({
      project,
      cwd: directory,
      mainDb,
      scopedDb,
      migrations: entries,
      projectDirectory: directory,
      projectJsonPath: path.join(directory, "project.json"),
    });
  const fixture: RunnerFixture = {
    directory,
    mainDb,
    scopedDb,
    runner: createRunner(migrations),
    createRunner,
    close() {
      scopedDb.close();
      mainDb.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
  fixtures.push(fixture);
  return fixture;
}

function migration(
  version: string,
  name: string,
  migrate: ProjectMigration["migrate"],
): LoadedProjectMigration {
  return {
    version,
    name,
    migrate,
    checksum: `checksum-${version}`,
    sourcePath: `${version}.ts`,
  };
}

function tableExists(db: Database.Database, table: string) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}
