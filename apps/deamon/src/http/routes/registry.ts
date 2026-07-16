import type { Hono } from "hono";
import { z } from "zod";
import type { AppServices } from "../../app.js";
import {
  CreateProjectSchema,
  LinkProjectSchema,
  ProjectPathSchema,
} from "@repo/vcontext-mcp";

export function registerRegistryRoutes(app: Hono, services: AppServices) {
  app.get("/projects", (c) => {
    return c.json(services.registry.all());
  });

  app.post("/projects", async (c) => {
    const body = CreateProjectSchema.parse(await c.req.json());
    const project = services.registry.create(body);

    for (const projectPath of body.paths ?? []) {
      services.registry.addPath(project.slug, projectPath);
    }

    return c.json(project, 201);
  });

  app.get("/projects/by-path", (c) => {
    const type = z.enum(["local", "remote"]).parse(c.req.query("type"));
    const value = z.string().min(1).parse(c.req.query("path"));
    const project = services.registry.findByPath(type, value);

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project);
  });

  app.get("/projects/:slug", (c) => {
    const project = services.registry.findBySlug(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project);
  });

  app.get("/projects/:slug/paths", (c) => {
    const paths = services.registry.paths(c.req.param("slug"));

    if (!paths) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(paths);
  });

  app.post("/projects/:slug/paths", async (c) => {
    const body = ProjectPathSchema.parse(await c.req.json());
    const projectPath = services.registry.addPath(c.req.param("slug"), body);

    if (!projectPath) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(projectPath, 201);
  });

  app.get("/projects/:slug/links", (c) => {
    const links = services.registry.linksBySlug(c.req.param("slug"));

    if (!links) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(links);
  });

  app.post("/projects/:slug/links", async (c) => {
    const slug = c.req.param("slug");
    const body = LinkProjectSchema.parse(await c.req.json());
    const project = services.registry.findBySlug(slug);
    const linkedProject = services.registry.findBySlug(body.project_b_slug);

    if (!project || !linkedProject) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      linked: services.registry.link(project.id, linkedProject.id),
    });
  });
}
