import type { ProjectMigration } from "../migration-types.js";
import { migrateGitAwareProjectSchema } from "../../storage/schema.js";

const migration: ProjectMigration = {
  version: "4.0.0",
  name: "Add Git-aware metadata and durable sync queue",
  requiresBackup: true,
  migrate(context) { migrateGitAwareProjectSchema(context.scopedDb); },
};

export default migration;
