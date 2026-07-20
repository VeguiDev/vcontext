import path from "node:path";
import { VCONTEXT_HOME } from "@repo/vcontext-core";

export { VCONTEXT_HOME };

export const REGISTRY_DB_PATH = path.join(VCONTEXT_HOME, "registry.db");
export const PROJECTS_ROOT = path.join(VCONTEXT_HOME, "projects");

export function projectRoot(slug: string) {
  return path.join(PROJECTS_ROOT, slug);
}

export function projectDataDbPath(slug: string) {
  return path.join(projectRoot(slug), "data.db");
}

export function projectConfigPath(slug: string) {
  return path.join(projectRoot(slug), "project.json");
}
