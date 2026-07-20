import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { withProjectMigrationLock } from "./migration-lock.js";
import {
  errorMessage,
  ProjectMigrationError,
  ProjectPostMigrationError,
  type AppliedProjectMigration,
  type LoadedProjectMigration,
  type ProjectMigrationContext,
  type ProjectMigrationRunResult,
  type ProjectMigrationStatus,
} from "./migration-types.js";
import { updateProjectJson } from "./project-metadata.js";
import { compareSemver, parseSemver } from "./semver.js";
import type { RegisteredProject } from "../storage/registry-store.js";

const POST_PENDING_PREFIX = "post_migration_pending:";
const BACKUP_PREFIX = "migration_backup:";

export interface ProjectMigrationRunnerOptions {
  project: RegisteredProject;
  cwd: string;
  mainDb: Database.Database;
  scopedDb: Database.Database;
  migrations: LoadedProjectMigration[];
  projectDirectory?: string;
  projectJsonPath?: string;
  allowUnknownAppliedMigrations?: boolean;
  log?: (message: string) => void;
}

export class ProjectMigrationRunner {
  readonly project: RegisteredProject;
  readonly cwd: string;
  readonly mainDb: Database.Database;
  readonly scopedDb: Database.Database;
  readonly migrations: LoadedProjectMigration[];
  private readonly projectDirectory: string;
  private readonly projectJsonPath: string;
  private readonly allowUnknown: boolean;
  private readonly logger: (message: string) => void;

  constructor(options: ProjectMigrationRunnerOptions) {
    this.project = options.project;
    this.cwd = options.cwd;
    this.mainDb = options.mainDb;
    this.scopedDb = options.scopedDb;
    this.migrations = [...options.migrations].sort((a, b) =>
      compareSemver(a.version, b.version),
    );
    this.projectDirectory =
      options.projectDirectory ?? path.dirname(options.scopedDb.name);
    this.projectJsonPath =
      options.projectJsonPath ??
      path.join(this.projectDirectory, "project.json");
    this.allowUnknown = options.allowUnknownAppliedMigrations ?? false;
    this.logger = options.log ?? (() => undefined);
    this.ensureMetadataTables();
  }

  status(): ProjectMigrationStatus {
    const appliedRows = this.readAppliedRows();
    const available = new Map(
      this.migrations.map((migration) => [migration.version, migration]),
    );
    const incomplete = this.readMetadataByPrefix(POST_PENDING_PREFIX).map(
      (entry) => entry.key.slice(POST_PENDING_PREFIX.length),
    );
    const applied: AppliedProjectMigration[] = appliedRows.map((row) => {
      const migration = available.get(row.version);
      const checksumState = !migration
        ? "unknown"
        : migration.checksum === row.checksum
          ? "valid"
          : "mismatch";
      return {
        ...row,
        checksum_state: checksumState,
        post_migration_state: incomplete.includes(row.version)
          ? "incomplete"
          : "complete",
      };
    });
    const appliedVersions = new Set(appliedRows.map((row) => row.version));
    const pending = this.migrations
      .filter((migration) => !appliedVersions.has(migration.version))
      .map((migration) => ({
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        requires_backup: migration.requiresBackup === true,
      }));
    return {
      project_slug: this.project.slug,
      current_version: currentVersion(appliedRows),
      latest_version: this.migrations.at(-1)?.version ?? "0.0.0",
      applied,
      pending,
      checksum_state: applied.every(
        (migration) => migration.checksum_state === "valid",
      )
        ? "valid"
        : "invalid",
      incomplete_post_migrations: incomplete,
      backup_paths: this.readMetadataByPrefix(BACKUP_PREFIX).map(
        (entry) => entry.value,
      ),
    };
  }

  pending() {
    this.validateApplied();
    return this.status().pending;
  }

  async migrate() {
    return this.migrateTo(this.migrations.at(-1)?.version ?? "0.0.0");
  }

  async migrateTo(targetVersion: string): Promise<ProjectMigrationRunResult> {
    if (!parseSemver(targetVersion)) {
      throw new ProjectMigrationError(
        `Invalid target migration version "${targetVersion}"`,
      );
    }
    if (
      targetVersion !== "0.0.0" &&
      !this.migrations.some((migration) => migration.version === targetVersion)
    ) {
      throw new ProjectMigrationError(
        `Target migration ${targetVersion} is not available`,
      );
    }

    return withProjectMigrationLock(this.projectDirectory, async () => {
      this.ensureMetadataTables();
      const retried = await this.retryIncompletePostMigrations();
      const startingVersion = currentVersion(this.readAppliedRows());
      if (compareSemver(targetVersion, startingVersion) < 0) {
        throw new ProjectMigrationError(
          `Downgrade from ${startingVersion} to ${targetVersion} is not supported`,
        );
      }
      const pending = this.pending().filter(
        (migration) => compareSemver(migration.version, targetVersion) <= 0,
      );
      const appliedVersions: string[] = [];
      const backupPaths: string[] = [];

      for (const pendingMigration of pending) {
        const migration = this.requireMigration(pendingMigration.version);
        const fromVersion = currentVersion(this.readAppliedRows());
        if (migration.requiresBackup) {
          backupPaths.push(await this.createBackup(migration.version));
        }
        const context = this.context(fromVersion, migration.version);
        this.logger(
          `Applying project migration ${migration.version} (${migration.name})`,
        );
        try {
          await migration.preMigrate?.(context);
        } catch (error) {
          throw new ProjectMigrationError(
            `Pre-migration failed for ${migration.version} (${migration.name}): ${errorMessage(error)}`,
            migration,
            error,
          );
        }

        this.scopedDb.exec("BEGIN IMMEDIATE");
        try {
          await migration.migrate(context);
          this.scopedDb
            .prepare(
              `INSERT INTO schema_migrations (version, name, checksum, applied_at)
               VALUES (?, ?, ?, ?)`,
            )
            .run(
              migration.version,
              migration.name,
              migration.checksum,
              Date.now(),
            );
          this.setMetadata("current_schema_version", migration.version);
          if (migration.postMigrate) {
            this.setMetadata(
              `${POST_PENDING_PREFIX}${migration.version}`,
              String(Date.now()),
            );
          }
          this.scopedDb.exec("COMMIT");
        } catch (error) {
          if (this.scopedDb.inTransaction) this.scopedDb.exec("ROLLBACK");
          throw new ProjectMigrationError(
            `Migration failed for ${migration.version} (${migration.name}): ${errorMessage(error)}`,
            migration,
            error,
          );
        }

        appliedVersions.push(migration.version);
        if (migration.postMigrate) {
          try {
            await migration.postMigrate(context);
            this.deleteMetadata(`${POST_PENDING_PREFIX}${migration.version}`);
            this.updateCachedMetadata();
          } catch (error) {
            this.setMetadata(
              `${POST_PENDING_PREFIX}${migration.version}`,
              String(Date.now()),
            );
            this.updateCachedMetadataAfterFailure();
            throw new ProjectPostMigrationError(migration, error);
          }
        }
        this.updateCachedMetadata();
      }

      this.updateCachedMetadata();
      return {
        status: this.status(),
        applied: appliedVersions,
        post_migrations_retried: retried,
        backup_paths: backupPaths,
      };
    });
  }

  private validateApplied() {
    const applied = this.readAppliedRows();
    const available = new Map(
      this.migrations.map((migration) => [migration.version, migration]),
    );
    for (const row of applied) {
      const migration = available.get(row.version);
      if (!migration) {
        if (this.allowUnknown) continue;
        throw new ProjectMigrationError(
          `Scoped database contains unknown applied migration ${row.version}`,
        );
      }
      if (migration.checksum !== row.checksum) {
        throw new ProjectMigrationError(
          `Checksum mismatch for applied migration ${row.version} (${row.name}); expected ${row.checksum}, found ${migration.checksum}`,
          migration,
        );
      }
    }
    const highestApplied = currentVersion(applied);
    const appliedVersions = new Set(applied.map((row) => row.version));
    const olderPending = this.migrations.find(
      (migration) =>
        !appliedVersions.has(migration.version) &&
        compareSemver(migration.version, highestApplied) < 0,
    );
    if (olderPending) {
      throw new ProjectMigrationError(
        `Pending migration ${olderPending.version} is older than already applied schema version ${highestApplied}`,
        olderPending,
      );
    }
  }

  private async retryIncompletePostMigrations() {
    this.validateApplied();
    const retried: string[] = [];
    const pendingVersions = this.readMetadataByPrefix(POST_PENDING_PREFIX).map(
      (entry) => entry.key.slice(POST_PENDING_PREFIX.length),
    );
    for (const version of pendingVersions.sort(compareSemver)) {
      const migration = this.requireMigration(version);
      if (!migration.postMigrate) {
        this.deleteMetadata(`${POST_PENDING_PREFIX}${version}`);
        continue;
      }
      const applied = this.readAppliedRows();
      const index = applied.findIndex((entry) => entry.version === version);
      const fromVersion = index > 0 ? applied[index - 1]!.version : "0.0.0";
      try {
        await migration.postMigrate(this.context(fromVersion, version));
        this.deleteMetadata(`${POST_PENDING_PREFIX}${version}`);
        this.updateCachedMetadata();
        retried.push(version);
      } catch (error) {
        this.setMetadata(
          `${POST_PENDING_PREFIX}${version}`,
          String(Date.now()),
        );
        this.updateCachedMetadataAfterFailure();
        throw new ProjectPostMigrationError(migration, error);
      }
    }
    return retried;
  }

  private async createBackup(version: string) {
    const directory = path.join(this.projectDirectory, "migration-backups");
    fs.mkdirSync(directory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "");
    const backupPath = path.join(
      directory,
      `scoped-${version}-${timestamp}.db`,
    );
    await this.scopedDb.backup(backupPath);
    this.setMetadata(`${BACKUP_PREFIX}${Date.now()}:${version}`, backupPath);
    this.logger(`Created migration backup ${backupPath}`);
    return backupPath;
  }

  private context(
    fromVersion: string,
    toVersion: string,
  ): ProjectMigrationContext {
    return {
      project: this.project,
      cwd: this.cwd,
      mainDb: this.mainDb,
      scopedDb: this.scopedDb,
      fromVersion,
      toVersion,
      log: (message) =>
        this.logger(`[${this.project.slug} ${toVersion}] ${message}`),
    };
  }

  private updateCachedMetadata() {
    const status = this.status();
    updateProjectJson(this.projectJsonPath, {
      schema_version: status.current_version,
      migration: {
        incomplete_post_migrations: status.incomplete_post_migrations,
        backup_paths: status.backup_paths,
      },
    });
  }

  private updateCachedMetadataAfterFailure() {
    try {
      this.updateCachedMetadata();
    } catch (error) {
      this.logger(
        `[${this.project.slug}] Could not update cached migration metadata after a failure: ${errorMessage(error)}`,
      );
    }
  }

  private ensureMetadataTables() {
    this.scopedDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private readAppliedRows() {
    return this.scopedDb
      .prepare(
        `SELECT version, name, checksum, applied_at
         FROM schema_migrations ORDER BY applied_at ASC, version ASC`,
      )
      .all() as Array<{
      version: string;
      name: string;
      checksum: string;
      applied_at: number;
    }>;
  }

  private readMetadataByPrefix(prefix: string) {
    return this.scopedDb
      .prepare(
        "SELECT key, value FROM project_metadata WHERE key LIKE ? ORDER BY key ASC",
      )
      .all(`${prefix}%`) as Array<{ key: string; value: string }>;
  }

  private setMetadata(key: string, value: string) {
    this.scopedDb
      .prepare(
        `INSERT INTO project_metadata (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  private deleteMetadata(key: string) {
    this.scopedDb
      .prepare("DELETE FROM project_metadata WHERE key = ?")
      .run(key);
  }

  private requireMigration(version: string) {
    const migration = this.migrations.find(
      (entry) => entry.version === version,
    );
    if (!migration) {
      throw new ProjectMigrationError(
        `Applied migration ${version} is not available`,
      );
    }
    return migration;
  }
}

function currentVersion(applied: Array<{ version: string }>) {
  const valid = applied
    .map((entry) => entry.version)
    .filter((version) => parseSemver(version))
    .sort(compareSemver);
  return valid.at(-1) ?? "0.0.0";
}
