import { z } from "zod";
import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import { locator, readSelector, writeSelector } from "./entity-selectors.js";

const FileOutsideLinkKindEnum = z.enum([
  "lib",
  "sdk",
  "api",
  "dependency",
  "external_call",
  "import",
]);

const FileOutsideLinkTargetTypeEnum = z.enum([
  "file",
  "directory",
  "project",
]);

const CreateOutsideLinkSchema = z.object({
  source_file_context_id: z.string().nullable().optional(),
  target_project_slug: z.string().min(1),
  target_path: z.string().nullable().optional(),
  target_type: FileOutsideLinkTargetTypeEnum.optional(),
  target_branch_name: z.string().nullable().optional(),
  target_snapshot_id: z.string().nullable().optional(),
  kind: FileOutsideLinkKindEnum.optional(),
  description: z.string().min(1),
});

const UpdateOutsideLinkSchema = CreateOutsideLinkSchema.partial();

export function registerFileOutsideLinkRoutes(
  app: Hono,
  services: AppServices,
) {
  const service = services.application!;

  app.get("/projects/:slug/outside-links", async (c) =>
    c.json(await service.listOutsideLinks(locator(c), readSelector(c))),
  );

  app.get(
    "/projects/:slug/outside-links/by-source/:fileContextRecordId",
    async (c) =>
      c.json(
        await service.getOutsideLinksBySource(
          locator(c),
          c.req.param("fileContextRecordId"),
          readSelector(c),
        ),
      ),
  );

  app.get("/projects/:slug/outside-links/:recordId", async (c) =>
    c.json(
      await service.getOutsideLink(
        locator(c),
        c.req.param("recordId"),
        readSelector(c),
      ),
    ),
  );

  app.post("/projects/:slug/outside-links", async (c) =>
    c.json(
      await service.createOutsideLink(
        locator(c),
        CreateOutsideLinkSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
      201,
    ),
  );

  app.patch("/projects/:slug/outside-links/:recordId", async (c) =>
    c.json(
      await service.updateOutsideLink(
        locator(c),
        c.req.param("recordId"),
        UpdateOutsideLinkSchema.parse(await c.req.json()),
        writeSelector(c),
      ),
    ),
  );

  app.delete("/projects/:slug/outside-links/:recordId", async (c) =>
    c.json(
      await service.deleteOutsideLink(
        locator(c),
        c.req.param("recordId"),
        writeSelector(c),
      ),
    ),
  );
}
