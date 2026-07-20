import type { Hono } from "hono";
import { CreateChangeSchema } from "@repo/vcontext-mcp";
import type { AppServices } from "../../app.js";
import { locator, readSelector, writeSelector } from "./entity-selectors.js";

const UpdateChangeSchema = CreateChangeSchema.partial();

export function registerChangeRoutes(app: Hono, services: AppServices) {
  const service = services.application!;
  app.get("/projects/:slug/changes", async (c) =>
    c.json(await service.list(locator(c), "change_note", readSelector(c))),
  );
  app.get("/projects/:slug/changes/:changeId", async (c) =>
    c.json(
      await service.show(
        locator(c),
        "change_note",
        c.req.param("changeId"),
        readSelector(c),
      ),
    ),
  );
  app.get("/projects/:slug/changes/:changeId/history", async (c) =>
    c.json(
      await service.history(
        locator(c),
        "change_note",
        c.req.param("changeId"),
        readSelector(c),
      ),
    ),
  );
  app.post("/projects/:slug/changes", async (c) =>
    c.json(
      await service.create(
        locator(c),
        "change_note",
        CreateChangeSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
      201,
    ),
  );
  app.patch("/projects/:slug/changes/:changeId", async (c) =>
    c.json(
      await service.update(
        locator(c),
        "change_note",
        c.req.param("changeId"),
        UpdateChangeSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
    ),
  );
  app.delete("/projects/:slug/changes/:changeId", async (c) =>
    c.json(
      await service.delete(
        locator(c),
        "change_note",
        c.req.param("changeId"),
        writeSelector(c),
      ),
    ),
  );
}
