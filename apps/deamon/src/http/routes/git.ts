import type { Hono } from "hono";
import { z } from "zod";
import type { AppServices } from "../../app.js";
import { GitObservationService } from "../../git/git-observation-service.js";

export function registerGitRoutes(app: Hono, services: AppServices) {
  const git = services.git ??= new GitObservationService(services.projectService);
  app.post("/projects/:slug/git/events", async (c) => c.json(await git.observe(c.req.param("slug"), z.object({ event: z.enum(["post-checkout", "post-commit", "post-merge", "post-rewrite", "pre-push"]), cwd: z.string().min(1), args: z.array(z.string()).optional(), stdin: z.string().optional() }).strict().parse(await c.req.json()))));
  app.get("/projects/:slug/sync/queue", async (c) => c.json(await git.queueStatus(c.req.param("slug"))));
  app.post("/projects/:slug/sync/queue/retry", async (c) => c.json(await git.retry(c.req.param("slug"))));
}
