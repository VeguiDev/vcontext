import fs from "node:fs";
import Database from "better-sqlite3";
import { migrateProject } from "./schema.js";
import { projectDataDbPath, projectRoot } from "./paths.js";
import type { RegisteredProject } from "./registry-store.js";

export type TaskStatus = "BACKLOG" | "RUNNING" | "COMPLETED" | "CANCELLED";

export interface DocumentRecord {
  id: number;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface ProjectPromptRecord {
  id: number;
  prompt: string;
  created_at: number;
  updated_at: number;
}

export interface ChangeRecord {
  id: number;
  note: string;
  document_id: number | null;
  created_at: number;
}

export interface TaskRecord {
  id: number;
  title: string;
  description: string | null;
  document_id: number | null;
  status: TaskStatus;
  created_at: number;
  updated_at: number;
}

export interface FileContextRecord {
  id: number;
  filename: string;
  path: string;
  hash: string;
  description: string;
  created_at: number;
  updated_at: number;
}

export class ProjectStore {
  private db: Database.Database;

  constructor(readonly project: RegisteredProject) {
    fs.mkdirSync(projectRoot(project.slug), { recursive: true });

    this.db = new Database(projectDataDbPath(project.slug));
    migrateProject(this.db);
  }

  prompt = {
    find: () => {
      return this.db
        .prepare("SELECT * FROM project_prompt ORDER BY updated_at DESC")
        .all() as ProjectPromptRecord[];
    },

    create: (input: { prompt: string }) => {
      const now = Date.now();

      return this.db
        .prepare(
          `INSERT INTO project_prompt (prompt, created_at, updated_at)
           VALUES (?, ?, ?)
           RETURNING *`,
        )
        .get(input.prompt, now, now) as ProjectPromptRecord;
    },

    update: (id: number, input: { prompt: string }) => {
      const now = Date.now();

      return (
        (this.db
          .prepare(
            `UPDATE project_prompt
             SET prompt = ?, updated_at = ?
             WHERE id = ?
             RETURNING *`,
          )
          .get(input.prompt, now, id) as ProjectPromptRecord | undefined) ?? null
      );
    },

    delete: (id: number) => {
      return this.db.prepare("DELETE FROM project_prompt WHERE id = ?").run(id)
        .changes > 0;
    },
  };

  document = {
    find: () => {
      return this.db
        .prepare("SELECT * FROM document ORDER BY updated_at DESC")
        .all() as DocumentRecord[];
    },

    findById: (id: number) => {
      return (
        (this.db
          .prepare("SELECT * FROM document WHERE id = ? LIMIT 1")
          .get(id) as DocumentRecord | undefined) ?? null
      );
    },

    create: (input: { title: string; content: string }) => {
      const now = Date.now();

      return this.db
        .prepare(
          `INSERT INTO document (title, content, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           RETURNING *`,
        )
        .get(input.title, input.content, now, now) as DocumentRecord;
    },

    update: (id: number, input: { title?: string; content?: string }) => {
      const current = this.document.findById(id);

      if (!current) {
        return null;
      }

      const now = Date.now();

      return this.db
        .prepare(
          `UPDATE document
           SET title = ?, content = ?, updated_at = ?
           WHERE id = ?
           RETURNING *`,
        )
        .get(
          input.title ?? current.title,
          input.content ?? current.content,
          now,
          id,
        ) as DocumentRecord;
    },

    delete: (id: number) => {
      return this.db.prepare("DELETE FROM document WHERE id = ?").run(id)
        .changes > 0;
    },
  };

  change = {
    find: () => {
      return this.db
        .prepare("SELECT * FROM change_note ORDER BY created_at DESC")
        .all() as ChangeRecord[];
    },

    create: (input: { note: string; document_id?: number | null }) => {
      const now = Date.now();

      return this.db
        .prepare(
          `INSERT INTO change_note (note, document_id, created_at)
           VALUES (?, ?, ?)
           RETURNING *`,
        )
        .get(input.note, input.document_id ?? null, now) as ChangeRecord;
    },
  };

  task = {
    find: (status?: TaskStatus) => {
      if (status) {
        return this.db
          .prepare("SELECT * FROM task WHERE status = ? ORDER BY updated_at DESC")
          .all(status) as TaskRecord[];
      }

      return this.db
        .prepare("SELECT * FROM task ORDER BY updated_at DESC")
        .all() as TaskRecord[];
    },

    create: (input: {
      title: string;
      description?: string;
      document_id?: number | null;
      status?: TaskStatus;
    }) => {
      const now = Date.now();

      return this.db
        .prepare(
          `INSERT INTO task (
            title, description, document_id, status, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?)
           RETURNING *`,
        )
        .get(
          input.title,
          input.description ?? null,
          input.document_id ?? null,
          input.status ?? "BACKLOG",
          now,
          now,
        ) as TaskRecord;
    },

    update: (
      id: number,
      input: {
        title?: string;
        description?: string | null;
        document_id?: number | null;
        status?: TaskStatus;
      },
    ) => {
      const current = this.db
        .prepare("SELECT * FROM task WHERE id = ? LIMIT 1")
        .get(id) as TaskRecord | undefined;

      if (!current) {
        return null;
      }

      const now = Date.now();

      return this.db
        .prepare(
          `UPDATE task
           SET title = ?,
               description = ?,
               document_id = ?,
               status = ?,
               updated_at = ?
           WHERE id = ?
           RETURNING *`,
        )
        .get(
          input.title ?? current.title,
          input.description === undefined
            ? current.description
            : input.description,
          input.document_id === undefined
            ? current.document_id
            : input.document_id,
          input.status ?? current.status,
          now,
          id,
        ) as TaskRecord;
    },

    delete: (id: number) => {
      return this.db.prepare("DELETE FROM task WHERE id = ?").run(id).changes > 0;
    },
  };

  fileContext = {
    find: () => {
      return this.db
        .prepare("SELECT * FROM file_context ORDER BY path ASC")
        .all() as FileContextRecord[];
    },

    upsert: (input: {
      filename: string;
      path: string;
      hash: string;
      description: string;
    }) => {
      const now = Date.now();

      return this.db
        .prepare(
          `INSERT INTO file_context (
            filename, path, hash, description, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             filename = excluded.filename,
             hash = excluded.hash,
             description = excluded.description,
             updated_at = excluded.updated_at
           RETURNING *`,
        )
        .get(
          input.filename,
          input.path,
          input.hash,
          input.description,
          now,
          now,
        ) as FileContextRecord;
    },

    delete: (id: number) => {
      return this.db.prepare("DELETE FROM file_context WHERE id = ?").run(id)
        .changes > 0;
    },
  };

  renderContext() {
    const prompts = this.prompt.find();
    const documents = this.document.find();
    const changes = this.change.find().slice(0, 20);
    const tasks = this.task
      .find()
      .filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELLED");
    const files = this.fileContext.find();

    return [
      `Project: ${this.project.name}`,
      `Slug: ${this.project.slug}`,
      "",
      "How to use this context:",
      "- Treat documents as project-level memory written for AI agents.",
      "- Treat file context as a summary of files in the local repository.",
      "- When you make meaningful updates, add a change note and update stale docs.",
      "",
      "Project prompts:",
      prompts.length === 0
        ? "- No project prompts yet."
        : prompts.map((entry) => `- ${entry.prompt}`).join("\n"),
      "",
      "Active tasks:",
      tasks.length === 0
        ? "- No active tasks."
        : tasks
            .map((task) =>
              `- [${task.status}] ${task.title}${
                task.description ? `: ${task.description}` : ""
              }`,
            )
            .join("\n"),
      "",
      "Recent changes:",
      changes.length === 0
        ? "- No change notes yet."
        : changes.map((change) => `- ${change.note}`).join("\n"),
      "",
      "Documents:",
      documents.length === 0
        ? "- No documents yet."
        : documents
            .map((doc) => [`## ${doc.title}`, doc.content.trim()].join("\n"))
            .join("\n\n"),
      "",
      "File context:",
      files.length === 0
        ? "- No file context yet."
        : files.map((file) => `- ${file.path}: ${file.description}`).join("\n"),
    ].join("\n");
  }
}
