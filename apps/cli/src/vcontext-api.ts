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
  ProjectHandle,
  ProjectPromptRecord,
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
      id: number,
      input: UpdateTaskInput,
    ): Promise<TaskRecord | null> =>
      JSON.parse(
        await this.callApi(
          `/projects/${this.slug}/tasks/${id}`,
          "PATCH",
          input,
        ),
      ),
    delete: async (id: number): Promise<boolean> =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/tasks/${id}`, "DELETE"),
      ).deleted,
  };

  readonly documents: DocumentStore = {
    list: async (): Promise<readonly DocumentRecord[]> =>
      JSON.parse(await this.callApi(`/projects/${this.slug}/documents`)),
    get: async (id: number): Promise<DocumentRecord | null> =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/documents/${id}`),
      ),
    add: async (input: CreateDocumentInput): Promise<DocumentRecord> =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/documents`, "POST", input),
      ),
    update: async (
      id: number,
      input: UpdateDocumentInput,
    ): Promise<DocumentRecord | null> =>
      JSON.parse(
        await this.callApi(
          `/projects/${this.slug}/documents/${id}`,
          "PATCH",
          input,
        ),
      ),
    delete: async (id: number): Promise<boolean> =>
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
    delete: async (id: number): Promise<boolean> =>
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
      id: number,
      input: UpdatePromptInput,
    ): Promise<ProjectPromptRecord | null> =>
      JSON.parse(
        await this.callApi(
          `/projects/${this.slug}/prompts/${id}`,
          "PATCH",
          input,
        ),
      ),
    delete: async (id: number): Promise<boolean> =>
      JSON.parse(
        await this.callApi(`/projects/${this.slug}/prompts/${id}`, "DELETE"),
      ).deleted,
  };
}
