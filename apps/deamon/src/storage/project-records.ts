export type TaskStatus = "BACKLOG" | "RUNNING" | "COMPLETED" | "CANCELLED";

export type FileContextKind = "file" | "directory" | "path";

export interface VersionedRecord {
  id: string;
  record_id: string;
  snapshot_id: string;
  previous_revision_id: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
  object_hash?: string | null;
}

export interface DocumentRecord extends VersionedRecord {
  title: string;
  content: string;
}

export interface ProjectPromptRecord extends VersionedRecord {
  prompt: string;
}

export interface ChangeRecord extends VersionedRecord {
  note: string;
  document_id: string | null;
}

export interface TaskRecord extends VersionedRecord {
  title: string;
  description: string | null;
  document_id: string | null;
  status: TaskStatus;
}

export interface FileContextRecord extends VersionedRecord {
  kind: FileContextKind;
  filename: string;
  path: string;
  hash: string;
  description: string;
}

export interface SnapshotRecord {
  id: string;
  message: string | null;
  created_at: number;
  object_hash?: string | null;
}

export interface SnapshotParentRecord {
  snapshot_id: string;
  parent_snapshot_id: string;
  parent_order: number;
}

export interface SnapshotSummary extends SnapshotRecord {
  parents: SnapshotParentRecord[];
  branch_labels: string[];
  is_merge: boolean;
}

export interface ChangedField {
  field: string;
  before: unknown;
  after: unknown;
}

export interface SnapshotDiffChange {
  entity_type: EntityType;
  record_id: string;
  type: "created" | "updated" | "deleted";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changed_fields: ChangedField[];
}

export interface SnapshotDiff {
  from_snapshot_id: string;
  to_snapshot_id: string;
  changes: SnapshotDiffChange[];
}

export interface BranchRecord {
  name: string;
  snapshot_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface RemoteRecord {
  name: string;
  url: string;
  created_at: number;
  updated_at: number;
}

export interface RemoteRefRecord {
  remote_name: string;
  name: string;
  snapshot_id: string | null;
  updated_at: number;
}

export interface BranchUpstreamRecord {
  branch_name: string;
  remote_name: string;
  remote_branch: string;
  created_at: number;
  updated_at: number;
}

export type EntityType =
  | "project_prompt"
  | "document"
  | "change_note"
  | "task"
  | "file_context";

export interface SnapshotOptions {
  message?: string | null;
}

export interface MergeConflict {
  entity_type: EntityType;
  record_id: string;
  type: "FIELD_CONFLICT" | "DELETE_UPDATE" | "CREATE_CREATE";
  field?: string;
  base_value?: unknown;
  source_value?: unknown;
  target_value?: unknown;
}

export interface MergeChange {
  entity_type: EntityType;
  record_id: string;
  value: VersionedRecord | null;
}

export interface MergePreview {
  source_branch: string;
  target_branch: string;
  base_snapshot_id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  changes: MergeChange[];
  conflicts: MergeConflict[];
}

export type MergeResolution =
  | "source"
  | "target"
  | { source: true }
  | { target: true }
  | { custom: unknown };

export type MergeResolutions = Record<string, MergeResolution>;

export interface MergeApplyResult extends MergePreview {
  snapshot: SnapshotRecord;
}
