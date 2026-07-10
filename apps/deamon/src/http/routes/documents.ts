import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import {
  CreateDocumentSchema,
  parseId,
  UpdateDocumentSchema,
} from "../schemas.js";

export function registerDocumentRoutes(app: Hono, services: AppServices) {
  app.get("/projects/:slug/documents", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.document.find());
  });

  app.post("/projects/:slug/documents", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = CreateDocumentSchema.parse(await c.req.json());

    return c.json(project.document.create(body), 201);
  });

  app.patch("/projects/:slug/documents/:documentId", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = UpdateDocumentSchema.parse(await c.req.json());
    const document = project.document.update(
      parseId(c.req.param("documentId")),
      body,
    );

    if (!document) {
      return c.json({ error: "document_not_found" }, 404);
    }

    return c.json(document);
  });

  app.delete("/projects/:slug/documents/:documentId", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      deleted: project.document.delete(parseId(c.req.param("documentId"))),
    });
  });
}
