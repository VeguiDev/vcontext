import type { Hono } from "hono";
import { z } from "zod";
import type { AppServices } from "../../app.js";

const readSelector = z
  .object({
    branch: z.string().min(1).optional(),
    snapshot_id: z.string().min(1).optional(),
  })
  .refine((value) => !(value.branch && value.snapshot_id), {
    message: "branch and snapshot_id are mutually exclusive",
  });

const branchName = z.string().min(1);

export function registerVersioningRoutes(app: Hono, services: AppServices) {
  const service = services.application!;
  const locator = (slug: string) => ({ project_slug: slug });
  const selector = (query: Record<string, string>) =>
    readSelector.parse({
      branch: query.branch,
      snapshot_id: query.snapshot ?? query.snapshot_id,
    });

  app.get("/projects/:slug/status", async (c) =>
    c.json(await service.status(locator(c.req.param("slug")))),
  );

  app.get("/projects/:slug/branches", async (c) =>
    c.json(await service.branches(locator(c.req.param("slug")))),
  );
  app.get("/projects/:slug/branches/current", async (c) =>
    c.json(await service.currentBranch(locator(c.req.param("slug")))),
  );
  app.get("/projects/:slug/branches/:name", async (c) =>
    c.json(
      await service.branch(locator(c.req.param("slug")), c.req.param("name")),
    ),
  );
  app.post("/projects/:slug/branches", async (c) => {
    const body = z
      .object({ name: branchName, from: z.string().min(1).optional() })
      .parse(await c.req.json());
    return c.json(
      await service.createBranch(
        locator(c.req.param("slug")),
        body.name,
        body.from,
      ),
      201,
    );
  });
  app.post("/projects/:slug/branches/:name/checkout", async (c) =>
    c.json(
      await service.checkoutBranch(
        locator(c.req.param("slug")),
        c.req.param("name"),
      ),
    ),
  );
  app.patch("/projects/:slug/branches/:name", async (c) => {
    const body = z.object({ name: branchName }).parse(await c.req.json());
    return c.json(
      await service.renameBranch(
        locator(c.req.param("slug")),
        c.req.param("name"),
        body.name,
      ),
    );
  });
  app.delete("/projects/:slug/branches/:name", async (c) =>
    c.json(
      await service.deleteBranch(
        locator(c.req.param("slug")),
        c.req.param("name"),
      ),
    ),
  );

  app.get("/projects/:slug/snapshots", async (c) =>
    c.json(
      await service.snapshots(
        locator(c.req.param("slug")),
        selector(c.req.query()),
        parseLimit(c.req.query("limit")),
      ),
    ),
  );
  app.get("/projects/:slug/snapshots/:snapshotId", async (c) =>
    c.json(
      await service.snapshot(
        locator(c.req.param("slug")),
        c.req.param("snapshotId"),
      ),
    ),
  );
  app.get("/projects/:slug/snapshots/:snapshotId/diff", async (c) =>
    c.json(
      await service.diff(
        locator(c.req.param("slug")),
        c.req.query("from"),
        `snapshot:${c.req.param("snapshotId")}`,
      ),
    ),
  );
  app.post("/projects/:slug/snapshots/:snapshotId/checkout", async (c) => {
    const body = z.object({ branch: branchName }).parse(await c.req.json());
    return c.json(
      await service.checkoutSnapshot(
        locator(c.req.param("slug")),
        c.req.param("snapshotId"),
        body.branch,
      ),
      201,
    );
  });

  app.get("/projects/:slug/log", async (c) =>
    c.json(
      await service.log(
        locator(c.req.param("slug")),
        selector(c.req.query()),
        parseLimit(c.req.query("limit")),
      ),
    ),
  );
  app.get("/projects/:slug/diff", async (c) =>
    c.json(
      await service.diff(
        locator(c.req.param("slug")),
        c.req.query("from"),
        c.req.query("to"),
      ),
    ),
  );

  app.post("/projects/:slug/merge/preview", async (c) => {
    const body = z
      .object({
        source_branch: branchName,
        target_branch: branchName.optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await service.mergePreview(
        locator(c.req.param("slug")),
        body.source_branch,
        body.target_branch,
      ),
    );
  });
  app.post("/projects/:slug/merge/apply", async (c) => {
    const body = z
      .object({
        source_branch: branchName,
        target_branch: branchName.optional(),
        strategy: z.enum(["manual", "source", "target"]).optional(),
        resolutions: z.record(z.string(), z.unknown()).optional(),
        message: z.string().nullable().optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await service.mergeApply(locator(c.req.param("slug")), body as never),
    );
  });
}

function parseLimit(value?: string) {
  return value === undefined ? 50 : Number(value);
}
