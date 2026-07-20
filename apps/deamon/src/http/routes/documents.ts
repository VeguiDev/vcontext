import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import { CreateDocumentSchema, UpdateDocumentSchema } from "@repo/vcontext-mcp";
import { locator, readSelector, writeSelector } from "./entity-selectors.js";

export function registerDocumentRoutes(app: Hono, services: AppServices) {
  const service = services.application!;
  app.get("/projects/:slug/documents", async (c) =>
    c.json(await service.list(locator(c), "document", readSelector(c))),
  );
  app.get("/projects/:slug/documents/:documentId", async (c) =>
    c.json(
      await service.show(
        locator(c),
        "document",
        c.req.param("documentId"),
        readSelector(c),
      ),
    ),
  );
  app.get("/projects/:slug/documents/:documentId/history", async (c) =>
    c.json(
      await service.history(
        locator(c),
        "document",
        c.req.param("documentId"),
        readSelector(c),
      ),
    ),
  );
  app.post("/projects/:slug/documents", async (c) =>
    c.json(
      await service.create(
        locator(c),
        "document",
        CreateDocumentSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
      201,
    ),
  );
  app.patch("/projects/:slug/documents/:documentId", async (c) =>
    c.json(
      await service.update(
        locator(c),
        "document",
        c.req.param("documentId"),
        UpdateDocumentSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
    ),
  );
  app.delete("/projects/:slug/documents/:documentId", async (c) =>
    c.json(
      await service.delete(
        locator(c),
        "document",
        c.req.param("documentId"),
        writeSelector(c),
      ),
    ),
  );
}
