import { findProjectMarker, request } from "@repo/daemon-client";
import { readPort, readToken } from "@repo/vcontext-core";
import type {
  ChangeRecord,
  ChangeStore,
  CreateChangeInput,
  CreateDocumentInput,
  CreatePromptInput,
  CreateTaskInput,
  DocumentRecord,
  DocumentStore,
  FileContextRecord,
  FileContextStore,
  FileOutsideLinkRecord,
  ProjectHandle,
  ProjectPromptRecord,
  ProjectMigrationListRecord,
  ProjectMigrationStatusRecord,
  PromptStore,
  RegisteredProjectRecord,
  RenderOpts,
  TaskRecord,
  TaskStore,
  UpdateDocumentInput,
  UpdatePromptInput,
  UpdateTaskInput,
  UpsertFileContextInput,
  VContextAPI,
  EntityName,
  ProjectLocator,
  ReadSelector,
  WriteSelector,
  MergeApplyInput,
  TaskStatus,
} from "@repo/vcontext-mcp";

type ApiRequest = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<string>;

export class CLIVContextAPI implements VContextAPI {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    const port = readPort();
    if (port === null) {
      throw new Error("Daemon not running");
    }

    const token = readToken();
    if (token === null) {
      throw new Error("No auth token");
    }

    this.baseUrl = `http://127.0.0.1:${port}`;
    this.token = token;
  }

  async listProjects(): Promise<readonly RegisteredProjectRecord[]> {
    return JSON.parse(await this.api("/projects"));
  }

  async getProject(slug?: string): Promise<ProjectHandle> {
    const resolvedSlug = slug ?? this.resolveSlug();
    const callApi: ApiRequest = (path, method, body) =>
      this.api(path, method, body);

    return new CliProjectHandle(callApi, resolvedSlug);
  }

  async renderContext(slug?: string, opts?: RenderOpts): Promise<string> {
    const resolvedSlug = slug ?? this.resolveSlug();
    const compact = opts?.compact ? "?compact=true" : "";
    const url = new URL(
      `/projects/${resolvedSlug}/context${compact}`,
      this.baseUrl,
    );
    const response = await request(
      "GET",
      `${url.pathname}${url.search}`,
      undefined,
      {
        authorization: `Bearer ${this.token}`,
        accept: "text/plain",
      },
    );

    return response.body;
  }

  async migrationStatus(slug?: string): Promise<ProjectMigrationStatusRecord> {
    const resolvedSlug = slug ?? this.resolveSlug();
    return JSON.parse(
      await this.api(`/projects/${resolvedSlug}/migrations/status`),
    );
  }

  async migrationList(slug?: string): Promise<ProjectMigrationListRecord> {
    const resolvedSlug = slug ?? this.resolveSlug();
    return JSON.parse(
      await this.api(`/projects/${resolvedSlug}/migrations/list`),
    );
  }

  async projectStatus(locator: ProjectLocator): Promise<unknown> {
    return this.getJson(`/projects/${this.resolveLocator(locator)}/status`);
  }

  async entityList(
    entity: EntityName,
    selector: ReadSelector,
    status?: TaskStatus,
  ): Promise<readonly unknown[]> {
    const query = this.readQuery(selector);
    if (status) query.set("status", status);
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/${entityRoute(entity)}?${query}`,
    );
  }

  async entityGet(
    entity: EntityName,
    recordId: string,
    selector: ReadSelector,
  ) {
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/${entityRoute(entity)}/${encodeURIComponent(recordId)}?${this.readQuery(selector)}`,
    );
  }

  async entityHistory(
    entity: EntityName,
    recordId: string,
    selector: ReadSelector,
  ): Promise<readonly unknown[]> {
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/${entityRoute(entity)}/${encodeURIComponent(recordId)}/history?${this.readQuery(selector)}`,
    );
  }

  async entityAdd(
    entity: EntityName,
    input: Record<string, unknown>,
    selector: WriteSelector,
  ) {
    const route =
      entity === "file_context"
        ? `${entityRoute(entity)}/add`
        : entityRoute(entity);
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/${route}?${this.writeQuery(selector)}`,
      "POST",
      input,
    );
  }

  async entityUpdate(
    entity: EntityName,
    recordId: string,
    input: Record<string, unknown>,
    selector: WriteSelector,
  ) {
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/${entityRoute(entity)}/${encodeURIComponent(recordId)}?${this.writeQuery(selector)}`,
      "PATCH",
      input,
    );
  }

  async entityDelete(
    entity: EntityName,
    recordId: string,
    selector: WriteSelector,
  ) {
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/${entityRoute(entity)}/${encodeURIComponent(recordId)}?${this.writeQuery(selector)}`,
      "DELETE",
    );
  }

  async fileContextUpsert(
    input: Record<string, unknown>,
    selector: WriteSelector,
  ) {
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/file-context?${this.writeQuery(selector)}`,
      "POST",
      input,
    );
  }

  async fileContextByPath(filePath: string, selector: ReadSelector) {
    const query = this.readQuery(selector);
    query.set("path", filePath);
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/file-context/by-path?${query}`,
    );
  }

  async branchList(locator: ProjectLocator) {
    return this.getJson(`/projects/${this.resolveLocator(locator)}/branches`);
  }
  async branchCurrent(locator: ProjectLocator) {
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/branches/current`,
    );
  }
  async branchGet(name: string, locator: ProjectLocator) {
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/branches/${encodeURIComponent(name)}`,
    );
  }
  async branchCreate(
    name: string,
    from: string | undefined,
    locator: ProjectLocator,
  ) {
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/branches`,
      "POST",
      { name, from },
    );
  }
  async branchCheckout(name: string, locator: ProjectLocator) {
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/branches/${encodeURIComponent(name)}/checkout`,
      "POST",
    );
  }
  async branchRename(name: string, newName: string, locator: ProjectLocator) {
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/branches/${encodeURIComponent(name)}`,
      "PATCH",
      { name: newName },
    );
  }
  async branchDelete(name: string, locator: ProjectLocator) {
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/branches/${encodeURIComponent(name)}`,
      "DELETE",
    );
  }
  async snapshotList(selector: ReadSelector, limit?: number) {
    const query = this.readQuery(selector);
    if (limit !== undefined) query.set("limit", String(limit));
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/snapshots?${query}`,
    );
  }
  async snapshotGet(snapshotId: string, locator: ProjectLocator) {
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/snapshots/${encodeURIComponent(snapshotId)}`,
    );
  }
  async snapshotDiff(
    snapshotId: string,
    from: string | undefined,
    locator: ProjectLocator,
  ) {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/snapshots/${encodeURIComponent(snapshotId)}/diff?${query}`,
    );
  }
  async snapshotCheckout(
    snapshotId: string,
    branch: string,
    locator: ProjectLocator,
  ) {
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/snapshots/${encodeURIComponent(snapshotId)}/checkout`,
      "POST",
      { branch },
    );
  }
  async log(selector: ReadSelector, limit?: number) {
    const query = this.readQuery(selector);
    if (limit !== undefined) query.set("limit", String(limit));
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/log?${query}`,
    );
  }
  async diff(
    from: string | undefined,
    to: string | undefined,
    locator: ProjectLocator,
  ) {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/diff?${query}`,
    );
  }
  async mergePreview(
    sourceBranch: string,
    targetBranch: string | undefined,
    locator: ProjectLocator,
  ) {
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/merge/preview`,
      "POST",
      { source_branch: sourceBranch, target_branch: targetBranch },
    );
  }
  async mergeApply(input: MergeApplyInput) {
    return this.getJson(
      `/projects/${this.resolveLocator(input)}/merge/apply`,
      "POST",
      input,
    );
  }

  async linksList(locator: ProjectLocator) {
    return this.getJson(`/projects/${this.resolveLocator(locator)}/links`);
  }

  async linksAdd(
    locator: ProjectLocator,
    projectBSlug: string,
    branchName?: string,
    snapshotId?: string,
  ) {
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/links`,
      "POST",
      {
        project_b_slug: projectBSlug,
        ...(branchName !== undefined && { branch_name: branchName }),
        ...(snapshotId !== undefined && { snapshot_id: snapshotId }),
      },
    );
  }

  async linksRemove(
    locator: ProjectLocator,
    projectBSlug: string,
    branchName?: string,
    snapshotId?: string,
  ) {
    return this.getJson(
      `/projects/${this.resolveLocator(locator)}/links`,
      "DELETE",
      {
        project_b_slug: projectBSlug,
        ...(branchName !== undefined && { branch_name: branchName }),
        ...(snapshotId !== undefined && { snapshot_id: snapshotId }),
      },
    );
  }

  async outsideLinksList(
    selector: ReadSelector,
    sourceFileContextId?: string,
  ) {
    const query = this.readQuery(selector);
    if (sourceFileContextId) {
      query.set("source_file_context_id", sourceFileContextId);
    }
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/outside-links?${query}`,
    );
  }

  async outsideLinksAdd(
    input: Record<string, unknown>,
    selector: WriteSelector,
  ) {
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/outside-links?${this.writeQuery(selector)}`,
      "POST",
      input,
    );
  }

  async outsideLinksGet(recordId: string, selector: ReadSelector) {
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/outside-links/${encodeURIComponent(recordId)}?${this.readQuery(selector)}`,
    );
  }

  async outsideLinksUpdate(
    recordId: string,
    input: Record<string, unknown>,
    selector: WriteSelector,
  ) {
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/outside-links/${encodeURIComponent(recordId)}?${this.writeQuery(selector)}`,
      "PATCH",
      input,
    );
  }

  async outsideLinksDelete(recordId: string, selector: WriteSelector) {
    return this.getJson(
      `/projects/${this.resolveLocator(selector)}/outside-links/${encodeURIComponent(recordId)}?${this.writeQuery(selector)}`,
      "DELETE",
    );
  }

  private async getJson(path: string, method = "GET", body?: unknown) {
    return JSON.parse(await this.api(path, method, body));
  }

  private resolveLocator(locator: ProjectLocator) {
    const explicit = locator.project_slug ?? locator.slug;
    if (explicit) return encodeURIComponent(explicit);
    const marker = findProjectMarker(locator.cwd ?? process.cwd());
    if (!marker) {
      throw new Error(
        "Project could not be resolved; provide project_slug, slug, or cwd",
      );
    }
    return encodeURIComponent(marker.marker.slug);
  }

  private readQuery(selector: ReadSelector) {
    const query = new URLSearchParams();
    if (selector.branch) query.set("branch", selector.branch);
    if (selector.snapshot_id) query.set("snapshot_id", selector.snapshot_id);
    return query;
  }

  private writeQuery(selector: WriteSelector) {
    const query = new URLSearchParams();
    if (selector.branch) query.set("branch", selector.branch);
    if (selector.message !== undefined && selector.message !== null) {
      query.set("message", selector.message);
    }
    return query;
  }

  private async api(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<string> {
    const url = new URL(path, this.baseUrl);
    const response = await request(
      method,
      `${url.pathname}${url.search}`,
      body,
      { authorization: `Bearer ${this.token}` },
    );

    return response.body;
  }

  private resolveSlug(): string {
    const marker = findProjectMarker(process.cwd());
    if (marker === null) {
      throw new Error("Not in a vcontext project and no slug provided");
    }

    return marker.marker.slug;
  }
}

function entityRoute(entity: EntityName) {
  return entity === "project_prompt"
    ? "prompts"
    : entity === "change_note"
      ? "changes"
      : entity === "file_context"
        ? "file-context"
        : `${entity}s`;
}

/** @internal */
interface LinkRecord {
  readonly project_a_slug: string;
  readonly project_b_slug: string;
  readonly branch_name: string | null;
  readonly snapshot_id: string | null;
  readonly created_at: number;
}

class CliProjectHandle implements ProjectHandle {
  constructor(
    private readonly callApi: ApiRequest,
    private readonly slug: string,
  ) {}

  readonly tasks: TaskStore = {
    list: async (): Promise<readonly TaskRecord[]> =>
      JSON.parse(await this.callApi(`/projects/${this.slug}/tasks`)),
    add: async (input: CreateTaskInput): Promise<TaskRecord> =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/tasks`, "POST", input),
      ),
    update: async (
      id: string,
      input: UpdateTaskInput,
    ): Promise<TaskRecord | null> =>
      JSON.parse(
        await this.callApi(
          `/projects/${this.slug}/tasks/${id}`,
          "PATCH",
          input,
        ),
      ),
    delete: async (id: string): Promise<boolean> =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/tasks/${id}`, "DELETE"),
      ).deleted,
  };

  readonly documents: DocumentStore = {
    list: async (): Promise<readonly DocumentRecord[]> =>
      JSON.parse(await this.callApi(`/projects/${this.slug}/documents`)),
    get: async (id: string): Promise<DocumentRecord | null> =>
      JSON.parse(await this.callApi(`/projects/${this.slug}/documents/${id}`)),
    add: async (input: CreateDocumentInput): Promise<DocumentRecord> =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/documents`, "POST", input),
      ),
    update: async (
      id: string,
      input: UpdateDocumentInput,
    ): Promise<DocumentRecord | null> =>
      JSON.parse(
        await this.callApi(
          `/projects/${this.slug}/documents/${id}`,
          "PATCH",
          input,
        ),
      ),
    delete: async (id: string): Promise<boolean> =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/documents/${id}`, "DELETE"),
      ).deleted,
  };

  readonly changes: ChangeStore = {
    list: async (): Promise<readonly ChangeRecord[]> =>
      JSON.parse(await this.callApi(`/projects/${this.slug}/changes`)),
    add: async (input: CreateChangeInput): Promise<ChangeRecord> =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/changes`, "POST", input),
      ),
  };

  readonly fileContexts: FileContextStore = {
    list: async (): Promise<readonly FileContextRecord[]> =>
      JSON.parse(await this.callApi(`/projects/${this.slug}/file-context`)),
    upsert: async (input: UpsertFileContextInput): Promise<FileContextRecord> =>
      JSON.parse(
        await this.callApi(
          `/projects/${this.slug}/file-context`,
          "POST",
          input,
        ),
      ),
    delete: async (id: string): Promise<boolean> =>
      JSON.parse(
        await this.callApi(
          `/projects/${this.slug}/file-context/${id}`,
          "DELETE",
        ),
      ).deleted,
  };

  readonly prompts: PromptStore = {
    list: async (): Promise<readonly ProjectPromptRecord[]> =>
      JSON.parse(await this.callApi(`/projects/${this.slug}/prompts`)),
    add: async (input: CreatePromptInput): Promise<ProjectPromptRecord> =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/prompts`, "POST", input),
      ),
    update: async (
      id: string,
      input: UpdatePromptInput,
    ): Promise<ProjectPromptRecord | null> =>
      JSON.parse(
        await this.callApi(
          `/projects/${this.slug}/prompts/${id}`,
          "PATCH",
          input,
        ),
      ),
    delete: async (id: string): Promise<boolean> =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/prompts/${id}`, "DELETE"),
      ).deleted,
  };

  readonly links: {
    add: (
      targetSlug: string,
      branchName?: string,
      snapshotId?: string,
    ) => Promise<LinkRecord>;
    list: () => Promise<readonly LinkRecord[]>;
    remove: (
      targetSlug: string,
      branchName?: string,
      snapshotId?: string,
    ) => Promise<{ readonly deleted: boolean }>;
  } = {
    add: async (targetSlug, branchName?, snapshotId?) =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/links`, "POST", {
          project_b_slug: targetSlug,
          ...(branchName !== undefined && {
            branch_name: branchName,
          }),
          ...(snapshotId !== undefined && {
            snapshot_id: snapshotId,
          }),
        }),
      ),
    list: async () =>
      JSON.parse(await this.callApi(`/projects/${this.slug}/links`)),
    remove: async (targetSlug, branchName?, snapshotId?) =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/links`, "DELETE", {
          project_b_slug: targetSlug,
          ...(branchName !== undefined && {
            branch_name: branchName,
          }),
          ...(snapshotId !== undefined && {
            snapshot_id: snapshotId,
          }),
        }),
      ),
  };

  readonly outsideLinks: {
    add: (input: Record<string, unknown>) => Promise<FileOutsideLinkRecord>;
    list: (
      sourceFileContextId?: string,
    ) => Promise<readonly FileOutsideLinkRecord[]>;
    show: (recordId: string) => Promise<FileOutsideLinkRecord>;
    delete: (recordId: string) => Promise<{ readonly deleted: boolean }>;
  } = {
    add: async (input) =>
      JSON.parse(
        await this.callApi(
          `/projects/${this.slug}/outside-links`,
          "POST",
          input,
        ),
      ),
    list: async (sourceFileContextId?) => {
      const query = sourceFileContextId
        ? `?source_file_context_id=${encodeURIComponent(sourceFileContextId)}`
        : "";
      return JSON.parse(
        await this.callApi(`/projects/${this.slug}/outside-links${query}`),
      );
    },
    show: async (recordId) =>
      JSON.parse(
        await this.callApi(
          `/projects/${this.slug}/outside-links/${recordId}`,
        ),
      ),
    delete: async (recordId) =>
      JSON.parse(
        await this.callApi(
          `/projects/${this.slug}/outside-links/${recordId}`,
          "DELETE",
        ),
      ),
  };
}
