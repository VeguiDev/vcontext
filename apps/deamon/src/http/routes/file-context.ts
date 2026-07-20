import type { Hono } from "hono";
import { UpsertFileContextSchema } from "@repo/vcontext-mcp";
import type { AppServices } from "../../app.js";
import { locator, readSelector, writeSelector } from "./entity-selectors.js";

const UpdateFileContextSchema = UpsertFileContextSchema.partial();

export function registerFileContextRoutes(app: Hono, services: AppServices) {
  const service = services.application!;
  app.get("/projects/:slug/file-context", async (c) =>
    c.json(await service.list(locator(c), "file_context", readSelector(c))),
  );
  app.get("/projects/:slug/file-context/by-path", async (c) =>
    c.json(
      await service.getFileContextByPath(
        locator(c),
        c.req.query("path") ?? "",
        readSelector(c),
      ),
    ),
  );
  app.get("/projects/:slug/file-context/:fileContextId", async (c) =>
    c.json(
      await service.show(
        locator(c),
        "file_context",
        c.req.param("fileContextId"),
        readSelector(c),
      ),
    ),
  );
  app.get("/projects/:slug/file-context/:fileContextId/history", async (c) =>
    c.json(
      await service.history(
        locator(c),
        "file_context",
        c.req.param("fileContextId"),
        readSelector(c),
      ),
    ),
  );
  app.post("/projects/:slug/file-context", async (c) =>
    c.json(
      await service.upsertFileContext(
        locator(c),
        UpsertFileContextSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
      201,
    ),
  );
  app.post("/projects/:slug/file-context/add", async (c) =>
    c.json(
      await service.create(
        locator(c),
        "file_context",
        UpsertFileContextSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
      201,
    ),
  );
  app.patch("/projects/:slug/file-context/:fileContextId", async (c) =>
    c.json(
      await service.update(
        locator(c),
        "file_context",
        c.req.param("fileContextId"),
        UpdateFileContextSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
    ),
  );
  app.delete("/projects/:slug/file-context/:fileContextId", async (c) =>
    c.json(
      await service.delete(
        locator(c),
        "file_context",
        c.req.param("fileContextId"),
        writeSelector(c),
      ),
    ),
  );
}
