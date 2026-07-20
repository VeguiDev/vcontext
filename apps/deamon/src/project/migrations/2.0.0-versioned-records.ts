import type { ProjectMigration } from "../migration-types.js";
import { updateProjectJson } from "../project-metadata.js";
import { projectConfigPath } from "../../storage/paths.js";
import { migrateVersionedProjectSchema } from "../../storage/schema.js";

const migration: ProjectMigration = {
  version: "2.0.0",
  name: "Add versioned records",
  requiresBackup: true,

  migrate(context) {
    migrateVersionedProjectSchema(context.scopedDb);
  },

  postMigrate(context) {
    const configPath = projectConfigPath(context.project.slug);
    const current = updateProjectJson(configPath, {});
    if (!current.current_branch) {
      updateProjectJson(configPath, { current_branch: "main" });
    }
  },
};

export default migration;
