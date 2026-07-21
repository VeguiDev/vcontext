import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { loadProjectMigrations } from "./migration-loader.js";
import { ProjectMigrationRunner } from "./migration-runner.js";
import type { LoadedProjectMigration } from "./migration-types.js";
import {
  createMigratedProjectStore,
  type ProjectStore,
} from "../storage/project-store.js";
import {
  projectConfigPath,
  projectDataDbPath,
  projectRoot,
} from "../storage/paths.js";
import type {
  CreateProjectInput,
  ProjectPathType,
  RegisteredProject,
  RegistryStore,
} from "../storage/registry-store.js";
import { updateProjectJson } from "./project-metadata.js";

export type MigrationMode = "apply" | "status-only" | "skip";

export interface ProjectOpenOptions {
  migrationMode?: MigrationMode;
  allowUnsafeSkip?: boolean;
}

export interface OpenProjectHandle {
  project: RegisteredProject;
  cwd: string;
  runner: ProjectMigrationRunner;
  store: ProjectStore | null;
  close(): void;
}

export class ProjectService {
  private readonly migrationsPromise: Promise<LoadedProjectMigration[]>;

  constructor(
    readonly registry: RegistryStore,
    migrations?: LoadedProjectMigration[] | Promise<LoadedProjectMigration[]>,
    private readonly logger: (message: string) => void = console.log,
  ) {
    this.migrationsPromise = migrations
      ? Promise.resolve(migrations)
      : loadProjectMigrations();
  }

  async createProject(
    input: CreateProjectInput,
    paths: Array<{
      type: ProjectPathType;
      path: string;
      label?: string | null;
    }> = [],
  ) {
    const project = this.registry.create(input);
    for (const projectPath of paths) {
      this.registry.addPath(project.slug, projectPath);
    }
    updateProjectJson(projectConfigPath(project.slug), {
      current_branch: "main",
      sync_unborn_bootstrap: true,
    });
    const handle = await this.open(project);
    handle.close();
    return project;
  }

  async open(
    projectOrSlug: RegisteredProject | string,
    options: ProjectOpenOptions = {},
  ): Promise<OpenProjectHandle> {
    const project =
      typeof projectOrSlug === "string"
        ? this.registry.findBySlug(projectOrSlug)
        : projectOrSlug;
    if (!project)
      throw new Error(`Project "${String(projectOrSlug)}" not found`);

    const mode = options.migrationMode ?? "apply";
    if (
      mode === "skip" &&
      !(options.allowUnsafeSkip && process.env.NODE_ENV === "test")
    ) {
      throw new Error(
        'migrationMode "skip" is restricted to migration framework tests',
      );
    }

    fs.mkdirSync(projectRoot(project.slug), { recursive: true });
    const scopedDb = new Database(projectDataDbPath(project.slug));
    scopedDb.pragma("journal_mode = WAL");
    scopedDb.pragma("foreign_keys = ON");
    try {
      const migrations = await this.migrationsPromise;
      const cwd =
        this.registry
          .paths(project.slug)
          ?.find((entry) => entry.type === "local")?.path ??
        projectRoot(project.slug);
      const runner = new ProjectMigrationRunner({
        project,
        cwd: path.resolve(cwd),
        mainDb: this.registry.db,
        scopedDb,
        migrations,
        projectDirectory: projectRoot(project.slug),
        projectJsonPath: projectConfigPath(project.slug),
        log: this.logger,
      });
      if (mode === "apply") await runner.migrate();
      else if (mode === "status-only") runner.status();

      const store =
        mode === "status-only"
          ? null
          : createMigratedProjectStore(project, scopedDb);
      return {
        project,
        cwd,
        runner,
        store,
        close: () => (store ? store.close() : scopedDb.close()),
      };
    } catch (error) {
      scopedDb.close();
      throw error;
    }
  }

  async openStore(projectOrSlug: RegisteredProject | string) {
    const handle = await this.open(projectOrSlug);
    if (!handle.store) throw new Error("Project store was not opened");
    return handle.store;
  }

  inspect(projectOrSlug: RegisteredProject | string) {
    return this.open(projectOrSlug, { migrationMode: "status-only" });
  }
}
