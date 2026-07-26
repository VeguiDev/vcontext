export type TaskStatus = "BACKLOG" | "RUNNING" | "COMPLETED" | "CANCELLED";

export type FileContextKind = "file" | "directory" | "path";

export type FileOutsideLinkKind =
  | "lib"
  | "sdk"
  | "api"
  | "dependency"
  | "external_call"
  | "import";

export type FileOutsideLinkTargetType = "file" | "directory" | "project";

export interface VersionedRecord {
  readonly id: string;
  readonly record_id: string;
  readonly snapshot_id: string;
  readonly previous_revision_id: string | null;
  readonly deleted_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface RegisteredProjectRecord {
  readonly id: number;
  readonly uuid: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface TaskRecord extends VersionedRecord {
  readonly project_id: number;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly document_id: string | null;
}

export interface DocumentRecord extends VersionedRecord {
  readonly project_id: number;
  readonly title: string;
  readonly content: string;
}

export interface ChangeRecord extends VersionedRecord {
  readonly project_id: number;
  readonly note: string;
  readonly document_id: string | null;
}

export interface FileContextRecord extends VersionedRecord {
  readonly project_id: number;
  readonly path: string;
  readonly kind: string | null;
  readonly filename: string | null;
  readonly hash: string | null;
  readonly description: string;
}

export interface ProjectPromptRecord extends VersionedRecord {
  readonly prompt: string;
}

export interface FileOutsideLinkRecord extends VersionedRecord {
  readonly source_file_context_id: string | null;
  readonly target_project_slug: string;
  readonly target_path: string | null;
  readonly target_type: FileOutsideLinkTargetType;
  readonly target_branch_name: string | null;
  readonly target_snapshot_id: string | null;
  readonly kind: FileOutsideLinkKind;
  readonly description: string;
}

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string;
  readonly document_id?: string | null;
  readonly status?: TaskStatus;
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly document_id?: string | null;
  readonly status?: TaskStatus;
}

export interface CreateDocumentInput {
  readonly title: string;
  readonly content: string;
}

export interface UpdateDocumentInput {
  readonly title?: string;
  readonly content?: string;
}

export interface CreateChangeInput {
  readonly note: string;
  readonly document_id?: string | null;
}

export interface UpsertFileContextInput {
  readonly path: string;
  readonly kind?: FileContextKind;
  readonly filename?: string;
  readonly hash?: string;
  readonly description: string;
}

export interface CreatePromptInput {
  readonly prompt: string;
}

export interface UpdatePromptInput {
  readonly prompt: string;
}

export interface RenderOpts {
  readonly compact?: boolean;
  readonly cwd?: string;
}

export interface ProjectLocator {
  readonly project_slug?: string;
  readonly slug?: string;
  readonly cwd?: string;
}

export interface ReadSelector extends ProjectLocator {
  readonly branch?: string;
  readonly snapshot_id?: string;
}

export interface WriteSelector extends ProjectLocator {
  readonly branch?: string;
  readonly message?: string | null;
}

export type EntityName =
  | "document"
  | "project_prompt"
  | "task"
  | "change_note"
  | "file_context"
  | "file_outside_link";

export interface MergeApplyInput extends ProjectLocator {
  readonly source_branch: string;
  readonly target_branch?: string;
  readonly strategy?: "manual" | "source" | "target";
  readonly resolutions?: Record<string, unknown>;
  readonly message?: string | null;
}

export interface MigrationSummary {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly state?: "applied" | "pending";
  readonly checksum_state?: "valid" | "mismatch" | "unknown";
  readonly post_migration_state?: "complete" | "incomplete";
  readonly applied_at?: number;
  readonly requires_backup?: boolean;
}

export interface ProjectMigrationStatusRecord {
  readonly project_slug: string;
  readonly current_version: string;
  readonly latest_version: string;
  readonly applied: readonly MigrationSummary[];
  readonly pending: readonly MigrationSummary[];
  readonly checksum_state: "valid" | "invalid";
  readonly incomplete_post_migrations: readonly string[];
  readonly backup_paths: readonly string[];
}

export interface ProjectMigrationListRecord {
  readonly project_slug: string;
  readonly current_version: string;
  readonly latest_version: string;
  readonly migrations: readonly MigrationSummary[];
}

export interface TaskStore {
  list(): Promise<readonly TaskRecord[]>;
  add(input: CreateTaskInput): Promise<TaskRecord>;
  update(recordId: string, input: UpdateTaskInput): Promise<TaskRecord | null>;
  delete(recordId: string): Promise<boolean>;
}

export interface DocumentStore {
  list(): Promise<readonly DocumentRecord[]>;
  get(recordId: string): Promise<DocumentRecord | null>;
  add(input: CreateDocumentInput): Promise<DocumentRecord>;
  update(
    recordId: string,
    input: UpdateDocumentInput,
  ): Promise<DocumentRecord | null>;
  delete(recordId: string): Promise<boolean>;
}

export interface ChangeStore {
  list(): Promise<readonly ChangeRecord[]>;
  add(input: CreateChangeInput): Promise<ChangeRecord>;
}

export interface FileContextStore {
  list(): Promise<readonly FileContextRecord[]>;
  upsert(input: UpsertFileContextInput): Promise<FileContextRecord>;
  delete(recordId: string): Promise<boolean>;
}

export interface PromptStore {
  list(): Promise<readonly ProjectPromptRecord[]>;
  add(input: CreatePromptInput): Promise<ProjectPromptRecord>;
  update(
    recordId: string,
    input: UpdatePromptInput,
  ): Promise<ProjectPromptRecord | null>;
  delete(recordId: string): Promise<boolean>;
}

export interface ProjectHandle {
  readonly tasks: TaskStore;
  readonly documents: DocumentStore;
  readonly changes: ChangeStore;
  readonly fileContexts: FileContextStore;
  readonly prompts: PromptStore;
}

export interface VContextAPI {
  listProjects(): Promise<readonly RegisteredProjectRecord[]>;
  getProject(slug?: string): Promise<ProjectHandle>;
  renderContext(slug?: string, opts?: RenderOpts): Promise<string>;
  migrationStatus(slug?: string): Promise<ProjectMigrationStatusRecord>;
  migrationList(slug?: string): Promise<ProjectMigrationListRecord>;
  projectStatus(locator: ProjectLocator): Promise<unknown>;
  entityList(
    entity: EntityName,
    selector: ReadSelector,
    status?: TaskStatus,
  ): Promise<readonly unknown[]>;
  entityGet(
    entity: EntityName,
    recordId: string,
    selector: ReadSelector,
  ): Promise<unknown>;
  entityHistory(
    entity: EntityName,
    recordId: string,
    selector: ReadSelector,
  ): Promise<readonly unknown[]>;
  entityAdd(
    entity: EntityName,
    input: Record<string, unknown>,
    selector: WriteSelector,
  ): Promise<unknown>;
  entityUpdate(
    entity: EntityName,
    recordId: string,
    input: Record<string, unknown>,
    selector: WriteSelector,
  ): Promise<unknown>;
  entityDelete(
    entity: EntityName,
    recordId: string,
    selector: WriteSelector,
  ): Promise<unknown>;
  fileContextUpsert(
    input: Record<string, unknown>,
    selector: WriteSelector,
  ): Promise<unknown>;
  fileContextByPath(path: string, selector: ReadSelector): Promise<unknown>;
  branchList(locator: ProjectLocator): Promise<readonly unknown[]>;
  branchCurrent(locator: ProjectLocator): Promise<unknown>;
  branchGet(name: string, locator: ProjectLocator): Promise<unknown>;
  branchCreate(
    name: string,
    from: string | undefined,
    locator: ProjectLocator,
  ): Promise<unknown>;
  branchCheckout(name: string, locator: ProjectLocator): Promise<unknown>;
  branchRename(
    name: string,
    newName: string,
    locator: ProjectLocator,
  ): Promise<unknown>;
  branchDelete(name: string, locator: ProjectLocator): Promise<unknown>;
  snapshotList(
    selector: ReadSelector,
    limit?: number,
  ): Promise<readonly unknown[]>;
  snapshotGet(snapshotId: string, locator: ProjectLocator): Promise<unknown>;
  snapshotDiff(
    snapshotId: string,
    from: string | undefined,
    locator: ProjectLocator,
  ): Promise<unknown>;
  snapshotCheckout(
    snapshotId: string,
    branch: string,
    locator: ProjectLocator,
  ): Promise<unknown>;
  log(selector: ReadSelector, limit?: number): Promise<readonly unknown[]>;
  diff(
    from: string | undefined,
    to: string | undefined,
    locator: ProjectLocator,
  ): Promise<unknown>;
  mergePreview(
    sourceBranch: string,
    targetBranch: string | undefined,
    locator: ProjectLocator,
  ): Promise<unknown>;
  mergeApply(input: MergeApplyInput): Promise<unknown>;
  linksList(locator: ProjectLocator): Promise<readonly unknown[]>;
  linksAdd(
    locator: ProjectLocator,
    projectBSlug: string,
    branchName?: string,
    snapshotId?: string,
  ): Promise<unknown>;
  linksRemove(
    locator: ProjectLocator,
    projectBSlug: string,
    branchName?: string,
    snapshotId?: string,
  ): Promise<unknown>;
  outsideLinksList(
    selector: ReadSelector,
    sourceFileContextId?: string,
  ): Promise<readonly unknown[]>;
  outsideLinksAdd(
    input: Record<string, unknown>,
    selector: WriteSelector,
  ): Promise<unknown>;
  outsideLinksGet(
    recordId: string,
    selector: ReadSelector,
  ): Promise<unknown>;
  outsideLinksUpdate(
    recordId: string,
    input: Record<string, unknown>,
    selector: WriteSelector,
  ): Promise<unknown>;
  outsideLinksDelete(
    recordId: string,
    selector: WriteSelector,
  ): Promise<unknown>;
}
