import type { ProjectMigration } from "../migration-types.js";
import { migrateSyncProjectSchema } from "../../storage/schema.js";
import { projectConfigPath } from "../../storage/paths.js";
import { readProjectJson, updateProjectJson } from "../project-metadata.js";

const migration: ProjectMigration = {
  version: "3.0.0",
  name: "Add remote synchronization",
  requiresBackup: true,

  migrate(context) {
    migrateSyncProjectSchema(context.scopedDb);
    const configPath = projectConfigPath(context.project.slug);
    if (readProjectJson(configPath).sync_unborn_bootstrap) {
      const revisionCount = [
        "project_prompt",
        "document",
        "change_note",
        "task",
        "file_context",
      ].reduce((count, table) => {
        const row = context.scopedDb
          .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
          .get() as { count: number };
        return count + row.count;
      }, 0);
      if (revisionCount !== 0) {
        throw new Error("A new project cannot contain seeded revisions");
      }
      context.scopedDb
        .prepare("UPDATE branch SET snapshot_id = NULL WHERE name = 'main'")
        .run();
      context.scopedDb.exec(`
        DELETE FROM snapshot_parent;
        DELETE FROM snapshot;
      `);
    }
  },

  postMigrate(context) {
    updateProjectJson(projectConfigPath(context.project.slug), {
      sync_unborn_bootstrap: undefined,
    });
  },
};

export default migration;
