import fs from "node:fs";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import slugify from "slugify";
import { migrateRegistry } from "./schema.js";
import {
  PROJECTS_ROOT,
  REGISTRY_DB_PATH,
  VCONTEXT_HOME,
  projectRoot,
} from "./paths.js";

export interface RegisteredProject {
  id: number;
  uuid: string;
  slug: string;
  name: string;
  description: string | null;
  local_path: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  local_path?: string;
}

export class RegistryStore {
  private db: Database.Database;

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
      (this.db
        .prepare("SELECT * FROM project WHERE id = ? LIMIT 1")
        .get(id) as RegisteredProject | undefined) ?? null
    );
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
        `INSERT INTO project (uuid, slug, name, description, local_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(
        randomUUID(),
        slug,
        input.name,
        input.description ?? null,
        input.local_path ?? null,
        now,
        now,
      ) as RegisteredProject;

    fs.mkdirSync(projectRoot(project.slug), { recursive: true });

    return project;
  }

  link(projectId: number, projectBId: number) {
    if (projectId === projectBId) {
      return false;
    }

    const now = Date.now();

    return this.db
      .prepare(
        `INSERT OR IGNORE INTO project_link (project_id, project_b_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(projectId, projectBId, now).changes > 0;
  }

  links(projectId: number) {
    return this.db
      .prepare(
        `SELECT linked.*
         FROM project_link link
         JOIN project linked ON linked.id = link.project_b_id
         WHERE link.project_id = ?
         ORDER BY linked.name ASC`,
      )
      .all(projectId) as RegisteredProject[];
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
