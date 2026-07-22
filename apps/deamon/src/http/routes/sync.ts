import type { Context, Hono } from "hono";
import { z } from "zod";
import { VContextSyncError } from "@vcontext/versioning-contract";
import type { AppServices } from "../../app.js";
import { SyncService } from "../../sync/sync-service.js";

const remoteName = z.string().min(1).max(100);
const remoteBody = z.object({ name: remoteName, url: z.url() }).strict();

export function registerSyncRoutes(app: Hono, services: AppServices) {
  const sync = services.sync ??= new SyncService(services.projectService);
  app.post("/sync/clone", async (c) => {
    const body = z.object({ remote_url: z.url(), path: z.string().min(1), yes: z.boolean().optional() }).strict().parse(await c.req.json());
    return moved(async () => c.json(await sync.clone(body.remote_url, body.path), 201), c, body.yes ? async (location) => c.json(await sync.clone(location, body.path), 201) : undefined);
  });
  app.post("/sync/link", async (c) => {
    const body = z.object({ project: z.string().regex(/^[^/]+\/[^/]+$/), remote_url: z.url(), path: z.string().min(1) }).strict().parse(await c.req.json());
    return c.json(await sync.linkExisting(body.project, body.remote_url, body.path), 201);
  });
  app.get("/projects/:slug/remotes", async (c) => c.json(await sync.remotes(c.req.param("slug"))));
  app.post("/projects/:slug/remotes", async (c) => {
    const body = remoteBody.parse(await c.req.json());
    return c.json(await sync.addRemote(c.req.param("slug"), body.name, body.url), 201);
  });
  app.get("/projects/:slug/remotes/:name", async (c) => c.json(await sync.remote(c.req.param("slug"), c.req.param("name"))));
  app.patch("/projects/:slug/remotes/:name", async (c) => {
    const body = z.object({ url: z.url() }).strict().parse(await c.req.json());
    return c.json(await sync.setRemoteUrl(c.req.param("slug"), c.req.param("name"), body.url));
  });
  app.delete("/projects/:slug/remotes/:name", async (c) => c.json(await sync.removeRemote(c.req.param("slug"), c.req.param("name"))));
  app.post("/projects/:slug/sync/fetch", async (c) => {
    const body = z.object({ remote: remoteName.optional(), branch: z.string().optional(), force: z.boolean().optional(), yes: z.boolean().optional() }).strict().parse(await optionalJson(c));
    const action = async () => c.json(await sync.fetch(c.req.param("slug"), body.remote));
    return moved(action, c, body.yes ? async (location) => { await sync.acceptRemoteMove(c.req.param("slug"), body.remote, location); return action(); } : undefined);
  });
  app.post("/projects/:slug/sync/pull", async (c) => {
    const body = z.object({ remote: remoteName.optional(), branch: z.string().min(1).optional(), yes: z.boolean().optional() }).strict().parse(await optionalJson(c));
    const action = async () => c.json(await sync.pull(c.req.param("slug"), body));
    return moved(action, c, body.yes ? async (location) => { await sync.acceptRemoteMove(c.req.param("slug"), body.remote, location); return action(); } : undefined);
  });
  app.post("/projects/:slug/sync/push", async (c) => {
    const body = z.object({ remote: remoteName.optional(), branch: z.string().min(1).optional(), force: z.boolean().optional(), yes: z.boolean().optional() }).strict().parse(await optionalJson(c));
    const action = async () => c.json(await sync.push(c.req.param("slug"), body));
    return moved(action, c, body.yes ? async (location) => { await sync.acceptRemoteMove(c.req.param("slug"), body.remote, location); return action(); } : undefined);
  });
}

async function moved<T>(action: () => Promise<T>, c: Context, accept?: (location: string) => Promise<T>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof VContextSyncError && error.code === "REMOTE_MOVED") {
      const location = typeof error.details?.location === "string" ? error.details.location : null;
      if (accept && location) return accept(location);
      return c.json({ code: "REMOTE_MOVED", location: error.details?.location ?? null, message: error.message });
    }
    throw error;
  }
}

async function optionalJson(c: { req: { json(): Promise<unknown>; header(name: string): string | undefined } }) {
  return c.req.header("content-length") === "0" ? {} : await c.req.json().catch(() => ({}));
}
