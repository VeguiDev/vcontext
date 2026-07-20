import fs from "node:fs";

export interface ProjectJsonMetadata {
  current_branch?: string;
  schema_version?: string;
  migration?: {
    incomplete_post_migrations?: string[];
    backup_paths?: string[];
  };
}

export function readProjectJson(path: string): ProjectJsonMetadata {
  if (!fs.existsSync(path)) return {};
  const value = JSON.parse(fs.readFileSync(path, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid project metadata at ${path}`);
  }
  return value as ProjectJsonMetadata;
}

export function updateProjectJson(
  path: string,
  update: Partial<ProjectJsonMetadata>,
) {
  const current = readProjectJson(path);
  const next: ProjectJsonMetadata = {
    ...current,
    ...update,
    migration:
      current.migration || update.migration
        ? { ...current.migration, ...update.migration }
        : undefined,
  };
  fs.writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  return next;
}
