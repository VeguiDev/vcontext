import type {
  EntityType,
  MergeResolutions,
  SnapshotDiff,
  SnapshotSummary,
  VersionedRecord,
} from "../storage/project-store.js";

export interface ProjectLocator {
  project_slug?: string;
  cwd?: string;
}

export interface ReadSelector {
  branch?: string;
  snapshot_id?: string;
}

export interface WriteSelector {
  branch?: string;
  message?: string | null;
}

export interface ProjectStatus {
  name: string;
  slug: string;
  local_path: string | null;
  current_branch: string;
  current_snapshot_id: string;
  head_message: string | null;
  head_created_at: number;
  branch_count: number;
  counts: Record<EntityType, number>;
}

export interface MergeApplyInput {
  source_branch: string;
  target_branch?: string;
  strategy?: "manual" | "source" | "target";
  resolutions?: MergeResolutions;
  message?: string | null;
}

export type { SnapshotDiff, SnapshotSummary, VersionedRecord };
