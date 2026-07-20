import type {
  ChangeStore,
  DocumentStore,
  FileContextStore,
  ProjectHandle,
  PromptStore,
  ProjectMigrationListRecord,
  ProjectMigrationStatusRecord,
  RegisteredProjectRecord,
  RenderOpts,
  TaskStore,
  VContextAPI,
  EntityName,
  ProjectLocator,
  ReadSelector,
  WriteSelector,
  MergeApplyInput,
} from "@repo/vcontext-mcp";
import type { AppServices } from "../app.js";
import { ProjectApplicationService } from "../application/project-application-service.js";

class ProjectResolutionError extends Error {
  readonly code = "PROJECT_NOT_FOUND";

  constructor(readonly slug?: string) {
    super(slug ? `Project ${slug} not found` : "Project slug is required");
    this.name = "ProjectResolutionError";
  }
}

class DaemonProjectHandle implements ProjectHandle {
  readonly tasks: TaskStore = {
    list: async () => this.records("task") as never,
    add: async (input) => this.add("task", input) as never,
    update: async (id, input) => this.update("task", id, input) as never,
    delete: async (id) =>
      Boolean(
        (await this.application.delete(this.locator, "task", id)).deleted,
      ),
  };

  readonly documents: DocumentStore = {
    list: async () => this.records("document") as never,
    get: async (id) =>
      this.application
        .show(this.locator, "document", id)
        .catch(() => null) as never,
    add: async (input) => this.add("document", input) as never,
    update: async (id, input) => this.update("document", id, input) as never,
    delete: async (id) =>
      Boolean(
        (await this.application.delete(this.locator, "document", id)).deleted,
      ),
  };

  readonly changes: ChangeStore = {
    list: async () => this.records("change_note") as never,
    add: async (input) => this.add("change_note", input) as never,
  };

  readonly fileContexts: FileContextStore = {
    list: async () => this.records("file_context") as never,
    upsert: async (input) =>
      this.application.upsertFileContext(this.locator, input) as never,
    delete: async (id) =>
      Boolean(
        (await this.application.delete(this.locator, "file_context", id))
          .deleted,
      ),
  };

  readonly prompts: PromptStore = {
    list: async () => this.records("project_prompt") as never,
    add: async (input) => this.add("project_prompt", input) as never,
    update: async (id, input) =>
      this.update("project_prompt", id, input) as never,
    delete: async (id) =>
      Boolean(
        (await this.application.delete(this.locator, "project_prompt", id))
          .deleted,
      ),
  };

  constructor(
    private readonly application: ProjectApplicationService,
    private readonly locator: { project_slug: string },
    private readonly projectId: number,
  ) {}

  private async records(entity: EntityName) {
    return (await this.application.list(this.locator, entity)).map(
      (record) => ({
        ...record,
        project_id: this.projectId,
      }),
    );
  }

  private async add(entity: EntityName, input: object) {
    return {
      ...(await this.application.create(this.locator, entity, input as never)),
      project_id: this.projectId,
    };
  }

  private async update(entity: EntityName, id: string, input: object) {
    return {
      ...(await this.application.update(
        this.locator,
        entity,
        id,
        input as never,
      )),
      project_id: this.projectId,
    };
  }
}

export class DaemonVContextAPI implements VContextAPI {
  constructor(private services: AppServices) {
    services.application ??= new ProjectApplicationService(
      services.projectService,
    );
  }

  async listProjects(): Promise<readonly RegisteredProjectRecord[]> {
    return this.services.registry.all();
  }

  async getProject(slug?: string): Promise<ProjectHandle> {
    if (!slug) throw new ProjectResolutionError();
    const project = this.services.registry.findBySlug(slug);
    if (!project) throw new ProjectResolutionError(slug);
    return new DaemonProjectHandle(
      this.services.application!,
      { project_slug: slug },
      project.id,
    );
  }

  async renderContext(slug?: string, opts?: RenderOpts): Promise<string> {
    const resolved = this.resolveLocator({
      project_slug: slug,
      cwd: opts?.cwd,
    });
    return this.services.application!.renderContext(
      resolved,
      {},
      opts?.compact,
    );
  }

  async migrationStatus(slug?: string): Promise<ProjectMigrationStatusRecord> {
    if (!slug) throw new ProjectResolutionError();
    const handle = await this.services.projectService.inspect(slug);
    try {
      return handle.runner.status();
    } finally {
      handle.close();
    }
  }

  async migrationList(slug?: string): Promise<ProjectMigrationListRecord> {
    const status = await this.migrationStatus(slug);
    return {
      project_slug: status.project_slug,
      current_version: status.current_version,
      latest_version: status.latest_version,
      migrations: [
        ...status.applied.map((migration) => ({
          ...migration,
          state: "applied" as const,
        })),
        ...status.pending.map((migration) => ({
          ...migration,
          state: "pending" as const,
        })),
      ],
    };
  }

  async projectStatus(locator: ProjectLocator) {
    return this.services.application!.status(this.resolveLocator(locator));
  }

  async entityList(
    entity: EntityName,
    selector: ReadSelector,
    status?: import("@repo/vcontext-mcp").TaskStatus,
  ) {
    return this.services.application!.list(
      this.resolveLocator(selector),
      entity,
      selector,
      status,
    );
  }

  async entityGet(
    entity: EntityName,
    recordId: string,
    selector: ReadSelector,
  ) {
    return this.services.application!.show(
      this.resolveLocator(selector),
      entity,
      recordId,
      selector,
    );
  }

  async entityHistory(
    entity: EntityName,
    recordId: string,
    selector: ReadSelector,
  ) {
    return this.services.application!.history(
      this.resolveLocator(selector),
      entity,
      recordId,
      selector,
    );
  }

  async entityAdd(
    entity: EntityName,
    input: Record<string, unknown>,
    selector: WriteSelector,
  ) {
    return this.services.application!.create(
      this.resolveLocator(selector),
      entity,
      input as never,
      selector,
    );
  }

  async entityUpdate(
    entity: EntityName,
    recordId: string,
    input: Record<string, unknown>,
    selector: WriteSelector,
  ) {
    return this.services.application!.update(
      this.resolveLocator(selector),
      entity,
      recordId,
      input as never,
      selector,
    );
  }

  async entityDelete(
    entity: EntityName,
    recordId: string,
    selector: WriteSelector,
  ) {
    return this.services.application!.delete(
      this.resolveLocator(selector),
      entity,
      recordId,
      selector,
    );
  }

  async fileContextUpsert(
    input: Record<string, unknown>,
    selector: WriteSelector,
  ) {
    return this.services.application!.upsertFileContext(
      this.resolveLocator(selector),
      input as never,
      selector,
    );
  }

  async fileContextByPath(filePath: string, selector: ReadSelector) {
    return this.services.application!.getFileContextByPath(
      this.resolveLocator(selector),
      filePath,
      selector,
    );
  }

  async branchList(locator: ProjectLocator) {
    return this.services.application!.branches(this.resolveLocator(locator));
  }
  async branchCurrent(locator: ProjectLocator) {
    return this.services.application!.currentBranch(
      this.resolveLocator(locator),
    );
  }
  async branchGet(name: string, locator: ProjectLocator) {
    return this.services.application!.branch(
      this.resolveLocator(locator),
      name,
    );
  }
  async branchCreate(
    name: string,
    from: string | undefined,
    locator: ProjectLocator,
  ) {
    return this.services.application!.createBranch(
      this.resolveLocator(locator),
      name,
      from,
    );
  }
  async branchCheckout(name: string, locator: ProjectLocator) {
    return this.services.application!.checkoutBranch(
      this.resolveLocator(locator),
      name,
    );
  }
  async branchRename(name: string, newName: string, locator: ProjectLocator) {
    return this.services.application!.renameBranch(
      this.resolveLocator(locator),
      name,
      newName,
    );
  }
  async branchDelete(name: string, locator: ProjectLocator) {
    return this.services.application!.deleteBranch(
      this.resolveLocator(locator),
      name,
    );
  }
  async snapshotList(selector: ReadSelector, limit?: number) {
    return this.services.application!.snapshots(
      this.resolveLocator(selector),
      selector,
      limit,
    );
  }
  async snapshotGet(snapshotId: string, locator: ProjectLocator) {
    return this.services.application!.snapshot(
      this.resolveLocator(locator),
      snapshotId,
    );
  }
  async snapshotDiff(
    snapshotId: string,
    from: string | undefined,
    locator: ProjectLocator,
  ) {
    return this.services.application!.diff(
      this.resolveLocator(locator),
      from,
      `snapshot:${snapshotId}`,
    );
  }
  async snapshotCheckout(
    snapshotId: string,
    branch: string,
    locator: ProjectLocator,
  ) {
    return this.services.application!.checkoutSnapshot(
      this.resolveLocator(locator),
      snapshotId,
      branch,
    );
  }
  async log(selector: ReadSelector, limit?: number) {
    return this.services.application!.log(
      this.resolveLocator(selector),
      selector,
      limit,
    );
  }
  async diff(
    from: string | undefined,
    to: string | undefined,
    locator: ProjectLocator,
  ) {
    return this.services.application!.diff(
      this.resolveLocator(locator),
      from,
      to,
    );
  }
  async mergePreview(
    sourceBranch: string,
    targetBranch: string | undefined,
    locator: ProjectLocator,
  ) {
    return this.services.application!.mergePreview(
      this.resolveLocator(locator),
      sourceBranch,
      targetBranch,
    );
  }
  async mergeApply(input: MergeApplyInput) {
    return this.services.application!.mergeApply(
      this.resolveLocator(input),
      input as never,
    );
  }

  private resolveLocator(locator: ProjectLocator) {
    const project_slug = locator.project_slug ?? locator.slug;
    if (project_slug) return { project_slug };
    if (locator.cwd) return { cwd: locator.cwd };
    throw new ProjectResolutionError();
  }
}
