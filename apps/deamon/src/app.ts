import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import { registerChangeRoutes } from "./http/routes/changes.js";
import { registerDaemonRoutes } from "./http/routes/daemon.js";
import { registerDocumentRoutes } from "./http/routes/documents.js";
import { registerFileContextRoutes } from "./http/routes/file-context.js";
import { registerProjectContextRoutes } from "./http/routes/project-context.js";
import { registerPromptRoutes } from "./http/routes/prompts.js";
import { registerRegistryRoutes } from "./http/routes/registry.js";
import { registerTaskRoutes } from "./http/routes/tasks.js";
import type { ProjectStore } from "./storage/project-store.js";
import type { RegistryStore } from "./storage/registry-store.js";

export interface AppServices {
  registry: RegistryStore;
  Project: (slug: string) => ProjectStore | null;
  pid?: number;
  shutdown?: () => void;
}

export function createApp(services: AppServices) {
  const app = new Hono();

  app.use(logger());
  app.onError((error, c) => {
    if (error instanceof z.ZodError) {
      return c.json({ error: "invalid_request", issues: error.issues }, 400);
    }

    console.error(error);

    return c.json({ error: "internal_error" }, 500);
  });

  registerDaemonRoutes(app, services);
  registerRegistryRoutes(app, services);
  registerProjectContextRoutes(app, services);
  registerPromptRoutes(app, services);
  registerDocumentRoutes(app, services);
  registerChangeRoutes(app, services);
  registerTaskRoutes(app, services);
  registerFileContextRoutes(app, services);

  return app;
}
