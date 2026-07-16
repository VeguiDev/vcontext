export type TaskStatus =
  | "BACKLOG"
  | "RUNNING"
  | "COMPLETED"
  | "CANCELLED";

export type FileContextKind = "file" | "directory" | "path";

export interface RegisteredProjectRecord {
  readonly id: number;
  readonly uuid: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface TaskRecord {
  readonly id: number;
  readonly project_id: number;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly document_id: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface DocumentRecord {
  readonly id: number;
  readonly project_id: number;
  readonly title: string;
  readonly content: string;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface ChangeRecord {
  readonly id: number;
  readonly project_id: number;
  readonly note: string;
  readonly document_id: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface FileContextRecord {
  readonly id: number;
  readonly project_id: number;
  readonly path: string;
  readonly kind: string | null;
  readonly filename: string | null;
  readonly hash: string | null;
  readonly description: string;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface ProjectPromptRecord {
  readonly id: number;
  readonly prompt: string;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string;
  readonly document_id?: number | null;
  readonly status?: TaskStatus;
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly document_id?: number | null;
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
  readonly document_id?: number | null;
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
}

export interface TaskStore {
  list(): Promise<readonly TaskRecord[]>;
  add(input: CreateTaskInput): Promise<TaskRecord>;
  update(id: number, input: UpdateTaskInput): Promise<TaskRecord | null>;
  delete(id: number): Promise<boolean>;
}

export interface DocumentStore {
  list(): Promise<readonly DocumentRecord[]>;
  get(id: number): Promise<DocumentRecord | null>;
  add(input: CreateDocumentInput): Promise<DocumentRecord>;
  update(id: number, input: UpdateDocumentInput): Promise<DocumentRecord | null>;
  delete(id: number): Promise<boolean>;
}

export interface ChangeStore {
  list(): Promise<readonly ChangeRecord[]>;
  add(input: CreateChangeInput): Promise<ChangeRecord>;
}

export interface FileContextStore {
  list(): Promise<readonly FileContextRecord[]>;
  upsert(input: UpsertFileContextInput): Promise<FileContextRecord>;
  delete(id: number): Promise<boolean>;
}

export interface PromptStore {
  list(): Promise<readonly ProjectPromptRecord[]>;
  add(input: CreatePromptInput): Promise<ProjectPromptRecord>;
  update(
    id: number,
    input: UpdatePromptInput,
  ): Promise<ProjectPromptRecord | null>;
  delete(id: number): Promise<boolean>;
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
}
