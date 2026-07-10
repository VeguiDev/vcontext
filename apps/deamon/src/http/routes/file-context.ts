import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import { parseId, UpsertFileContextSchema } from "../schemas.js";

export function registerFileContextRoutes(app: Hono, services: AppServices) {
  app.get("/projects/:slug/file-context", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.fileContext.find());
  });

  app.post("/projects/:slug/file-context", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = UpsertFileContextSchema.parse(await c.req.json());

    return c.json(project.fileContext.upsert(body), 201);
  });

  app.delete("/projects/:slug/file-context/:fileContextId", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      deleted: project.fileContext.delete(parseId(c.req.param("fileContextId"))),
    });
  });
}
