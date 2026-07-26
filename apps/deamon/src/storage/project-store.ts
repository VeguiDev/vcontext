import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { Database } from "./database.js";
import { GitAwareStore } from "./git-aware-store.js";
import { projectConfigPath } from "./paths.js";
import {
  readProjectJson,
  updateProjectJson,
} from "../project/project-metadata.js";
import type { RegisteredProject } from "./registry-store.js";
import {
  ENTITY_FIELDS,
  ENTITY_TYPES,
  SnapshotStateResolver,
  type EntityRecordMap,
} from "./snapshot-state.js";
import type {
  BranchRecord,
  EntityType,
  FileContextKind,
  FileContextRecord,
  FileOutsideLinkKind,
  FileOutsideLinkRecord,
  FileOutsideLinkTargetType,
  MergeApplyResult,
  MergeChange,
  MergeConflict,
  MergePreview,
  MergeResolution,
  MergeResolutions,
  RemoteRecord,
  RemoteRefRecord,
  BranchUpstreamRecord,
  SnapshotDiff,
  SnapshotOptions,
  SnapshotParentRecord,
  SnapshotRecord,
  SnapshotSummary,
  TaskStatus,
  VersionedRecord,
} from "./project-records.js";

export * from "./project-records.js";

export type EntityCreateInputMap = {
  project_prompt: { prompt: string };
  document: { title: string; content: string };
  change_note: { note: string; document_id?: string | null };
  task: {
    title: string;
    description?: string;
    document_id?: string | null;
    status?: TaskStatus;
  };
  file_context: {
    path: string;
    kind?: FileContextKind;
    filename?: string;
    hash?: string;
    description: string;
  };
  file_outside_link: {
    source_file_context_id?: string | null;
    target_project_slug: string;
    target_path?: string | null;
    target_type?: FileOutsideLinkTargetType;
    target_branch_name?: string | null;
    target_snapshot_id?: string | null;
    kind?: FileOutsideLinkKind;
    description: string;
  };
};

export type EntityUpdateInputMap = {
  project_prompt: { prompt?: string };
  document: { title?: string; content?: string };
  change_note: { note?: string; document_id?: string | null };
  task: {
    title?: string;
    description?: string | null;
    document_id?: string | null;
    status?: TaskStatus;
  };
  file_context: {
    path?: string;
    kind?: FileContextKind;
    filename?: string;
    hash?: string;
    description?: string;
  };
  file_outside_link: {
    source_file_context_id?: string | null;
    target_project_slug?: string;
    target_path?: string | null;
    target_type?: FileOutsideLinkTargetType;
    target_branch_name?: string | null;
    target_snapshot_id?: string | null;
    kind?: FileOutsideLinkKind;
    description?: string;
  };
};

interface ProjectConfig {
  current_branch: string;
}

const PROJECT_STORE_ACCESS = Symbol("migrated-project-store");

export class ProjectStore {
  readonly db: Database;
  readonly resolver: SnapshotStateResolver;
  readonly branches: ProjectBranchesStore;
  readonly remotes: ProjectRemotesStore;
  readonly merge: ProjectMergeStore;
  readonly gitAware: GitAwareStore;
  private readonly configPath: string;

  private constructor(
    readonly project: RegisteredProject,
    database: Database,
  ) {
    this.db = database;
    this.resolver = new SnapshotStateResolver(this.db);
    this.configPath = projectConfigPath(project.slug);
    this.ensureConfig();
    this.branches = new ProjectBranchesStore(this);
    this.remotes = new ProjectRemotesStore(this);
    this.merge = new ProjectMergeStore(this);
    this.gitAware = new GitAwareStore(this.db);
  }

  static fromMigratedDatabase(
    project: RegisteredProject,
    database: Database,
    access: symbol,
  ) {
    if (access !== PROJECT_STORE_ACCESS) {
      throw new Error("ProjectStore must be opened through ProjectService");
    }
    return new ProjectStore(project, database);
  }

  get current_branch() {
    return this.readConfig().current_branch;
  }

  branch(name?: string) {
    return new ProjectBranchStore(this, name ?? this.current_branch);
  }

  snapshot(snapshotId: string) {
    this.requireSnapshot(snapshotId);
    return new ProjectSnapshotStore(this, snapshotId);
  }

  close() {
    this.db.close();
  }

  requireBranch(name: string) {
    const branch = this.db
      .prepare("SELECT * FROM branch WHERE name = ? LIMIT 1")
      .get(name) as BranchRecord | undefined;
    if (!branch) throw new Error(`Branch "${name}" does not exist`);
    return branch;
  }

  requireSnapshot(id: string) {
    const snapshot = this.db
      .prepare("SELECT * FROM snapshot WHERE id = ? LIMIT 1")
      .get(id) as SnapshotRecord | undefined;
    if (!snapshot) throw new Error(`Snapshot "${id}" does not exist`);
    return snapshot;
  }

  requireBranchHead(name: string) {
    const branch = this.requireBranch(name);
    if (branch.snapshot_id === null) {
      throw new Error(`Branch "${name}" is unborn`);
    }
    return branch.snapshot_id;
  }

  snapshotParents(id: string) {
    this.requireSnapshot(id);
    return this.db
      .prepare(
        `SELECT snapshot_id, parent_snapshot_id, parent_order
         FROM snapshot_parent WHERE snapshot_id = ? ORDER BY parent_order ASC`,
      )
      .all(id) as SnapshotParentRecord[];
  }

  snapshotSummary(id: string): SnapshotSummary {
    const snapshot = this.requireSnapshot(id);
    const parents = this.snapshotParents(id);
    const labels = this.db
      .prepare(
        "SELECT name FROM branch WHERE snapshot_id = ? ORDER BY name ASC",
      )
      .all(id) as Array<{ name: string }>;
    return {
      ...snapshot,
      parents,
      branch_labels: labels.map((label) => label.name),
      is_merge: parents.length > 1,
    };
  }

  walkSnapshots(startId: string): SnapshotSummary[] {
    this.requireSnapshot(startId);
    const rows = this.db
      .prepare(
        `WITH RECURSIVE reachable(id) AS (
           SELECT ?
           UNION
           SELECT parent.parent_snapshot_id
           FROM snapshot_parent parent JOIN reachable ON parent.snapshot_id = reachable.id
         )
         SELECT snapshot.id FROM snapshot JOIN reachable ON reachable.id = snapshot.id
         ORDER BY snapshot.created_at DESC, snapshot.id DESC`,
      )
      .all(startId) as Array<{ id: string }>;
    return rows.map((row) => this.snapshotSummary(row.id));
  }

  resolveReference(reference: string): string {
    const branchPrefix = "branch:";
    const snapshotPrefix = "snapshot:";
    if (reference.startsWith(branchPrefix)) {
      return this.requireBranchHead(reference.slice(branchPrefix.length));
    }
    if (reference.startsWith(snapshotPrefix)) {
      return this.requireSnapshot(reference.slice(snapshotPrefix.length)).id;
    }
    const branch = this.branches.findByName(reference);
    const snapshot = this.db
      .prepare("SELECT id FROM snapshot WHERE id = ? LIMIT 1")
      .get(reference) as { id: string } | undefined;
    if (branch && snapshot) {
      throw new Error(
        `Reference "${reference}" is ambiguous; use branch:${reference} or snapshot:${reference}`,
      );
    }
    const remoteRef = this.db
      .prepare(
        `SELECT snapshot_id FROM remote_ref
         WHERE remote_name || '/' || name = ? LIMIT 1`,
      )
      .get(reference) as { snapshot_id: string | null } | undefined;
    if (branch) return this.requireBranchHead(branch.name);
    if (remoteRef) {
      if (remoteRef.snapshot_id === null)
        throw new Error(`Remote reference "${reference}" is unborn`);
      return remoteRef.snapshot_id;
    }
    if (snapshot) return snapshot.id;
    throw new Error(`Reference "${reference}" does not exist`);
  }

  diff(fromSnapshotId: string, toSnapshotId: string): SnapshotDiff {
    this.requireSnapshot(fromSnapshotId);
    this.requireSnapshot(toSnapshotId);
    const from = this.resolver.resolveAll(fromSnapshotId);
    const to = this.resolver.resolveAll(toSnapshotId);
    const changes: SnapshotDiff["changes"] = [];
    for (const entityType of ENTITY_TYPES) {
      const ids = new Set([
        ...from.get(entityType)!.keys(),
        ...to.get(entityType)!.keys(),
      ]);
      for (const recordId of [...ids].sort()) {
        const beforeRevision = from.get(entityType)!.get(recordId) ?? null;
        const afterRevision = to.get(entityType)!.get(recordId) ?? null;
        const before = beforeRevision
          ? businessData(entityType, beforeRevision)
          : null;
        const after = afterRevision
          ? businessData(entityType, afterRevision)
          : null;
        if (sameValue(before, after)) continue;
        const changedFields = ENTITY_FIELDS[entityType]
          .filter(
            (field) =>
              !sameValue(before?.[field] ?? null, after?.[field] ?? null),
          )
          .map((field) => ({
            field,
            before: before?.[field] ?? null,
            after: after?.[field] ?? null,
          }));
        changes.push({
          entity_type: entityType,
          record_id: recordId,
          type:
            before === null
              ? "created"
              : after === null
                ? "deleted"
                : "updated",
          before,
          after,
          changed_fields: changedFields,
        });
      }
    }
    return {
      from_snapshot_id: fromSnapshotId,
      to_snapshot_id: toSnapshotId,
      changes,
    };
  }

  writeCurrentBranch(name: string) {
    this.writeConfig({ current_branch: name });
  }

  assertGitWritable() {
    const state = this.db.prepare("SELECT mode, warning FROM git_state WHERE singleton = 1").get() as { mode: string; warning: string | null } | undefined;
    if (state?.mode === "detached") throw new Error(state.warning ?? "VContext writes are disabled while Git HEAD is detached");
  }

  createEntity<T extends EntityType>(
    branchName: string,
    entityType: T,
    input: EntityCreateInputMap[T],
    options?: SnapshotOptions,
  ): EntityRecordMap[T] {
    this.assertGitWritable();
    return this.db.transaction(() => {
      const branch = this.requireBranch(branchName);
      const now = Date.now();
      const data = normalizeCreate(entityType, input);
      validateDocumentReference(this, branch.snapshot_id, entityType, data);
      const snapshot = this.insertSnapshot(
        branch.snapshot_id ? [branch.snapshot_id] : [],
        options?.message === undefined
          ? defaultMessage("Create", entityType, data)
          : options.message,
        now,
      );
      const recordId = randomUUID();
      this.insertRecordIdentity(recordId, entityType, now);
      const record = this.insertRevision(entityType, {
        id: randomUUID(),
        record_id: recordId,
        snapshot_id: snapshot.id,
        previous_revision_id: null,
        deleted_at: null,
        ...data,
        created_at: now,
        updated_at: now,
      });
      this.moveBranch(branchName, branch.snapshot_id, snapshot.id, now);
      return record;
    })();
  }

  updateEntity<T extends EntityType>(
    branchName: string,
    entityType: T,
    recordId: string,
    input: EntityUpdateInputMap[T],
    options?: SnapshotOptions,
  ): EntityRecordMap[T] | null {
    this.assertGitWritable();
    return this.db.transaction(() => {
      const branch = this.requireBranch(branchName);
      if (branch.snapshot_id === null) return null;
      const current = this.resolver.findByRecordId(
        branch.snapshot_id,
        entityType,
        recordId,
      );
      if (!current) return null;
      const now = Date.now();
      const data = {
        ...businessData(entityType, current),
        ...definedValues(input as Record<string, unknown>),
      };
      validateDocumentReference(this, branch.snapshot_id, entityType, data);
      const snapshot = this.insertSnapshot(
        [branch.snapshot_id],
        options?.message === undefined
          ? defaultMessage("Update", entityType, data)
          : options.message,
        now,
      );
      const record = this.insertRevision(entityType, {
        id: randomUUID(),
        record_id: current.record_id,
        snapshot_id: snapshot.id,
        previous_revision_id: current.id,
        deleted_at: null,
        ...data,
        created_at: current.created_at,
        updated_at: now,
      });
      this.moveBranch(branchName, branch.snapshot_id, snapshot.id, now);
      return record;
    })();
  }

  deleteEntity<T extends EntityType>(
    branchName: string,
    entityType: T,
    recordId: string,
    options?: SnapshotOptions,
  ) {
    this.assertGitWritable();
    return this.db.transaction(() => {
      const branch = this.requireBranch(branchName);
      if (branch.snapshot_id === null) return false;
      const current = this.resolver.findByRecordId(
        branch.snapshot_id,
        entityType,
        recordId,
      );
      if (!current) return false;
      const now = Date.now();
      const data = businessData(entityType, current);
      const snapshot = this.insertSnapshot(
        [branch.snapshot_id],
        options?.message === undefined
          ? defaultMessage("Delete", entityType, data)
          : options.message,
        now,
      );
      this.insertRevision(entityType, {
        id: randomUUID(),
        record_id: current.record_id,
        snapshot_id: snapshot.id,
        previous_revision_id: current.id,
        deleted_at: now,
        ...data,
        created_at: current.created_at,
        updated_at: now,
      });
      this.moveBranch(branchName, branch.snapshot_id, snapshot.id, now);
      return true;
    })();
  }

  upsertFileContext(
    branchName: string,
    input: EntityCreateInputMap["file_context"],
    options?: SnapshotOptions,
  ) {
    this.assertGitWritable();
    return this.db.transaction(() => {
      const branch = this.requireBranch(branchName);
      const current = branch.snapshot_id
        ? this.resolver
            .resolve(branch.snapshot_id, "file_context")
            .find((record) => record.path === input.path)
        : undefined;
      const now = Date.now();
      const data = current
        ? {
            ...businessData("file_context", current),
            ...definedValues(input),
            filename: input.filename ?? current.filename,
          }
        : normalizeCreate("file_context", input);
      const snapshot = this.insertSnapshot(
        branch.snapshot_id ? [branch.snapshot_id] : [],
        options?.message === undefined
          ? defaultMessage(current ? "Update" : "Create", "file_context", data)
          : options.message,
        now,
      );
      const recordId = current?.record_id ?? randomUUID();
      if (!current) this.insertRecordIdentity(recordId, "file_context", now);
      const record = this.insertRevision("file_context", {
        id: randomUUID(),
        record_id: recordId,
        snapshot_id: snapshot.id,
        previous_revision_id: current?.id ?? null,
        deleted_at: null,
        ...data,
        created_at: current?.created_at ?? now,
        updated_at: now,
      });
      this.moveBranch(branchName, branch.snapshot_id, snapshot.id, now);
      return record;
    })();
  }

  insertSnapshot(
    parents: string[],
    message: string | null,
    createdAt = Date.now(),
  ) {
    const snapshot: SnapshotRecord = {
      id: randomUUID(),
      message,
      created_at: createdAt,
    };
    this.db
      .prepare(
        "INSERT INTO snapshot (id, message, created_at) VALUES (?, ?, ?)",
      )
      .run(snapshot.id, snapshot.message, snapshot.created_at);
    this.db.prepare(`INSERT INTO snapshot_metadata
      (snapshot_id, author_cloud_id, author_name, author_email, git_commit_sha,
       git_branch, git_dirty, commit_message, version, created_at, updated_at)
      VALUES (?, NULL, ?, ?, NULL, ?, 0, ?, 1, ?, ?)`)
      .run(
        snapshot.id,
        process.env.VCONTEXT_AUTHOR_NAME ?? process.env.GIT_AUTHOR_NAME ?? "Local author",
        process.env.VCONTEXT_AUTHOR_EMAIL ?? process.env.GIT_AUTHOR_EMAIL ?? null,
        this.current_branch,
        snapshot.message,
        snapshot.created_at,
        snapshot.created_at,
      );
    const insertParent = this.db.prepare(
      `INSERT INTO snapshot_parent (snapshot_id, parent_snapshot_id, parent_order)
       VALUES (?, ?, ?)`,
    );
    parents.forEach((parentId, order) =>
      insertParent.run(snapshot.id, parentId, order),
    );
    return snapshot;
  }

  insertRevision<T extends EntityType>(
    entityType: T,
    value: Record<string, unknown>,
  ): EntityRecordMap[T] {
    const columns = [
      "id",
      "record_id",
      "snapshot_id",
      "previous_revision_id",
      "deleted_at",
      ...ENTITY_FIELDS[entityType],
      "created_at",
      "updated_at",
    ];
    return this.db
      .prepare(
        `INSERT INTO ${entityType} (${columns.join(", ")})
         VALUES (${columns.map(() => "?").join(", ")})
         RETURNING *`,
      )
      .get(...columns.map((column) => value[column])) as EntityRecordMap[T];
  }

  insertRecordIdentity(recordId: string, entityType: EntityType, createdAt: number) {
    this.db.prepare(
      `INSERT INTO record_identity (record_id, entity_type, created_at)
       VALUES (?, ?, ?)`,
    ).run(recordId, entityType, createdAt);
  }

  moveBranch(
    name: string,
    previousSnapshotId: string | null,
    snapshotId: string,
    now: number,
  ) {
    const result = this.db
      .prepare(
        `UPDATE branch SET snapshot_id = ?, updated_at = ?
         WHERE name = ? AND snapshot_id IS ?`,
      )
      .run(snapshotId, now, name, previousSnapshotId);
    if (result.changes !== 1) {
      throw new Error(`Branch "${name}" changed during the transaction`);
    }
  }

  private ensureConfig() {
    if (!fs.existsSync(this.configPath)) {
      this.writeConfig({ current_branch: "main" });
      return;
    }
    const config = this.readConfig();
    const exists = this.db
      .prepare("SELECT 1 FROM branch WHERE name = ?")
      .get(config.current_branch);
    if (!exists) this.writeConfig({ current_branch: "main" });
  }

  private readConfig(): ProjectConfig {
    try {
      const value = readProjectJson(this.configPath);
      if (typeof value.current_branch !== "string") {
        throw new Error("current_branch must be a string");
      }
      return { current_branch: value.current_branch };
    } catch (error) {
      throw new Error(
        `Invalid project config at ${this.configPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private writeConfig(config: ProjectConfig) {
    updateProjectJson(this.configPath, config);
  }
}

export function createMigratedProjectStore(
  project: RegisteredProject,
  database: Database,
) {
  return ProjectStore.fromMigratedDatabase(
    project,
    database,
    PROJECT_STORE_ACCESS,
  );
}

export class ProjectSnapshotStore {
  readonly prompt: VersionedReadStore<"project_prompt">;
  readonly document: VersionedReadStore<"document">;
  readonly change: VersionedReadStore<"change_note">;
  readonly task: TaskReadStore;
  readonly fileContext: VersionedReadStore<"file_context">;
  readonly fileOutsideLink: FileOutsideLinkSnapshotStore;

  constructor(
    readonly projectStore: ProjectStore,
    readonly snapshot_id: string,
  ) {
    this.prompt = new VersionedReadStore(
      projectStore,
      snapshot_id,
      "project_prompt",
    );
    this.document = new VersionedReadStore(
      projectStore,
      snapshot_id,
      "document",
    );
    this.change = new VersionedReadStore(
      projectStore,
      snapshot_id,
      "change_note",
    );
    this.task = new TaskReadStore(projectStore, snapshot_id);
    this.fileContext = new VersionedReadStore(
      projectStore,
      snapshot_id,
      "file_context",
    );
    this.fileOutsideLink = new FileOutsideLinkSnapshotStore(
      projectStore,
      snapshot_id,
      "file_outside_link",
    );
  }
}

export class ProjectBranchStore {
  readonly prompt: VersionedBranchEntityStore<"project_prompt">;
  readonly document: VersionedBranchEntityStore<"document">;
  readonly change: VersionedBranchEntityStore<"change_note">;
  readonly task: TaskBranchStore;
  readonly fileContext: FileContextBranchStore;
  readonly fileOutsideLink: FileOutsideLinkBranchStore;

  constructor(
    readonly projectStore: ProjectStore,
    readonly name: string,
  ) {
    projectStore.requireBranch(name);
    this.prompt = new VersionedBranchEntityStore(
      projectStore,
      name,
      "project_prompt",
    );
    this.document = new VersionedBranchEntityStore(
      projectStore,
      name,
      "document",
    );
    this.change = new VersionedBranchEntityStore(
      projectStore,
      name,
      "change_note",
    );
    this.task = new TaskBranchStore(projectStore, name);
    this.fileContext = new FileContextBranchStore(projectStore, name);
    this.fileOutsideLink = new FileOutsideLinkBranchStore(
      projectStore,
      name,
    );
  }

  get snapshot_id() {
    return this.projectStore.requireBranch(this.name).snapshot_id;
  }
}

export class VersionedReadStore<T extends EntityType> {
  constructor(
    protected readonly store: ProjectStore,
    protected readonly snapshotId: string | null,
    readonly entityType: T,
  ) {}

  find(): Array<EntityRecordMap[T]> {
    if (this.snapshotId === null) return [];
    return sortRecords(
      this.entityType,
      this.store.resolver.resolve(this.snapshotId, this.entityType),
    );
  }

  findByRecordId(recordId: string) {
    if (this.snapshotId === null) return null;
    return this.store.resolver.findByRecordId(
      this.snapshotId,
      this.entityType,
      recordId,
    );
  }

  findRevisionById(revisionId: string) {
    return this.store.resolver.findRevisionById(this.entityType, revisionId);
  }

  history(recordId: string) {
    if (this.snapshotId === null) return [];
    return this.store.resolver.history(
      this.snapshotId,
      this.entityType,
      recordId,
    );
  }
}

export class VersionedBranchEntityStore<
  T extends Exclude<EntityType, "file_context" | "task">,
> extends VersionedReadStore<T> {
  constructor(
    store: ProjectStore,
    readonly branchName: string,
    entityType: T,
  ) {
    super(store, store.requireBranch(branchName).snapshot_id, entityType);
  }

  private currentSnapshotId() {
    return this.store.requireBranch(this.branchName).snapshot_id;
  }

  override find() {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return [];
    return sortRecords(
      this.entityType,
      this.store.resolver.resolve(snapshotId, this.entityType),
    );
  }

  override findByRecordId(recordId: string) {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return null;
    return this.store.resolver.findByRecordId(
      snapshotId,
      this.entityType,
      recordId,
    );
  }

  override history(recordId: string) {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return [];
    return this.store.resolver.history(
      snapshotId,
      this.entityType,
      recordId,
    );
  }

  create(input: EntityCreateInputMap[T], options?: SnapshotOptions) {
    return this.store.createEntity(
      this.branchName,
      this.entityType,
      input,
      options,
    );
  }

  update(
    recordId: string,
    input: EntityUpdateInputMap[T],
    options?: SnapshotOptions,
  ) {
    return this.store.updateEntity(
      this.branchName,
      this.entityType,
      recordId,
      input,
      options,
    );
  }

  delete(recordId: string, options?: SnapshotOptions) {
    return this.store.deleteEntity(
      this.branchName,
      this.entityType,
      recordId,
      options,
    );
  }
}

export class TaskReadStore extends VersionedReadStore<"task"> {
  constructor(store: ProjectStore, snapshotId: string | null) {
    super(store, snapshotId, "task");
  }

  find(status?: TaskStatus) {
    const records = super.find();
    return status
      ? records.filter((record) => record.status === status)
      : records;
  }
}

export class TaskBranchStore extends TaskReadStore {
  constructor(
    store: ProjectStore,
    readonly branchName: string,
  ) {
    super(store, store.requireBranch(branchName).snapshot_id);
  }

  private currentSnapshotId() {
    return this.store.requireBranch(this.branchName).snapshot_id;
  }

  override find(status?: TaskStatus) {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return [];
    const records = sortRecords(
      "task",
      this.store.resolver.resolve(snapshotId, "task"),
    );
    return status
      ? records.filter((record) => record.status === status)
      : records;
  }

  override findByRecordId(recordId: string) {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return null;
    return this.store.resolver.findByRecordId(
      snapshotId,
      "task",
      recordId,
    );
  }

  override history(recordId: string) {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return [];
    return this.store.resolver.history(
      snapshotId,
      "task",
      recordId,
    );
  }

  create(input: EntityCreateInputMap["task"], options?: SnapshotOptions) {
    return this.store.createEntity(this.branchName, "task", input, options);
  }

  update(
    recordId: string,
    input: EntityUpdateInputMap["task"],
    options?: SnapshotOptions,
  ) {
    return this.store.updateEntity(
      this.branchName,
      "task",
      recordId,
      input,
      options,
    );
  }

  delete(recordId: string, options?: SnapshotOptions) {
    return this.store.deleteEntity(this.branchName, "task", recordId, options);
  }
}

export class FileContextBranchStore extends VersionedReadStore<"file_context"> {
  constructor(
    store: ProjectStore,
    readonly branchName: string,
  ) {
    super(store, store.requireBranch(branchName).snapshot_id, "file_context");
  }

  private currentSnapshotId() {
    return this.store.requireBranch(this.branchName).snapshot_id;
  }

  override find() {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return [];
    return sortRecords(
      "file_context",
      this.store.resolver.resolve(snapshotId, "file_context"),
    );
  }

  override findByRecordId(recordId: string) {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return null;
    return this.store.resolver.findByRecordId(
      snapshotId,
      "file_context",
      recordId,
    );
  }

  override history(recordId: string) {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return [];
    return this.store.resolver.history(
      snapshotId,
      "file_context",
      recordId,
    );
  }

  create(
    input: EntityCreateInputMap["file_context"],
    options?: SnapshotOptions,
  ) {
    return this.store.createEntity(
      this.branchName,
      "file_context",
      input,
      options,
    );
  }

  update(
    recordId: string,
    input: EntityUpdateInputMap["file_context"],
    options?: SnapshotOptions,
  ) {
    return this.store.updateEntity(
      this.branchName,
      "file_context",
      recordId,
      input,
      options,
    );
  }

  upsert(
    input: EntityCreateInputMap["file_context"],
    options?: SnapshotOptions,
  ) {
    return this.store.upsertFileContext(this.branchName, input, options);
  }

  delete(recordId: string, options?: SnapshotOptions) {
    return this.store.deleteEntity(
      this.branchName,
      "file_context",
      recordId,
      options,
    );
  }
}

export class FileOutsideLinkSnapshotStore extends VersionedReadStore<"file_outside_link"> {
  find(options?: { snapshot_id: string }): FileOutsideLinkRecord[] {
    const snapshotId = options?.snapshot_id ?? this.snapshotId;
    if (snapshotId === null) return [];
    return sortRecords(
      "file_outside_link",
      this.store.resolver.resolve(snapshotId, "file_outside_link"),
    ) as FileOutsideLinkRecord[];
  }

  findByRecordId(
    recordId: string,
    options?: { snapshot_id: string },
  ): FileOutsideLinkRecord | null {
    const snapshotId = options?.snapshot_id ?? this.snapshotId;
    if (snapshotId === null) return null;
    return this.store.resolver.findByRecordId(
      snapshotId,
      "file_outside_link",
      recordId,
    ) as FileOutsideLinkRecord | null;
  }
}

export class FileOutsideLinkBranchStore extends FileOutsideLinkSnapshotStore {
  constructor(
    store: ProjectStore,
    readonly branchName: string,
  ) {
    super(store, store.requireBranch(branchName).snapshot_id, "file_outside_link");
  }

  private currentSnapshotId() {
    return this.store.requireBranch(this.branchName).snapshot_id;
  }

  override find() {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return [];
    return sortRecords(
      "file_outside_link",
      this.store.resolver.resolve(snapshotId, "file_outside_link"),
    );
  }

  override findByRecordId(recordId: string) {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return null;
    return this.store.resolver.findByRecordId(
      snapshotId,
      "file_outside_link",
      recordId,
    );
  }

  override history(recordId: string) {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return [];
    return this.store.resolver.history(
      snapshotId,
      "file_outside_link",
      recordId,
    );
  }

  create(
    input: EntityCreateInputMap["file_outside_link"],
    options?: SnapshotOptions,
  ) {
    return this.store.createEntity(
      this.branchName,
      "file_outside_link",
      input,
      options,
    );
  }

  update(
    recordId: string,
    input: EntityUpdateInputMap["file_outside_link"],
    options?: SnapshotOptions,
  ) {
    return this.store.updateEntity(
      this.branchName,
      "file_outside_link",
      recordId,
      input,
      options,
    );
  }

  delete(recordId: string, options?: SnapshotOptions) {
    return this.store.deleteEntity(
      this.branchName,
      "file_outside_link",
      recordId,
      options,
    );
  }

  findBySourceFileContext(fileContextRecordId: string) {
    const snapshotId = this.currentSnapshotId();
    if (snapshotId === null) return [];
    return (this.store.resolver.resolve(
      snapshotId,
      "file_outside_link",
    ) as FileOutsideLinkRecord[]).filter(
      (r) => r.source_file_context_id === fileContextRecordId,
    );
  }
}

export class ProjectBranchesStore {
  constructor(private readonly store: ProjectStore) {}

  find() {
    return this.store.db
      .prepare("SELECT * FROM branch ORDER BY name ASC")
      .all() as BranchRecord[];
  }

  findByName(name: string) {
    return (
      (this.store.db
        .prepare("SELECT * FROM branch WHERE name = ? LIMIT 1")
        .get(name) as BranchRecord | undefined) ?? null
    );
  }

  create(name: string, from?: string) {
    validateBranchName(name);
    if (this.findByName(name))
      throw new Error(`Branch "${name}" already exists`);
    const snapshotId = from
      ? this.resolveFrom(from)
      : this.store.branch().snapshot_id;
    const now = Date.now();
    return this.store.db
      .prepare(
        `INSERT INTO branch (name, snapshot_id, created_at, updated_at)
         VALUES (?, ?, ?, ?) RETURNING *`,
      )
      .get(name, snapshotId, now, now) as BranchRecord;
  }

  createAndCheckout(name: string, from: string) {
    const branch = this.create(name, from);
    try {
      this.store.writeCurrentBranch(name);
      return branch;
    } catch (error) {
      this.store.db.prepare("DELETE FROM branch WHERE name = ?").run(name);
      throw error;
    }
  }

  rename(oldName: string, newName: string) {
    validateBranchName(newName);
    const current = this.store.current_branch;
    this.store.requireBranch(oldName);
    if (this.findByName(newName)) {
      throw new Error(`Branch "${newName}" already exists`);
    }
    const branch = this.store.db
      .prepare(
        "UPDATE branch SET name = ?, updated_at = ? WHERE name = ? RETURNING *",
      )
      .get(newName, Date.now(), oldName) as BranchRecord;
    if (current === oldName) this.store.writeCurrentBranch(newName);
    return branch;
  }

  delete(name: string) {
    this.store.requireBranch(name);
    if (name === this.store.current_branch) {
      throw new Error("Cannot delete the currently checked-out branch");
    }
    const count = this.store.db
      .prepare("SELECT COUNT(*) AS count FROM branch")
      .get() as {
      count: number;
    };
    if (count.count <= 1)
      throw new Error("Cannot delete the last remaining branch");
    this.store.db.prepare("DELETE FROM branch WHERE name = ?").run(name);
    return true;
  }

  checkout(name: string) {
    const branch = this.store.requireBranch(name);
    this.store.writeCurrentBranch(name);
    return branch;
  }

  private resolveFrom(from: string) {
    const branch = this.findByName(from);
    if (branch) return branch.snapshot_id;
    return this.store.resolveReference(from);
  }
}

export class ProjectRemotesStore {
  constructor(private readonly store: ProjectStore) {}

  find() {
    return this.store.db.prepare("SELECT * FROM remote ORDER BY name").all() as RemoteRecord[];
  }

  findByName(name: string) {
    return (this.store.db.prepare("SELECT * FROM remote WHERE name = ?").get(name) as RemoteRecord | undefined) ?? null;
  }

  add(name: string, url: string) {
    validateRemoteName(name);
    const now = Date.now();
    return this.store.db.prepare(
      `INSERT INTO remote (name, url, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING *`,
    ).get(name, normalizeRemoteUrl(url), now, now) as RemoteRecord;
  }

  setUrl(name: string, url: string) {
    const result = this.store.db.prepare(
      `UPDATE remote SET url = ?, updated_at = ? WHERE name = ? RETURNING *`,
    ).get(normalizeRemoteUrl(url), Date.now(), name) as RemoteRecord | undefined;
    if (!result) throw new Error(`Remote "${name}" does not exist`);
    return result;
  }

  remove(name: string) {
    const result = this.store.db.prepare("DELETE FROM remote WHERE name = ?").run(name);
    if (result.changes !== 1) throw new Error(`Remote "${name}" does not exist`);
    return true;
  }

  refs(remoteName?: string) {
    const sql = remoteName
      ? "SELECT * FROM remote_ref WHERE remote_name = ? ORDER BY name"
      : "SELECT * FROM remote_ref ORDER BY remote_name, name";
    return (remoteName ? this.store.db.prepare(sql).all(remoteName) : this.store.db.prepare(sql).all()) as RemoteRefRecord[];
  }

  replaceRefs(remoteName: string, refs: Array<{ name: string; snapshot_id: string | null }>) {
    this.findByName(remoteName) ?? (() => { throw new Error(`Remote "${remoteName}" does not exist`); })();
    return this.store.db.transaction(() => {
      const now = Date.now();
      this.store.db.prepare("DELETE FROM remote_ref WHERE remote_name = ?").run(remoteName);
      const insert = this.store.db.prepare(
        "INSERT INTO remote_ref (remote_name, name, snapshot_id, updated_at) VALUES (?, ?, ?, ?)",
      );
      for (const ref of refs) insert.run(remoteName, ref.name, ref.snapshot_id, now);
      return this.refs(remoteName);
    })();
  }

  upstream(branchName: string) {
    return (this.store.db.prepare("SELECT * FROM branch_upstream WHERE branch_name = ?").get(branchName) as BranchUpstreamRecord | undefined) ?? null;
  }

  setUpstream(branchName: string, remoteName: string, remoteBranch: string) {
    this.store.requireBranch(branchName);
    if (!this.findByName(remoteName)) throw new Error(`Remote "${remoteName}" does not exist`);
    const now = Date.now();
    return this.store.db.prepare(
      `INSERT INTO branch_upstream (branch_name, remote_name, remote_branch, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(branch_name) DO UPDATE SET remote_name=excluded.remote_name, remote_branch=excluded.remote_branch, updated_at=excluded.updated_at RETURNING *`,
    ).get(branchName, remoteName, remoteBranch, now, now) as BranchUpstreamRecord;
  }
}

export class ProjectMergeStore {
  constructor(private readonly store: ProjectStore) {}

  preview(
    sourceBranch: string,
    targetBranch = this.store.current_branch,
  ): MergePreview {
    return this.compute(sourceBranch, targetBranch).preview;
  }

  apply(
    sourceBranch: string,
    targetBranch = this.store.current_branch,
    resolutions?: MergeResolutions,
    message?: string | null,
  ): MergeApplyResult {
    return this.store.db.transaction(() => {
      const computed = this.compute(sourceBranch, targetBranch, resolutions);
      if (computed.unresolved.length > 0) {
        throw new Error(
          `Merge has ${computed.unresolved.length} unresolved conflict(s)`,
        );
      }
      const { preview, plans } = computed;
      if (preview.source_snapshot_id === preview.target_snapshot_id) {
        throw new Error("Source and target already point to the same snapshot");
      }
      const now = Date.now();
      const snapshot = this.store.insertSnapshot(
        [preview.target_snapshot_id, preview.source_snapshot_id],
        message === undefined
          ? `Merge branch "${sourceBranch}" into "${targetBranch}"`
          : message,
        now,
      );

      for (const plan of plans) {
        const target = this.store.resolver.findByRecordId(
          preview.target_snapshot_id,
          plan.entityType,
          plan.recordId,
          true,
        );
        const template = plan.value ?? plan.template;
        if (!template) continue;
        const provisional = this.store.resolver.findByRecordId(
          snapshot.id,
          plan.entityType,
          plan.recordId,
          true,
        );
        if (sameEntity(plan.entityType, alive(provisional), plan.value)) {
          continue;
        }
        this.store.insertRevision(plan.entityType, {
          id: randomUUID(),
          record_id: plan.recordId,
          snapshot_id: snapshot.id,
          previous_revision_id: target?.id ?? null,
          deleted_at: plan.value ? null : now,
          ...businessData(plan.entityType, template),
          created_at: target?.created_at ?? template.created_at,
          updated_at: now,
        });
      }

      this.store.moveBranch(
        targetBranch,
        preview.target_snapshot_id,
        snapshot.id,
        now,
      );
      return {
        ...preview,
        changes: plans.map((plan) => ({
          entity_type: plan.entityType,
          record_id: plan.recordId,
          value: plan.value,
        })),
        conflicts: [],
        snapshot,
      };
    })();
  }

  private compute(
    sourceBranch: string,
    targetBranch: string,
    resolutions?: MergeResolutions,
  ) {
    const localSource = this.store.branches.findByName(sourceBranch);
    const sourceSnapshotId = localSource?.snapshot_id ?? this.store.resolveReference(sourceBranch);
    const target = this.store.requireBranch(targetBranch);
    if (sourceSnapshotId === null) throw new Error(`Branch "${sourceBranch}" is unborn`);
    if (target.snapshot_id === null) throw new Error(`Branch "${targetBranch}" is unborn`);
    const baseId = this.store.resolver.commonAncestor(
      sourceSnapshotId,
      target.snapshot_id,
    );
    if (!baseId) throw new Error("Branches do not share a common ancestor");

    const baseState = this.store.resolver.resolveAll(baseId, true);
    const sourceState = this.store.resolver.resolveAll(
      sourceSnapshotId,
      true,
    );
    const targetState = this.store.resolver.resolveAll(
      target.snapshot_id,
      true,
    );
    const conflicts: MergeConflict[] = [];
    const unresolved: MergeConflict[] = [];
    const plans: MergePlan[] = [];

    for (const entityType of ENTITY_TYPES) {
      const ids = new Set([
        ...baseState.get(entityType)!.keys(),
        ...sourceState.get(entityType)!.keys(),
        ...targetState.get(entityType)!.keys(),
      ]);
      for (const recordId of ids) {
        const baseRecord = baseState.get(entityType)!.get(recordId) ?? null;
        const sourceRecord = sourceState.get(entityType)!.get(recordId) ?? null;
        const targetRecord = targetState.get(entityType)!.get(recordId) ?? null;
        const result = mergeRecord(
          entityType,
          recordId,
          baseRecord,
          sourceRecord,
          targetRecord,
          resolutions,
        );
        conflicts.push(...result.conflicts);
        unresolved.push(...result.unresolved);
        const sourceChanged = !sameEntity(
          entityType,
          alive(baseRecord),
          alive(sourceRecord),
        );
        const targetChanged = !sameEntity(
          entityType,
          alive(baseRecord),
          alive(targetRecord),
        );
        if (
          (sourceChanged || targetChanged) &&
          !sameEntity(entityType, alive(sourceRecord), alive(targetRecord)) &&
          (result.value !== null || result.template !== null)
        ) {
          plans.push({
            entityType,
            recordId,
            value: result.value,
            template: result.template,
          });
        }
      }
    }

    const changes: MergeChange[] = plans.map((plan) => ({
      entity_type: plan.entityType,
      record_id: plan.recordId,
      value: plan.value,
    }));
    return {
      preview: {
        source_branch: sourceBranch,
        target_branch: targetBranch,
        base_snapshot_id: baseId,
        source_snapshot_id: sourceSnapshotId,
        target_snapshot_id: target.snapshot_id,
        changes,
        conflicts,
      },
      plans,
      unresolved,
    };
  }
}

interface MergePlan {
  entityType: EntityType;
  recordId: string;
  value: VersionedRecord | null;
  template: VersionedRecord | null;
}

function mergeRecord(
  entityType: EntityType,
  recordId: string,
  baseRevision: VersionedRecord | null,
  sourceRevision: VersionedRecord | null,
  targetRevision: VersionedRecord | null,
  resolutions?: MergeResolutions,
) {
  const base = alive(baseRevision);
  const source = alive(sourceRevision);
  const target = alive(targetRevision);
  const sourceChanged = !sameEntity(entityType, base, source);
  const targetChanged = !sameEntity(entityType, base, target);
  const conflicts: MergeConflict[] = [];
  const unresolved: MergeConflict[] = [];

  if (!sourceChanged || sameEntity(entityType, source, target)) {
    return {
      value: target,
      template: targetRevision,
      changedFromTarget: false,
      conflicts,
      unresolved,
    };
  }
  if (!targetChanged) {
    return {
      value: source,
      template: sourceRevision,
      changedFromTarget: true,
      conflicts,
      unresolved,
    };
  }

  if ((source === null) !== (target === null)) {
    const conflict: MergeConflict = {
      entity_type: entityType,
      record_id: recordId,
      type: "DELETE_UPDATE",
      base_value: base,
      source_value: source,
      target_value: target,
    };
    conflicts.push(conflict);
    const resolved = resolveConflict(conflict, resolutions, source, target);
    if (!resolved.resolved) unresolved.push(conflict);
    const resolvedRecord = toResolvedRecord(
      resolved.value,
      targetRevision ?? sourceRevision ?? baseRevision,
    );
    return {
      value: resolvedRecord,
      template:
        resolvedRecord ?? sourceRevision ?? targetRevision ?? baseRevision,
      changedFromTarget: !sameEntity(entityType, resolvedRecord, target),
      conflicts,
      unresolved,
    };
  }

  if (base === null && source !== null && target !== null) {
    const conflict: MergeConflict = {
      entity_type: entityType,
      record_id: recordId,
      type: "CREATE_CREATE",
      source_value: source,
      target_value: target,
    };
    conflicts.push(conflict);
    const resolved = resolveConflict(conflict, resolutions, source, target);
    if (!resolved.resolved) unresolved.push(conflict);
    const resolvedRecord = toResolvedRecord(
      resolved.value,
      targetRevision ?? sourceRevision,
    );
    return {
      value: resolvedRecord,
      template: resolvedRecord ?? sourceRevision ?? targetRevision,
      changedFromTarget: !sameEntity(entityType, resolvedRecord, target),
      conflicts,
      unresolved,
    };
  }

  if (!base || !source || !target) {
    return {
      value: target,
      template: targetRevision,
      changedFromTarget: false,
      conflicts,
      unresolved,
    };
  }

  const merged = { ...target } as VersionedRecord & Record<string, unknown>;
  for (const field of ENTITY_FIELDS[entityType]) {
    const baseValue = (base as unknown as Record<string, unknown>)[field];
    const sourceValue = (source as unknown as Record<string, unknown>)[field];
    const targetValue = (target as unknown as Record<string, unknown>)[field];
    const sourceFieldChanged = !sameValue(baseValue, sourceValue);
    const targetFieldChanged = !sameValue(baseValue, targetValue);
    if (
      sourceFieldChanged &&
      targetFieldChanged &&
      !sameValue(sourceValue, targetValue)
    ) {
      const conflict: MergeConflict = {
        entity_type: entityType,
        record_id: recordId,
        type: "FIELD_CONFLICT",
        field,
        base_value: baseValue,
        source_value: sourceValue,
        target_value: targetValue,
      };
      conflicts.push(conflict);
      const resolved = resolveConflict(
        conflict,
        resolutions,
        sourceValue,
        targetValue,
      );
      if (!resolved.resolved) unresolved.push(conflict);
      if (resolved.resolved) merged[field] = resolved.value;
    } else if (sourceFieldChanged) {
      merged[field] = sourceValue;
    }
  }
  return {
    value: merged,
    template: merged,
    changedFromTarget: !sameEntity(entityType, merged, target),
    conflicts,
    unresolved,
  };
}

function resolveConflict(
  conflict: MergeConflict,
  resolutions: MergeResolutions | undefined,
  source: unknown,
  target: unknown,
) {
  const fieldKey = `${conflict.entity_type}:${conflict.record_id}:${conflict.field ?? ""}`;
  const recordKey = `${conflict.entity_type}:${conflict.record_id}`;
  const fieldResolution = resolutions?.[fieldKey];
  const recordResolution = resolutions?.[recordKey];
  const resolution = fieldResolution ?? recordResolution;
  if (resolution === undefined) return { resolved: false, value: target };
  if (resolution === "source" || isChoice(resolution, "source")) {
    return { resolved: true, value: source };
  }
  if (resolution === "target" || isChoice(resolution, "target")) {
    return { resolved: true, value: target };
  }
  if (
    typeof resolution === "object" &&
    resolution !== null &&
    "custom" in resolution
  ) {
    const custom =
      fieldResolution === undefined &&
      conflict.field &&
      typeof resolution.custom === "object" &&
      resolution.custom !== null
        ? (resolution.custom as Record<string, unknown>)[conflict.field]
        : resolution.custom;
    return { resolved: true, value: custom };
  }
  return { resolved: false, value: target };
}

function toResolvedRecord(
  value: unknown,
  fallback: VersionedRecord | null,
): VersionedRecord | null {
  if (value === null) return null;
  if (typeof value !== "object" || fallback === null) {
    throw new Error(
      "A custom entity merge resolution must be an object or null",
    );
  }
  return { ...fallback, ...value } as VersionedRecord;
}

function isChoice(resolution: MergeResolution, choice: "source" | "target") {
  return (
    typeof resolution === "object" &&
    resolution !== null &&
    choice in resolution &&
    (resolution as Record<string, unknown>)[choice] === true
  );
}

function alive(record: VersionedRecord | null) {
  return record?.deleted_at === null ? record : null;
}

function sameEntity(
  entityType: EntityType,
  left: VersionedRecord | null,
  right: VersionedRecord | null,
) {
  if (left === null || right === null) return left === right;
  return ENTITY_FIELDS[entityType].every((field) =>
    sameValue(
      (left as unknown as Record<string, unknown>)[field],
      (right as unknown as Record<string, unknown>)[field],
    ),
  );
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeCreate<T extends EntityType>(
  entityType: T,
  input: EntityCreateInputMap[T],
) {
  const value = { ...(input as Record<string, unknown>) };
  if (entityType === "change_note") value.document_id ??= null;
  if (entityType === "task") {
    value.description ??= null;
    value.document_id ??= null;
    value.status ??= "BACKLOG";
  }
  if (entityType === "file_context") {
    value.kind ??= "path";
    value.filename ??= nameFromPath(String(value.path));
    value.hash ??= "";
  }
  if (entityType === "file_outside_link") {
    value.target_type ??= "file";
    value.kind ??= "import";
    value.source_file_context_id ??= null;
    value.target_path ??= null;
    value.target_branch_name ??= null;
    value.target_snapshot_id ??= null;
    value.target_project_slug ??= null;
  }
  return value;
}

function businessData(entityType: EntityType, record: VersionedRecord) {
  const source = record as unknown as Record<string, unknown>;
  return Object.fromEntries(
    ENTITY_FIELDS[entityType].map((field) => [field, source[field]]),
  );
}

function definedValues(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function validateDocumentReference(
  store: ProjectStore,
  snapshotId: string | null,
  entityType: EntityType,
  data: Record<string, unknown>,
) {
  if (entityType !== "task" && entityType !== "change_note") return;
  const documentId = data.document_id;
  if (
    documentId !== null &&
    documentId !== undefined &&
    (snapshotId === null ||
      !store.resolver.findByRecordId(snapshotId, "document", String(documentId)))
  ) {
    throw new Error(`Document record "${String(documentId)}" does not exist`);
  }
}

function validateRemoteName(name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid remote name "${name}"`);
  }
}

function normalizeRemoteUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote URL must use http or https");
  }
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function defaultMessage(
  action: string,
  entityType: EntityType,
  data: Record<string, unknown>,
) {
  const labels: Record<EntityType, string> = {
    project_prompt: "project prompt",
    document: "document",
    change_note: "change note",
    task: "task",
    file_context: "file context",
    file_outside_link: "file outside link",
  };
  const identity =
    entityType === "document" || entityType === "task"
      ? data.title
      : entityType === "file_context"
        ? data.path
        : entityType === "change_note"
          ? data.note
          : entityType === "file_outside_link"
            ? data.description
            : data.prompt;
  const suffix =
    typeof identity === "string" && identity.length > 0 ? ` "${identity}"` : "";
  return `${action} ${labels[entityType]}${suffix}`;
}

function sortRecords<T extends EntityType>(
  entityType: T,
  records: Array<EntityRecordMap[T]>,
) {
  return [...records].sort((left, right) => {
    if (entityType === "file_context") {
      return String((left as FileContextRecord).path).localeCompare(
        String((right as FileContextRecord).path),
      );
    }
    const field = entityType === "change_note" ? "created_at" : "updated_at";
    return Number(right[field]) - Number(left[field]);
  });
}

function validateBranchName(name: string) {
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,126}[A-Za-z0-9._-])?$/.test(name) ||
    name.includes("..") ||
    name.includes("//")
  ) {
    throw new Error(
      `Invalid branch name "${name}". Use letters, numbers, ".", "_", "-", and "/" without "..", "//", or a trailing "/".`,
    );
  }
}

function nameFromPath(value: string) {
  const trimmed = value.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || value;
}
