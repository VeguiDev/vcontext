import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import { registerChangeRoutes } from "./http/routes/changes.js";
import { registerDaemonRoutes } from "./http/routes/daemon.js";
import { registerDocumentRoutes } from "./http/routes/documents.js";
import { registerFileContextRoutes } from "./http/routes/file-context.js";
import { registerLeaseRoutes } from "./http/routes/leases.js";
import { registerMigrationRoutes } from "./http/routes/migrations.js";
import { registerMcpRoutes } from "./http/routes/mcp.js";
import { registerProjectContextRoutes } from "./http/routes/project-context.js";
import { registerPromptRoutes } from "./http/routes/prompts.js";
import { registerRegistryRoutes } from "./http/routes/registry.js";
import { registerTaskRoutes } from "./http/routes/tasks.js";
import type { ProjectStore } from "./storage/project-store.js";
import type { RegistryStore } from "./storage/registry-store.js";
import type { ProjectService } from "./project/project-service.js";
import { ProjectMigrationError } from "./project/migration-types.js";
import {
  ApplicationError,
  applicationErrorStatus,
} from "./application/errors.js";
import { ProjectApplicationService } from "./application/project-application-service.js";
import { registerVersioningRoutes } from "./http/routes/versioning.js";

export interface AppServices {
  registry: RegistryStore;
  projectService: ProjectService;
  application?: ProjectApplicationService;
  Project: (slug: string) => Promise<ProjectStore | null>;
  migrationFailures?: Map<string, Error>;
  pid?: number;
  shutdown?: () => void;
  activity?: {
    activeRequests: number;
    activeLeases: number;
    lastActivityAt: number;
  };
}

export function createApp(services: AppServices) {
  const app = new Hono();
  services.application ??= new ProjectApplicationService(
    services.projectService,
  );

  app.use(logger());
  app.onError((error, c) => {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          issues: error.issues,
        },
        400,
      );
    }

    if (error instanceof ProjectMigrationError) {
      return c.json(
        {
          error: "MIGRATION_ERROR",
          code: "MIGRATION_ERROR",
          message: error.message,
          migration: error.migration ?? null,
        },
        409,
      );
    }

    if (error instanceof ApplicationError) {
      return c.json(
        { error: error.code, code: error.code, message: error.message },
        applicationErrorStatus[error.code] as 400,
      );
    }

    console.error(error);

    return c.json(
      {
        error: "DATABASE_ERROR",
        code: "DATABASE_ERROR",
        message: "Internal database operation failed",
      },
      500,
    );
  });

  registerDaemonRoutes(app, services);
  registerRegistryRoutes(app, services);
  registerMigrationRoutes(app, services);
  registerProjectContextRoutes(app, services);
  registerPromptRoutes(app, services);
  registerDocumentRoutes(app, services);
  registerChangeRoutes(app, services);
  registerTaskRoutes(app, services);
  registerFileContextRoutes(app, services);
  registerVersioningRoutes(app, services);
  registerMcpRoutes(app, services);
  registerLeaseRoutes(app, services);

  return app;
}
