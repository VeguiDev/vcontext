import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import {
  CreateTaskSchema,
  parseId,
  TaskStatusSchema,
  UpdateTaskSchema,
} from "@repo/vcontext-mcp";

export function registerTaskRoutes(app: Hono, services: AppServices) {
  app.get("/projects/:slug/tasks", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const status = c.req.query("status");

    if (status) {
      return c.json(project.task.find(TaskStatusSchema.parse(status)));
    }

    return c.json(project.task.find());
  });

  app.post("/projects/:slug/tasks", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = CreateTaskSchema.parse(await c.req.json());

    return c.json(project.task.create(body), 201);
  });

  app.patch("/projects/:slug/tasks/:taskId", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = UpdateTaskSchema.parse(await c.req.json());
    const task = project.task.update(parseId(c.req.param("taskId")), body);

    if (!task) {
      return c.json({ error: "task_not_found" }, 404);
    }

    return c.json(task);
  });

  app.delete("/projects/:slug/tasks/:taskId", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      deleted: project.task.delete(parseId(c.req.param("taskId"))),
    });
  });
}
