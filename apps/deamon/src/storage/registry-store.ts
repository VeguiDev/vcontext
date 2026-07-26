import fs from "node:fs";
import { randomUUID } from "node:crypto";
import Database, { type Database as DatabaseConnection } from "./database.js";
import slugify from "slugify";
import { migrateRegistry } from "./schema.js";
import {
  PROJECTS_ROOT,
  REGISTRY_DB_PATH,
  VCONTEXT_HOME,
  projectDataDbPath,
  projectRoot,
} from "./paths.js";

export interface RegisteredProject {
  id: number;
  uuid: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface LinkedProject extends RegisteredProject {
  branch_name: string | null;
  snapshot_id: string | null;
}

export type ProjectPathType = "local" | "remote";

export interface ProjectPathRecord {
  id: number;
  project_id: number;
  type: ProjectPathType;
  path: string;
  label: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface ImportProjectInput extends CreateProjectInput {
  uuid: string;
  slug: string;
}

export class RegistryStore {
  readonly db: DatabaseConnection;

  constructor(dbPath = REGISTRY_DB_PATH) {
    fs.mkdirSync(VCONTEXT_HOME, { recursive: true });
    fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

    this.db = new Database(dbPath);
    migrateRegistry(this.db);
  }

  all() {
    return this.db
      .prepare("SELECT * FROM project ORDER BY name ASC")
      .all() as RegisteredProject[];
  }

  findById(id: number) {
    return (
      (this.db.prepare("SELECT * FROM project WHERE id = ? LIMIT 1").get(id) as
        | RegisteredProject
        | undefined) ?? null
    );
  }

  findByUuid(uuid: string) {
    return ((this.db.prepare("SELECT * FROM project WHERE uuid = ? LIMIT 1").get(uuid) as RegisteredProject | undefined) ?? null);
  }

  findBySlug(slug: string) {
    return (
      (this.db
        .prepare("SELECT * FROM project WHERE slug = ? LIMIT 1")
        .get(slug) as RegisteredProject | undefined) ?? null
    );
  }

  create(input: CreateProjectInput) {
    const now = Date.now();
    const slug = this.nextSlug(input.name);

    const project = this.db
      .prepare(
        `INSERT INTO project (uuid, slug, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(
        randomUUID(),
        slug,
        input.name,
        input.description ?? null,
        now,
        now,
      ) as RegisteredProject;

    fs.mkdirSync(projectRoot(project.slug), { recursive: true });
    const projectDb = new Database(projectDataDbPath(project.slug));
    projectDb.close();

    return project;
  }

  /** Register an already validated project directory; does not create storage. */
  registerImported(input: ImportProjectInput) {
    const now = Date.now();
    if (this.findBySlug(input.slug)) throw new Error(`Project "${input.slug}" already exists`);
    return this.db.prepare(
      `INSERT INTO project (uuid, slug, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    ).get(input.uuid, input.slug, input.name, input.description ?? null, now, now) as RegisteredProject;
  }

  close() {
    this.db.close();
  }

  addPath(
    slug: string,
    input: { type: ProjectPathType; path: string; label?: string | null },
  ) {
    const project = this.findBySlug(slug);

    if (!project) {
      return null;
    }

    const now = Date.now();

    return this.db
      .prepare(
        `INSERT INTO project_path (
          project_id, type, path, label, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, type, path) DO UPDATE SET
           label = excluded.label,
           updated_at = excluded.updated_at
         RETURNING *`,
      )
      .get(
        project.id,
        input.type,
        input.path,
        input.label ?? null,
        now,
        now,
      ) as ProjectPathRecord;
  }

  paths(slug: string) {
    const project = this.findBySlug(slug);

    if (!project) {
      return null;
    }

    return this.db
      .prepare(
        `SELECT *
         FROM project_path
         WHERE project_id = ?
         ORDER BY type ASC, path ASC`,
      )
      .all(project.id) as ProjectPathRecord[];
  }

  findByPath(type: ProjectPathType, value: string) {
    return (
      (this.db
        .prepare(
          `SELECT project.*
           FROM project_path
           JOIN project ON project.id = project_path.project_id
           WHERE project_path.type = ? AND project_path.path = ?
           LIMIT 1`,
        )
        .get(type, value) as RegisteredProject | undefined) ?? null
    );
  }

  link(
    projectId: number,
    projectBId: number,
    branchName?: string | null,
    snapshotId?: string | null,
  ) {
    if (projectId === projectBId) {
      return false;
    }

    const now = Date.now();

    try {
      return (
        this.db
          .prepare(
            `INSERT INTO project_link (project_id, project_b_id, branch_name, snapshot_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          )
          .run(projectId, projectBId, branchName ?? null, snapshotId ?? null, now)
          .changes > 0
      );
    } catch {
      return false;
    }
  }

  unlink(
    projectId: number,
    projectBId: number,
    branchName?: string | null,
    snapshotId?: string | null,
  ) {
    return (
      this.db
        .prepare(
          `DELETE FROM project_link
           WHERE project_id = ? AND project_b_id = ?
             AND branch_name IS ? AND snapshot_id IS ?`,
        )
        .run(projectId, projectBId, branchName ?? null, snapshotId ?? null)
        .changes > 0
    );
  }

  unlinkAll(projectId: number, projectBId: number) {
    return (
      this.db
        .prepare(
          `DELETE FROM project_link
           WHERE project_id = ? AND project_b_id = ?`,
        )
        .run(projectId, projectBId).changes > 0
    );
  }

  links(projectId: number) {
    return this.db
      .prepare(
        `SELECT linked.*, link.branch_name, link.snapshot_id
         FROM project_link link
         JOIN project linked ON linked.id = link.project_b_id
         WHERE link.project_id = ?
         ORDER BY linked.name ASC`,
      )
      .all(projectId) as LinkedProject[];
  }

  linksBySlug(slug: string) {
    const project = this.findBySlug(slug);

    if (!project) {
      return null;
    }

    return this.links(project.id);
  }

  private nextSlug(name: string) {
    const base = slugify(name, { lower: true, strict: true }) || "project";
    let slug = base;
    let index = 2;

    while (this.findBySlug(slug)) {
      slug = `${base}-${index}`;
      index += 1;
    }

    return slug;
  }
}
