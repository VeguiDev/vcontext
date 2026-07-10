import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import { parseId, ProjectPromptSchema } from "../schemas.js";

export function registerPromptRoutes(app: Hono, services: AppServices) {
  app.get("/projects/:slug/prompts", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.prompt.find());
  });

  app.post("/projects/:slug/prompts", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = ProjectPromptSchema.parse(await c.req.json());

    return c.json(project.prompt.create(body), 201);
  });

  app.patch("/projects/:slug/prompts/:promptId", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = ProjectPromptSchema.parse(await c.req.json());
    const prompt = project.prompt.update(parseId(c.req.param("promptId")), body);

    if (!prompt) {
      return c.json({ error: "prompt_not_found" }, 404);
    }

    return c.json(prompt);
  });

  app.delete("/projects/:slug/prompts/:promptId", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      deleted: project.prompt.delete(parseId(c.req.param("promptId"))),
    });
  });
}
