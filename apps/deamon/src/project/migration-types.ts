import type Database from "../storage/database.js";
import type { RegisteredProject } from "../storage/registry-store.js";

export interface ProjectMigrationContext {
  project: RegisteredProject;
  cwd: string;
  mainDb: Database;
  scopedDb: Database;
  fromVersion: string;
  toVersion: string;
  log(message: string): void;
}

export interface ProjectMigration {
  version: string;
  name: string;
  requiresBackup?: boolean;
  preMigrate?(context: ProjectMigrationContext): Promise<void> | void;
  migrate(context: ProjectMigrationContext): Promise<void> | void;
  postMigrate?(context: ProjectMigrationContext): Promise<void> | void;
}

export interface LoadedProjectMigration extends ProjectMigration {
  checksum: string;
  sourcePath: string;
}

export interface AppliedProjectMigration {
  version: string;
  name: string;
  checksum: string;
  applied_at: number;
  checksum_state: "valid" | "mismatch" | "unknown";
  post_migration_state: "complete" | "incomplete";
}

export interface ProjectMigrationStatus {
  project_slug: string;
  current_version: string;
  latest_version: string;
  applied: AppliedProjectMigration[];
  pending: Array<{
    version: string;
    name: string;
    checksum: string;
    requires_backup: boolean;
  }>;
  checksum_state: "valid" | "invalid";
  incomplete_post_migrations: string[];
  backup_paths: string[];
}

export interface ProjectMigrationRunResult {
  status: ProjectMigrationStatus;
  applied: string[];
  post_migrations_retried: string[];
  backup_paths: string[];
}

export class ProjectMigrationError extends Error {
  constructor(
    message: string,
    readonly migration?: Pick<ProjectMigration, "version" | "name">,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProjectMigrationError";
  }
}

export class ProjectPostMigrationError extends ProjectMigrationError {
  readonly databaseMigrationSucceeded = true;

  constructor(
    migration: Pick<ProjectMigration, "version" | "name">,
    cause: unknown,
  ) {
    super(
      `Migration ${migration.version} (${migration.name}) was committed, but post-migration work failed and must be retried: ${errorMessage(cause)}`,
      migration,
      cause,
    );
    this.name = "ProjectPostMigrationError";
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
