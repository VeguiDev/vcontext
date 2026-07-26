import { execFileSync } from "node:child_process";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppServices } from "../../app.js";
import {
  CreateProjectSchema,
  LinkProjectSchema,
  ProjectPathSchema,
} from "@repo/vcontext-mcp";

export function registerRegistryRoutes(app: Hono, services: AppServices) {
  app.post("/projects/resolve", async (c) => {
    const body = z.object({ cwd: z.string().min(1) }).strict().parse(await c.req.json());
    const resolver = new (await import("../../project/project-resolver-service.js")).ProjectResolverService(services.projectService, services.sync ? { initialize: (input) => services.sync!.initializeExisting(input) } : undefined);
    return c.json(await resolver.resolve({ cwd: body.cwd }));
  });
  app.get("/projects", (c) => {
    return c.json(services.registry.all());
  });

  app.post("/projects", async (c) => {
    const body = CreateProjectSchema.parse(await c.req.json());
    const project = await services.projectService.createProject(
      body,
      body.paths,
    );

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
      linked: services.registry.link(
        project.id,
        linkedProject.id,
        body.branch_name,
        body.snapshot_id,
      ),
    });
  });

  app.delete("/projects/:slug/links", async (c) => {
    const slug = c.req.param("slug");
    const body = LinkProjectSchema.parse(await c.req.json());
    const project = services.registry.findBySlug(slug);
    const linkedProject = services.registry.findBySlug(body.project_b_slug);

    if (!project || !linkedProject) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      unlinked: services.registry.unlink(
        project.id,
        linkedProject.id,
        body.branch_name,
        body.snapshot_id,
      ),
    });
  });

  app.delete("/projects/:slug/links/all", async (c) => {
    const slug = c.req.param("slug");
    const body = z.object({ project_b_slug: z.string().min(1) }).strict().parse(await c.req.json());
    const project = services.registry.findBySlug(slug);
    const linkedProject = services.registry.findBySlug(body.project_b_slug);

    if (!project || !linkedProject) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      unlinked: services.registry.unlinkAll(project.id, linkedProject.id),
    });
  });

  app.get("/projects/:slug/file-content", async (c) => {
    const slug = c.req.param("slug");
    const filePath = z.string().min(1).parse(c.req.query("path"));
    const branch = z.string().min(1).parse(c.req.query("branch"));

    if (filePath.includes("..") || filePath.startsWith("/")) {
      return c.json({ error: "invalid_path" }, 400);
    }

    const paths = services.registry.paths(slug);

    if (!paths) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const local =
      paths.find(
        (entry) => entry.type === "local" && entry.label === "workspace",
      ) ?? paths.find((entry) => entry.type === "local");

    if (!local) {
      return c.json({ error: "no_local_path" }, 400);
    }

    try {
      const content = execFileSync(
        "git",
        ["show", `${branch}:${filePath}`],
        {
          cwd: local.path,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      return c.text(content, 200, {
        "Content-Type": "text/plain; charset=utf-8",
      });
    } catch {
      return c.json({ error: "file_not_found" }, 404);
    }
  });
}
