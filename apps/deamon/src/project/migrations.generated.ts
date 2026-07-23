import type { LoadedProjectMigration } from "./migration-types.js";
import migration1_0_0_baseline from "./migrations/1.0.0-baseline.js";
import migration2_0_0_versioned_records from "./migrations/2.0.0-versioned-records.js";
import migration3_0_0_sync from "./migrations/3.0.0-sync.js";
import migration4_0_0_git_aware from "./migrations/4.0.0-git-aware.js";

export const embeddedMigrations: LoadedProjectMigration[] = [
  { ...migration1_0_0_baseline, checksum: "62197904ae96ad9e1b477ca28d96c5c982d6c3b0e692eefbebc4370be6eccb22", sourcePath: "embedded:1.0.0-baseline.ts" },
  { ...migration2_0_0_versioned_records, checksum: "537d8415353784204eee3983f5d9d3f2570c8df9f319767d35e40b5bdc9416ef", sourcePath: "embedded:2.0.0-versioned-records.ts" },
  { ...migration3_0_0_sync, checksum: "e8592e9fb7efd207c51a21db4fe198a5a3c98371a37c13e8b7e1b6e9adab0706", sourcePath: "embedded:3.0.0-sync.ts" },
  { ...migration4_0_0_git_aware, checksum: "b5f51ca9d120ee739b3f071c6fbe0aa2140f50157f78e5f4f89c1fc33d1a5fb7", sourcePath: "embedded:4.0.0-git-aware.ts" },
].sort((a, b) => a.version.localeCompare(b.version));
