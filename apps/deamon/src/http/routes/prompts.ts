import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import { ProjectPromptSchema } from "@repo/vcontext-mcp";
import { locator, readSelector, writeSelector } from "./entity-selectors.js";

export function registerPromptRoutes(app: Hono, services: AppServices) {
  const service = services.application!;
  app.get("/projects/:slug/prompts", async (c) =>
    c.json(await service.list(locator(c), "project_prompt", readSelector(c))),
  );
  app.get("/projects/:slug/prompts/:promptId", async (c) =>
    c.json(
      await service.show(
        locator(c),
        "project_prompt",
        c.req.param("promptId"),
        readSelector(c),
      ),
    ),
  );
  app.get("/projects/:slug/prompts/:promptId/history", async (c) =>
    c.json(
      await service.history(
        locator(c),
        "project_prompt",
        c.req.param("promptId"),
        readSelector(c),
      ),
    ),
  );
  app.post("/projects/:slug/prompts", async (c) =>
    c.json(
      await service.create(
        locator(c),
        "project_prompt",
        ProjectPromptSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
      201,
    ),
  );
  app.patch("/projects/:slug/prompts/:promptId", async (c) =>
    c.json(
      await service.update(
        locator(c),
        "project_prompt",
        c.req.param("promptId"),
        ProjectPromptSchema.partial().parse(await c.req.json()),
        writeSelector(c),
      ),
    ),
  );
  app.delete("/projects/:slug/prompts/:promptId", async (c) =>
    c.json(
      await service.delete(
        locator(c),
        "project_prompt",
        c.req.param("promptId"),
        writeSelector(c),
      ),
    ),
  );
}
