import { z } from "zod";
import type { Hono } from "hono";
import type { CloudProjectLinkService } from "../../cloud/project-link-service.js";

const CreateLinkSchema = z.object({
  target_slug: z.string().min(1),
  user_id: z.string().min(1),
});

const ListLinksQuerySchema = z.object({
  user_id: z.string().min(1),
});

/**
 * Register HTTP routes for cloud project link management.
 *
 * Routes:
 *   POST   /cloud/projects/:slug/links          — create a link
 *   GET    /cloud/projects/:slug/links           — list links
 *   DELETE /cloud/projects/:slug/links/:target   — remove a link
 *
 * Errors propagate to the global Hono error handler which maps
 * ApplicationError and ZodError to proper HTTP responses.
 */
export function registerCloudProjectLinkRoutes(
  app: Hono,
  linkService: CloudProjectLinkService,
) {
  // Create a link
  app.post("/cloud/projects/:slug/links", async (c) => {
    const { target_slug, user_id } = CreateLinkSchema.parse(
      await c.req.json(),
    );
    const link = await linkService.create(
      c.req.param("slug"),
      target_slug,
      user_id,
    );
    return c.json(link, 201);
  });

  // List links
  app.get("/cloud/projects/:slug/links", async (c) => {
    const { user_id } = ListLinksQuerySchema.parse(c.req.query());
    const links = await linkService.findByProjectId(
      c.req.param("slug"),
      user_id,
    );
    return c.json(links);
  });

  // Remove a link
  app.delete("/cloud/projects/:slug/links/:target", async (c) => {
    const user_id = z.string().min(1).parse(c.req.query("user_id"));
    await linkService.remove(
      c.req.param("slug"),
      c.req.param("target"),
      user_id,
    );
    return c.json({ deleted: true });
  });
}
