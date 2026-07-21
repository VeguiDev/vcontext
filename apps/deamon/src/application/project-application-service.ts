import path from "node:path";
import { ProjectMigrationError } from "../project/migration-types.js";
import type { ProjectService } from "../project/project-service.js";
import { ENTITY_FIELDS, ENTITY_TYPES } from "../storage/snapshot-state.js";
import type {
  EntityCreateInputMap,
  EntityUpdateInputMap,
  EntityType,
  MergeConflict,
  MergeResolutions,
  ProjectStore,
  TaskStatus,
} from "../storage/project-store.js";
import { ApplicationError } from "./errors.js";
import { renderProjectContext } from "../render/project-context.js";
import type {
  MergeApplyInput,
  ProjectLocator,
  ProjectStatus,
  ReadSelector,
  WriteSelector,
} from "./contracts.js";

export class ProjectApplicationService {
  constructor(private readonly projects: ProjectService) {}

  listProjects() {
    return this.projects.registry.all();
  }

  async context(locator: ProjectLocator, selector: ReadSelector = {}) {
    return this.withStore(locator, (store) => {
      this.validateReadSelector(selector);
      const read = selector.snapshot_id
        ? store.snapshot(selector.snapshot_id)
        : store.branch(selector.branch ?? store.current_branch);
      const pathContext = read.fileContext.find();
      return {
        project: store.project,
        prompts: read.prompt.find(),
        documents: read.document.find(),
        changes: read.change.find(),
        tasks: read.task.find(),
        path_context: pathContext,
        file_context: pathContext,
      };
    });
  }

  async renderContext(
    locator: ProjectLocator,
    selector: ReadSelector = {},
    compact = false,
  ) {
    return this.withStore(locator, (store) => {
      this.validateReadSelector(selector);
      return renderProjectContext(store, { ...selector, compact });
    });
  }

  async status(locator: ProjectLocator): Promise<ProjectStatus> {
    return this.withStore(locator, (store) => {
      const branch = store.requireBranch(store.current_branch);
      const head = branch.snapshot_id
        ? store.requireSnapshot(branch.snapshot_id)
        : null;
      const paths = this.projects.registry.paths(store.project.slug) ?? [];
      const local =
        paths.find(
          (entry) => entry.type === "local" && entry.label === "workspace",
        ) ?? paths.find((entry) => entry.type === "local");
      const counts = Object.fromEntries(
        ENTITY_TYPES.map((type) => [
          type,
          branch.snapshot_id
            ? store.resolver.resolve(branch.snapshot_id, type).length
            : 0,
        ]),
      ) as ProjectStatus["counts"];
      return {
        name: store.project.name,
        slug: store.project.slug,
        local_path: local?.path ?? null,
        current_branch: store.current_branch,
        current_snapshot_id: branch.snapshot_id,
        head_message: head?.message ?? null,
        head_created_at: head?.created_at ?? null,
        branch_count: store.branches.find().length,
        counts,
      };
    });
  }

  async list<T extends EntityType>(
    locator: ProjectLocator,
    entityType: T,
    selector: ReadSelector = {},
    taskStatus?: TaskStatus,
  ) {
    return this.withStore(locator, (store) => {
      const read = this.readEntity(store, entityType, selector);
      const records = read.find();
      return entityType === "task" && taskStatus
        ? records.filter((record) => record.status === taskStatus)
        : records;
    });
  }

  async show<T extends EntityType>(
    locator: ProjectLocator,
    entityType: T,
    recordId: string,
    selector: ReadSelector = {},
  ) {
    return this.withStore(locator, (store) => {
      const record = this.readEntity(
        store,
        entityType,
        selector,
      ).findByRecordId(recordId);
      if (!record) {
        throw new ApplicationError(
          "RECORD_NOT_FOUND",
          `${entityType} record "${recordId}" not found`,
        );
      }
      return record;
    });
  }

  async history<T extends EntityType>(
    locator: ProjectLocator,
    entityType: T,
    recordId: string,
    selector: ReadSelector = {},
  ) {
    return this.withStore(locator, (store) => {
      const revisions = this.readEntity(store, entityType, selector).history(
        recordId,
      );
      if (revisions.length === 0) {
        throw new ApplicationError(
          "RECORD_NOT_FOUND",
          `${entityType} record "${recordId}" not found`,
        );
      }
      return revisions.sort(
        (left, right) =>
          left.updated_at - right.updated_at || left.id.localeCompare(right.id),
      );
    });
  }

  async create<T extends EntityType>(
    locator: ProjectLocator,
    entityType: T,
    input: EntityCreateInputMap[T],
    selector: WriteSelector = {},
  ) {
    return this.withStore(locator, (store) => {
      const branch = selector.branch ?? store.current_branch;
      return store.createEntity(branch, entityType, input, {
        message: selector.message,
      });
    });
  }

  async update<T extends EntityType>(
    locator: ProjectLocator,
    entityType: T,
    recordId: string,
    input: EntityUpdateInputMap[T],
    selector: WriteSelector = {},
  ) {
    if (
      Object.values(input as Record<string, unknown>).every(
        (v) => v === undefined,
      )
    ) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "At least one update field is required",
      );
    }
    return this.withStore(locator, (store) => {
      const branch = selector.branch ?? store.current_branch;
      const record = store.updateEntity(branch, entityType, recordId, input, {
        message: selector.message,
      });
      if (!record) {
        throw new ApplicationError(
          "RECORD_NOT_FOUND",
          `${entityType} record "${recordId}" not found`,
        );
      }
      return record;
    });
  }

  async delete(
    locator: ProjectLocator,
    entityType: EntityType,
    recordId: string,
    selector: WriteSelector = {},
  ) {
    return this.withStore(locator, (store) => {
      const branch = selector.branch ?? store.current_branch;
      if (
        !store.deleteEntity(branch, entityType, recordId, {
          message: selector.message,
        })
      ) {
        throw new ApplicationError(
          "RECORD_NOT_FOUND",
          `${entityType} record "${recordId}" not found`,
        );
      }
      return { deleted: true };
    });
  }

  async upsertFileContext(
    locator: ProjectLocator,
    input: EntityCreateInputMap["file_context"],
    selector: WriteSelector = {},
  ) {
    return this.withStore(locator, (store) =>
      store.upsertFileContext(selector.branch ?? store.current_branch, input, {
        message: selector.message,
      }),
    );
  }

  async getFileContextByPath(
    locator: ProjectLocator,
    filePath: string,
    selector: ReadSelector = {},
  ) {
    const records = await this.list(locator, "file_context", selector);
    const record = records.find((entry) => entry.path === filePath);
    if (!record) {
      throw new ApplicationError(
        "RECORD_NOT_FOUND",
        `file_context path "${filePath}" not found`,
      );
    }
    return record;
  }

  async branches(locator: ProjectLocator) {
    return this.withStore(locator, (store) => store.branches.find());
  }

  async currentBranch(locator: ProjectLocator) {
    return this.withStore(locator, (store) =>
      store.requireBranch(store.current_branch),
    );
  }

  async branch(locator: ProjectLocator, name: string) {
    return this.withStore(locator, (store) => store.requireBranch(name));
  }

  async createBranch(locator: ProjectLocator, name: string, from?: string) {
    return this.withStore(locator, (store) =>
      store.branches.create(name, from && store.resolveReference(from)),
    );
  }

  async checkoutBranch(locator: ProjectLocator, name: string) {
    return this.withStore(locator, (store) => store.branches.checkout(name));
  }

  async renameBranch(locator: ProjectLocator, name: string, newName: string) {
    return this.withStore(locator, (store) =>
      store.branches.rename(name, newName),
    );
  }

  async deleteBranch(locator: ProjectLocator, name: string) {
    return this.withStore(locator, (store) => ({
      deleted: store.branches.delete(name),
    }));
  }

  async checkoutSnapshot(
    locator: ProjectLocator,
    snapshotId: string,
    branchName: string,
  ) {
    return this.withStore(locator, (store) => {
      store.requireSnapshot(snapshotId);
      return store.branches.createAndCheckout(branchName, snapshotId);
    });
  }

  async snapshots(
    locator: ProjectLocator,
    selector: ReadSelector = {},
    limit = 50,
  ) {
    this.validateLimit(limit);
    return this.withStore(locator, (store) => {
      const id = this.selectSnapshot(store, selector);
      return store.walkSnapshots(id).slice(0, limit);
    });
  }

  async snapshot(locator: ProjectLocator, snapshotId: string) {
    return this.withStore(locator, (store) => {
      const summary = store.snapshotSummary(snapshotId);
      const counts = Object.fromEntries(
        ENTITY_TYPES.map((type) => [
          type,
          store.resolver.resolve(snapshotId, type).length,
        ]),
      );
      return { ...summary, counts };
    });
  }

  async log(locator: ProjectLocator, selector: ReadSelector = {}, limit = 50) {
    return this.snapshots(locator, selector, limit);
  }

  async diff(locator: ProjectLocator, from?: string, to?: string) {
    return this.withStore(locator, (store) => {
      const toId = to
        ? store.resolveReference(to)
        : store.requireBranchHead(store.current_branch);
      let fromId: string;
      if (from) {
        fromId = store.resolveReference(from);
      } else {
        const parent = store.snapshotParents(toId)[0];
        if (!parent) {
          throw new ApplicationError(
            "VALIDATION_ERROR",
            "The initial snapshot has no parent to diff against",
          );
        }
        fromId = parent.parent_snapshot_id;
      }
      return store.diff(fromId, toId);
    });
  }

  async mergePreview(
    locator: ProjectLocator,
    sourceBranch: string,
    targetBranch?: string,
  ) {
    return this.withStore(locator, (store) =>
      store.merge.preview(sourceBranch, targetBranch ?? store.current_branch),
    );
  }

  async mergeApply(locator: ProjectLocator, input: MergeApplyInput) {
    return this.withStore(locator, (store) => {
      const target = input.target_branch ?? store.current_branch;
      const preview = store.merge.preview(input.source_branch, target);
      const resolutions = this.mergeResolutions(preview.conflicts, input);
      return store.merge.apply(
        input.source_branch,
        target,
        resolutions,
        input.message,
      );
    });
  }

  private mergeResolutions(
    conflicts: MergeConflict[],
    input: MergeApplyInput,
  ): MergeResolutions | undefined {
    const explicit = input.resolutions ?? {};
    const conflictKeys = new Set(
      conflicts.flatMap((conflict) => [
        `${conflict.entity_type}:${conflict.record_id}`,
        `${conflict.entity_type}:${conflict.record_id}:${conflict.field ?? ""}`,
      ]),
    );
    for (const key of Object.keys(explicit)) {
      if (!conflictKeys.has(key)) {
        throw new ApplicationError(
          "VALIDATION_ERROR",
          `Resolution "${key}" does not match a merge conflict`,
        );
      }
      const conflict = conflicts.find((candidate) => {
        const recordKey = `${candidate.entity_type}:${candidate.record_id}`;
        const fieldKey = `${recordKey}:${candidate.field ?? ""}`;
        return key === recordKey || key === fieldKey;
      })!;
      this.validateMergeResolution(
        conflict,
        explicit[key],
        key === `${conflict.entity_type}:${conflict.record_id}`,
      );
    }
    if ((input.strategy ?? "manual") === "manual") return explicit;
    const side = input.strategy as "source" | "target";
    const result: MergeResolutions = {};
    for (const conflict of conflicts) {
      const key = conflict.field
        ? `${conflict.entity_type}:${conflict.record_id}:${conflict.field}`
        : `${conflict.entity_type}:${conflict.record_id}`;
      result[key] = explicit[key] ?? side;
    }
    return { ...result, ...explicit };
  }

  private validateMergeResolution(
    conflict: MergeConflict,
    resolution: unknown,
    recordLevel: boolean,
  ) {
    if (
      resolution === "source" ||
      resolution === "target" ||
      (isObject(resolution) &&
        (resolution.source === true || resolution.target === true))
    ) {
      return;
    }
    if (!isObject(resolution) || !("custom" in resolution)) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "A merge resolution must select source, target, or custom",
      );
    }
    const custom = resolution.custom;
    if (recordLevel) {
      if (custom === null) return;
      if (!isObject(custom)) {
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "A custom record-level resolution must be null or a complete object",
        );
      }
      const expected = ENTITY_FIELDS[conflict.entity_type];
      const keys = Object.keys(custom).sort();
      if (
        keys.length !== expected.length ||
        expected.some((field) => !keys.includes(field))
      ) {
        throw new ApplicationError(
          "VALIDATION_ERROR",
          `Custom ${conflict.entity_type} resolution must contain exactly: ${expected.join(", ")}`,
        );
      }
      for (const field of expected) {
        this.validateBusinessField(conflict.entity_type, field, custom[field]);
      }
      return;
    }
    if (!conflict.field) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Record-level conflict requires a record-level resolution key",
      );
    }
    this.validateBusinessField(conflict.entity_type, conflict.field, custom);
  }

  private validateBusinessField(
    entityType: EntityType,
    field: string,
    value: unknown,
  ) {
    const nullableReference =
      (entityType === "task" || entityType === "change_note") &&
      field === "document_id";
    const nullableDescription =
      entityType === "task" && field === "description";
    if ((nullableReference || nullableDescription) && value === null) return;
    if (entityType === "task" && field === "status") {
      if (
        !["BACKLOG", "RUNNING", "COMPLETED", "CANCELLED"].includes(
          String(value),
        )
      ) {
        throw new ApplicationError(
          "VALIDATION_ERROR",
          `Invalid custom task status "${String(value)}"`,
        );
      }
      return;
    }
    if (entityType === "file_context" && field === "kind") {
      if (!["file", "directory", "path"].includes(String(value))) {
        throw new ApplicationError(
          "VALIDATION_ERROR",
          `Invalid custom file context kind "${String(value)}"`,
        );
      }
      return;
    }
    if (typeof value !== "string") {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `Custom value for ${entityType}.${field} must be a string`,
      );
    }
    if (
      ["title", "prompt", "note", "path"].includes(field) &&
      value.length === 0
    ) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `Custom value for ${entityType}.${field} cannot be empty`,
      );
    }
  }

  private readEntity<T extends EntityType>(
    store: ProjectStore,
    entityType: T,
    selector: ReadSelector,
  ) {
    this.validateReadSelector(selector);
    if (!selector.snapshot_id) {
      const branch = store.requireBranch(selector.branch ?? store.current_branch);
      if (branch.snapshot_id === null) {
        return {
          find: () => [],
          findByRecordId: () => null,
          history: () => [],
        };
      }
    }
    const snapshotId = this.selectSnapshot(store, selector);
    return store.snapshot(snapshotId)[this.entityProperty(entityType)] as {
      find(): Array<Record<string, any>>;
      findByRecordId(id: string): Record<string, any> | null;
      history(id: string): Array<Record<string, any>>;
    };
  }

  private entityProperty(entityType: EntityType) {
    return entityType === "project_prompt"
      ? "prompt"
      : entityType === "change_note"
        ? "change"
        : entityType === "file_context"
          ? "fileContext"
          : entityType;
  }

  private selectSnapshot(store: ProjectStore, selector: ReadSelector) {
    this.validateReadSelector(selector);
    if (selector.snapshot_id)
      return store.requireSnapshot(selector.snapshot_id).id;
    return store.requireBranchHead(selector.branch ?? store.current_branch);
  }

  private validateReadSelector(selector: ReadSelector) {
    if (selector.branch && selector.snapshot_id) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "branch and snapshot_id are mutually exclusive",
      );
    }
  }

  private validateLimit(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "limit must be an integer between 1 and 500",
      );
    }
  }

  private async withStore<T>(
    locator: ProjectLocator,
    action: (store: ProjectStore) => T | Promise<T>,
  ): Promise<T> {
    const project = this.resolveProject(locator);
    let handle: Awaited<ReturnType<ProjectService["open"]>> | undefined;
    try {
      handle = await this.projects.open(project);
      if (!handle.store) {
        throw new ApplicationError(
          "DATABASE_ERROR",
          "Project store did not open",
        );
      }
      return await action(handle.store);
    } catch (error) {
      throw this.normalizeError(error);
    } finally {
      handle?.close();
    }
  }

  private resolveProject(locator: ProjectLocator) {
    if (locator.project_slug) {
      const project = this.projects.registry.findBySlug(locator.project_slug);
      if (project) return project;
      throw new ApplicationError(
        "PROJECT_NOT_FOUND",
        `Project "${locator.project_slug}" not found`,
      );
    }
    if (locator.cwd) {
      const cwd = path.resolve(locator.cwd);
      const match = this.projects.registry
        .all()
        .flatMap((project) =>
          (this.projects.registry.paths(project.slug) ?? [])
            .filter((entry) => entry.type === "local")
            .map((entry) => ({ project, local: path.resolve(entry.path) })),
        )
        .filter(
          ({ local }) =>
            cwd === local ||
            cwd.startsWith(local.endsWith(path.sep) ? local : local + path.sep),
        )
        .sort((a, b) => b.local.length - a.local.length)[0];
      if (match) return match.project;
    }
    throw new ApplicationError(
      "PROJECT_NOT_FOUND",
      "Project could not be resolved; provide project_slug or cwd",
    );
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof ApplicationError) return error;
    if (error instanceof ProjectMigrationError) {
      return new ApplicationError(
        "MIGRATION_ERROR",
        error.message,
        undefined,
        error,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/Branch ".+" does not exist/.test(message)) {
      return new ApplicationError(
        "BRANCH_NOT_FOUND",
        message,
        undefined,
        error,
      );
    }
    if (/Snapshot ".+" does not exist/.test(message)) {
      return new ApplicationError(
        "SNAPSHOT_NOT_FOUND",
        message,
        undefined,
        error,
      );
    }
    if (/unresolved conflict/i.test(message)) {
      return new ApplicationError("MERGE_CONFLICT", message, undefined, error);
    }
    if (
      /already exists|cannot delete|invalid|ambiguous|does not share|same snapshot|does not exist/.test(
        message.toLowerCase(),
      )
    ) {
      return new ApplicationError(
        "VALIDATION_ERROR",
        message,
        undefined,
        error,
      );
    }
    return new ApplicationError("DATABASE_ERROR", message, undefined, error);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
