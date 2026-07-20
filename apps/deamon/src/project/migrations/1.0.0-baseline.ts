import type { ProjectMigration } from "../migration-types.js";
import { migrateLegacyProjectSchema } from "../../storage/schema.js";

const migration: ProjectMigration = {
  version: "1.0.0",
  name: "Baseline project schema",

  preMigrate(context) {
    const tables = context.scopedDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    context.log(
      tables.length === 0
        ? "Fresh scoped database detected"
        : `Legacy or pre-tracked schema detected with ${tables.length} table(s)`,
    );
  },

  migrate(context) {
    migrateLegacyProjectSchema(context.scopedDb);
  },
};

export default migration;
