import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import { registerChangeRoutes } from "./http/routes/changes.js";
import { registerDaemonRoutes } from "./http/routes/daemon.js";
import { registerDocumentRoutes } from "./http/routes/documents.js";
import { registerFileContextRoutes } from "./http/routes/file-context.js";
import { registerFileOutsideLinkRoutes } from "./http/routes/file-outside-link.js";
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
import { registerSyncRoutes } from "./http/routes/sync.js";
import { VContextSyncError } from "@vcontext/versioning-contract";
import type { SyncService } from "./sync/sync-service.js";
import type { GitObservationService } from "./git/git-observation-service.js";
import { registerGitRoutes } from "./http/routes/git.js";
import { CloudProjectLinkService, type CloudAuthorizationService } from "./cloud/project-link-service.js";
import { registerCloudProjectLinkRoutes } from "./http/routes/cloud-project-links.js";
import { AutoLinkPushHook } from "./sync/auto-link-push.js";

export interface AppServices {
  registry: RegistryStore;
  projectService: ProjectService;
  application?: ProjectApplicationService;
  sync?: SyncService;
  git?: GitObservationService;
  Project: (slug: string) => Promise<ProjectStore | null>;
  migrationFailures?: Map<string, Error>;
  pid?: number;
  shutdown?: () => void;
  activity?: {
    activeRequests: number;
    activeLeases: number;
    lastActivityAt: number;
  };
  cloudLinkService?: CloudProjectLinkService;
  autoLinkHook?: AutoLinkPushHook;
  cloudAuth?: CloudAuthorizationService;
}

export function createApp(services: AppServices) {
  const app = new Hono();
  services.application ??= new ProjectApplicationService(
    services.projectService,
  );
  services.cloudLinkService ??= new CloudProjectLinkService(
    services.registry,
    services.cloudAuth ?? {
      async getProjectPermission() {
        return { role: "OWNER", userId: "system" };
      },
    },
  );
  services.autoLinkHook ??= new AutoLinkPushHook(
    services.cloudLinkService,
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
        {
          error: error.code,
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
        applicationErrorStatus[error.code] as 400,
      );
    }

    if (error instanceof VContextSyncError) {
      const status =
        error.code === "UNAUTHENTICATED"
          ? 401
          : error.code === "FORBIDDEN"
            ? 403
            : error.code === "NON_FAST_FORWARD" ||
                error.code === "REF_CONFLICT" ||
                error.code === "OBJECT_COLLISION"
              ? 409
              : error.code === "INTERNAL_ERROR"
                ? 500
                : 400;
      return c.json(error.toJSON(), status as 400);
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
  registerFileOutsideLinkRoutes(app, services);
  registerVersioningRoutes(app, services);
  registerSyncRoutes(app, services);
  registerGitRoutes(app, services);
  registerMcpRoutes(app, services);
  registerLeaseRoutes(app, services);
  registerCloudProjectLinkRoutes(app, services.cloudLinkService!);

  return app;
}
