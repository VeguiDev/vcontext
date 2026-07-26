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
  fileOutsideLink?: {
    target_project_slug?: string;
    kind?: string;
    target_type?: string;
    source_file_context_id?: string;
  };
}

export interface WriteSelector {
  branch?: string;
  message?: string | null;
  fileOutsideLink?: {
    target_project_slug?: string;
    target_type?: string;
    kind?: string;
    description?: string;
    source_file_context_id?: string | null;
    target_path?: string | null;
    target_branch_name?: string | null;
    target_snapshot_id?: string | null;
  };
}

export interface ProjectStatus {
  name: string;
  slug: string;
  local_path: string | null;
  current_branch: string;
  current_snapshot_id: string | null;
  head_message: string | null;
  head_created_at: number | null;
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
