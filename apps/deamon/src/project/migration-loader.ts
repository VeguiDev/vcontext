import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  LoadedProjectMigration,
  ProjectMigration,
} from "./migration-types.js";
import { compareSemver, parseSemver } from "./semver.js";
import { embeddedMigrations } from "./migrations.generated.js";

const MIGRATION_FILE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-.+\.(?:ts|js|mjs|cjs)$/;

export async function loadProjectMigrations(directory?: string) {
  if (directory === undefined) return embeddedMigrations;
  const resolvedDirectory = directory;
  const entries = await fs.readdir(resolvedDirectory, { withFileTypes: true });
  const loaded: LoadedProjectMigration[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      !entry.isFile() ||
      !MIGRATION_FILE.test(entry.name) ||
      entry.name.endsWith(".d.ts")
    ) {
      continue;
    }
    const sourcePath = path.join(resolvedDirectory, entry.name);
    const source = await fs.readFile(sourcePath);
    const checksum = createHash("sha256").update(source).digest("hex");
    const url = pathToFileURL(sourcePath);
    url.searchParams.set("checksum", checksum);
    const module = (await import(url.href)) as { default?: unknown };
    const migration = validateMigration(module.default, sourcePath);
    loaded.push({ ...migration, checksum, sourcePath });
  }

  const versions = new Set<string>();
  for (const migration of loaded) {
    if (versions.has(migration.version)) {
      throw new Error(
        `Duplicate project migration version ${migration.version}`,
      );
    }
    versions.add(migration.version);
  }
  return loaded.sort((a, b) => compareSemver(a.version, b.version));
}

function validateMigration(
  value: unknown,
  sourcePath: string,
): ProjectMigration {
  if (!value || typeof value !== "object") {
    throw new Error(`Migration ${sourcePath} must default-export an object`);
  }
  const migration = value as Partial<ProjectMigration>;
  if (
    typeof migration.version !== "string" ||
    !parseSemver(migration.version)
  ) {
    throw new Error(
      `Migration ${sourcePath} has invalid semantic version "${String(migration.version)}"`,
    );
  }
  if (
    typeof migration.name !== "string" ||
    migration.name.trim().length === 0
  ) {
    throw new Error(`Migration ${sourcePath} must have a non-empty name`);
  }
  if (typeof migration.migrate !== "function") {
    throw new Error(`Migration ${sourcePath} must define migrate(context)`);
  }
  for (const method of ["preMigrate", "postMigrate"] as const) {
    if (
      migration[method] !== undefined &&
      typeof migration[method] !== "function"
    ) {
      throw new Error(`Migration ${sourcePath} has non-function ${method}`);
    }
  }
  if (
    migration.requiresBackup !== undefined &&
    typeof migration.requiresBackup !== "boolean"
  ) {
    throw new Error(`Migration ${sourcePath} has non-boolean requiresBackup`);
  }
  return migration as ProjectMigration;
}
