import type { ProjectMigration } from "../migration-types.js";
import { migrateFileOutsideLinkSchema } from "../../storage/schema.js";

const migration: ProjectMigration = {
  version: "5.0.0",
  name: "Add file_outside_link table",
  requiresBackup: true,
  migrate(context) { migrateFileOutsideLinkSchema(context.scopedDb); },
};

export default migration;
