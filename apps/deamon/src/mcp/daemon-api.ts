import type {
  ChangeStore,
  DocumentStore,
  FileContextStore,
  ProjectHandle,
  PromptStore,
  RegisteredProjectRecord,
  RenderOpts,
  TaskStore,
  VContextAPI,
} from "@repo/vcontext-mcp";
import type { AppServices } from "../app.js";
import { renderProjectContext } from "../render/project-context.js";
import { ProjectStore } from "../storage/project-store.js";

class ProjectResolutionError extends Error {
  constructor(readonly slug?: string) {
    super(slug ? `Project ${slug} not found` : "Project slug is required");
    this.name = "ProjectResolutionError";
  }
}

class DaemonProjectHandle implements ProjectHandle {
  readonly tasks: TaskStore = {
    list: async () =>
      this.store.task.find().map((record) => ({
        ...record,
        project_id: this.store.project.id,
      })),
    add: async (input) => ({
      ...this.store.task.create(input),
      project_id: this.store.project.id,
    }),
    update: async (id, input) => {
      const record = this.store.task.update(id, input);
      return record
        ? { ...record, project_id: this.store.project.id }
        : null;
    },
    delete: async (id) => this.store.task.delete(id),
  };

  readonly documents: DocumentStore = {
    list: async () =>
      this.store.document.find().map((record) => ({
        ...record,
        project_id: this.store.project.id,
      })),
    get: async (id) => {
      const record = this.store.document.findById(id);
      return record
        ? { ...record, project_id: this.store.project.id }
        : null;
    },
    add: async (input) => ({
      ...this.store.document.create(input),
      project_id: this.store.project.id,
    }),
    update: async (id, input) => {
      const record = this.store.document.update(id, input);
      return record
        ? { ...record, project_id: this.store.project.id }
        : null;
    },
    delete: async (id) => this.store.document.delete(id),
  };

  readonly changes: ChangeStore = {
    list: async () =>
      this.store.change.find().map((record) => ({
        ...record,
        project_id: this.store.project.id,
        updated_at: record.created_at,
      })),
    add: async (input) => {
      const record = this.store.change.create(input);
      return {
        ...record,
        project_id: this.store.project.id,
        updated_at: record.created_at,
      };
    },
  };

  readonly fileContexts: FileContextStore = {
    list: async () =>
      this.store.fileContext.find().map((record) => ({
        ...record,
        project_id: this.store.project.id,
      })),
    upsert: async (input) => ({
      ...this.store.fileContext.upsert(input),
      project_id: this.store.project.id,
    }),
    delete: async (id) => this.store.fileContext.delete(id),
  };

  readonly prompts: PromptStore = {
    list: async () => this.store.prompt.find(),
    add: async (input) => this.store.prompt.create(input),
    update: async (id, input) => this.store.prompt.update(id, input),
    delete: async (id) => this.store.prompt.delete(id),
  };

  constructor(private readonly store: ProjectStore) {}
}

export class DaemonVContextAPI implements VContextAPI {
  constructor(private services: AppServices) {}

  async listProjects(): Promise<readonly RegisteredProjectRecord[]> {
    return this.services.registry.all();
  }

  async getProject(slug?: string): Promise<ProjectHandle> {
    return new DaemonProjectHandle(this.resolveProject(slug));
  }

  async renderContext(slug?: string, opts?: RenderOpts): Promise<string> {
    return renderProjectContext(this.resolveProject(slug), opts);
  }

  private resolveProject(slug?: string): ProjectStore {
    if (!slug) {
      throw new ProjectResolutionError();
    }

    const project = this.services.registry.findBySlug(slug);
    if (!project) {
      throw new ProjectResolutionError(slug);
    }

    return new ProjectStore(project);
  }
}
