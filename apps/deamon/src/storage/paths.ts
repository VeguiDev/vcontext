import os from "node:os";
import path from "node:path";

export const VCONTEXT_HOME =
  process.env.VCONTEXT_HOME ?? path.join(os.homedir(), ".vcontext");

export const REGISTRY_DB_PATH = path.join(VCONTEXT_HOME, "registry.db");
export const PROJECTS_ROOT = path.join(VCONTEXT_HOME, "projects");

export function projectRoot(slug: string) {
  return path.join(PROJECTS_ROOT, slug);
}

export function projectDataDbPath(slug: string) {
  return path.join(projectRoot(slug), "data.db");
}
