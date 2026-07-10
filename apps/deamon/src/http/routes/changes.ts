import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import { CreateChangeSchema } from "../schemas.js";

export function registerChangeRoutes(app: Hono, services: AppServices) {
  app.get("/projects/:slug/changes", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.change.find());
  });

  app.post("/projects/:slug/changes", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = CreateChangeSchema.parse(await c.req.json());

    return c.json(project.change.create(body), 201);
  });
}
