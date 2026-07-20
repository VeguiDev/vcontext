import type { Hono } from "hono";
import { z } from "zod";
import type { AppServices } from "../../app.js";

const RunMigrationSchema = z.object({
  to: z.string().optional(),
});

export function registerMigrationRoutes(app: Hono, services: AppServices) {
  app.get("/projects/:slug/migrations/status", async (c) => {
    const handle = await services.projectService.inspect(c.req.param("slug"));
    try {
      return c.json(handle.runner.status());
    } finally {
      handle.close();
    }
  });

  app.get("/projects/:slug/migrations/list", async (c) => {
    const handle = await services.projectService.inspect(c.req.param("slug"));
    try {
      const status = handle.runner.status();
      return c.json({
        project_slug: status.project_slug,
        current_version: status.current_version,
        latest_version: status.latest_version,
        migrations: [
          ...status.applied.map((migration) => ({
            ...migration,
            state: "applied" as const,
          })),
          ...status.pending.map((migration) => ({
            ...migration,
            state: "pending" as const,
          })),
        ],
      });
    } finally {
      handle.close();
    }
  });

  app.get("/projects/:slug/migrations/pending", async (c) => {
    const handle = await services.projectService.inspect(c.req.param("slug"));
    try {
      return c.json({
        project_slug: handle.project.slug,
        pending: handle.runner.pending(),
      });
    } finally {
      handle.close();
    }
  });

  app.post("/projects/:slug/migrations/run", async (c) => {
    const body = RunMigrationSchema.parse(
      c.req.header("content-length") === "0" ? {} : await c.req.json(),
    );
    const handle = await services.projectService.inspect(c.req.param("slug"));
    try {
      return c.json(
        body.to
          ? await handle.runner.migrateTo(body.to)
          : await handle.runner.migrate(),
      );
    } finally {
      handle.close();
    }
  });
}
