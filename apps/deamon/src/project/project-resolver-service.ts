import path from "node:path";
import { findProjectMarker } from "@repo/vcontext-core";
import type { ProjectLocator } from "../application/contracts.js";
import { ApplicationError } from "../application/errors.js";
import type { RegisteredProject } from "../storage/registry-store.js";
import type { ProjectService } from "./project-service.js";

export interface ProjectInitializer {
  initialize(input: {
    project_id: string;
    project: string;
    remote: string;
    cwd: string;
  }): Promise<RegisteredProject>;
}

/** One cwd preflight for CLI, HTTP and MCP. Initialization is serialized by project id. */
export class ProjectResolverService {
  private readonly locks = new Map<string, Promise<RegisteredProject>>();
  constructor(
    private readonly projects: ProjectService,
    private readonly initializer?: ProjectInitializer,
  ) {}

  async resolve(locator: ProjectLocator): Promise<RegisteredProject> {
    if (locator.project_slug) {
      const project = this.projects.registry.findBySlug(locator.project_slug);
      if (project) return project;
      throw new ApplicationError(
        "PROJECT_NOT_FOUND",
        `Project "${locator.project_slug}" is not registered locally.`,
        {
          hint: "Run `vcontext projects` to list the projects available in this environment.",
        },
      );
    }
    if (!locator.cwd)
      throw new ApplicationError(
        "PROJECT_NOT_FOUND",
        "No VContext project was selected.",
        {
          hint: "Run the command inside a registered project or pass `--project <slug>`.",
        },
      );
    const cwd = path.resolve(locator.cwd);
    const marker = findProjectMarker(cwd);
    if (marker) {
      const existing = this.projects.registry.findByUuid(marker.marker.uuid);
      if (existing) {
        this.projects.registry.addPath(existing.slug, {
          type: "local",
          path: marker.root,
          label: "workspace",
        });
        return existing;
      }
      if (marker.legacy)
        throw new ApplicationError(
          "PROJECT_NOT_FOUND",
          "This repository uses a legacy VContext marker and is not registered in the current environment.",
          {
            hint: "Run `vcontext init <project-name> --remote <namespace>/<slug> --path .` to upgrade it.",
            note: "The repository was not modified.",
          },
        );
      if (!this.initializer || !marker.marker.project || !marker.marker.remote)
        throw new ApplicationError(
          "PROJECT_NOT_FOUND",
          "This repository is linked, but its context has not been initialized.",
          {
            hint: "Authenticate with `vcontext auth login`, then run `vcontext fetch`.",
            note: "The repository was not modified.",
          },
        );
      return this.withLock(marker.marker.uuid, () =>
        this.initializer!.initialize({
          project_id: marker.marker.uuid,
          project: marker.marker.project!,
          remote: marker.marker.remote!,
          cwd: marker.root,
        }),
      );
    }
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
    throw new ApplicationError(
      "PROJECT_NOT_FOUND",
      "No VContext project could be resolved from this directory.",
      {
        hint: "Run `vcontext init <project-name> --path .` to register it, or pass `--project <slug>`.",
      },
    );
  }

  private withLock(id: string, action: () => Promise<RegisteredProject>) {
    const active = this.locks.get(id);
    if (active) return active;
    const promise = action().finally(() => this.locks.delete(id));
    this.locks.set(id, promise);
    return promise;
  }
}
