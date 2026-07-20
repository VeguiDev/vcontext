import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import {
  CreateTaskSchema,
  TaskStatusSchema,
  UpdateTaskSchema,
} from "@repo/vcontext-mcp";
import { locator, readSelector, writeSelector } from "./entity-selectors.js";

export function registerTaskRoutes(app: Hono, services: AppServices) {
  const service = services.application!;
  app.get("/projects/:slug/tasks", async (c) =>
    c.json(
      await service.list(
        locator(c),
        "task",
        readSelector(c),
        c.req.query("status")
          ? TaskStatusSchema.parse(c.req.query("status"))
          : undefined,
      ),
    ),
  );
  app.get("/projects/:slug/tasks/:taskId", async (c) =>
    c.json(
      await service.show(
        locator(c),
        "task",
        c.req.param("taskId"),
        readSelector(c),
      ),
    ),
  );
  app.get("/projects/:slug/tasks/:taskId/history", async (c) =>
    c.json(
      await service.history(
        locator(c),
        "task",
        c.req.param("taskId"),
        readSelector(c),
      ),
    ),
  );
  app.post("/projects/:slug/tasks", async (c) =>
    c.json(
      await service.create(
        locator(c),
        "task",
        CreateTaskSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
      201,
    ),
  );
  app.patch("/projects/:slug/tasks/:taskId", async (c) =>
    c.json(
      await service.update(
        locator(c),
        "task",
        c.req.param("taskId"),
        UpdateTaskSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
    ),
  );
  app.delete("/projects/:slug/tasks/:taskId", async (c) =>
    c.json(
      await service.delete(
        locator(c),
        "task",
        c.req.param("taskId"),
        writeSelector(c),
      ),
    ),
  );
}
