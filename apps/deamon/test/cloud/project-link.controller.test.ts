import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Hono } from "hono";
import { z } from "zod";
import type { CloudAuthorizationService, CloudProjectRole, CloudProjectLinkService } from "../../src/cloud/project-link-service.js";
import type { RegistryStore } from "../../src/storage/registry-store.js";
import { registerCloudProjectLinkRoutes } from "../../src/http/routes/cloud-project-links.js";
import { ApplicationError } from "../../src/application/errors.js";

/**
 * Helper: create a Hono app with the cloud project link routes registered
 * and a global error handler that returns JSON for ApplicationError.
 */
function createTestApp(
  linkService: CloudProjectLinkService,
): Hono {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof ApplicationError) {
      const status =
        error.code === "FORBIDDEN" ? 403 :
        error.code === "CONFLICT" ? 409 :
        error.code === "PROJECT_NOT_FOUND" ? 404 :
        error.code === "RECORD_NOT_FOUND" ? 404 :
        400;
      return c.json({ error: error.code, message: error.message }, status as 400);
    }
    if (error instanceof z.ZodError) {
      return c.json(
        { error: "VALIDATION_ERROR", message: "Request validation failed", issues: error.issues },
        400,
      );
    }
    throw error;
  });
  registerCloudProjectLinkRoutes(app, linkService);
  return app;
}

describe("CloudProjectLinkController", { concurrency: false }, () => {
  let home: string;
  let previousHome: string | undefined;
  let registry: RegistryStore;
  let linkService: CloudProjectLinkService;
  let app: Hono;
  let projectSlug: string;
  let targetSlug: string;
  const userId = "controller-user";

  const permissions = new Map<string, Map<string, CloudProjectRole>>();

  function setPermission(slug: string, user: string, role: CloudProjectRole) {
    if (!permissions.has(slug)) permissions.set(slug, new Map());
    permissions.get(slug)!.set(user, role);
  }

  const mockAuth: CloudAuthorizationService = {
    async getProjectPermission(slug: string, user: string) {
      const slugPerms = permissions.get(slug);
      const role = slugPerms?.get(user);
      if (!role) return null;
      return { role, userId: user };
    },
  };

  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "vcontext-cloud-link-controller-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;

    const [{ RegistryStore }, { CloudProjectLinkService }] =
      await Promise.all([
        import("../../src/storage/registry-store.js"),
        import("../../src/cloud/project-link-service.js"),
      ]);

    registry = new RegistryStore();
    const project = registry.create({ name: "Controller Project" });
    const target = registry.create({ name: "Controller Target" });
    projectSlug = project.slug;
    targetSlug = target.slug;

    // Grant permissions
    setPermission(projectSlug, userId, "OWNER");
    setPermission(targetSlug, userId, "READER");

    linkService = new CloudProjectLinkService(registry, mockAuth);
    app = createTestApp(linkService);
  });

  after(async () => {
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  describe("POST /cloud/projects/:slug/links", () => {
    const url = (slug: string) => `/cloud/projects/${slug}/links`;

    it("returns 201 when link is created", async () => {
      const res = await app.request(url(projectSlug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_slug: targetSlug, user_id: userId }),
      });

      assert.equal(res.status, 201);
      const body = await res.json() as Record<string, unknown>;
      assert.equal(body.slug, targetSlug);
    });

    it("returns 403 when caller lacks source permission", async () => {
      const unauthorizedUser = "no-permission";
      const res = await app.request(url(projectSlug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_slug: targetSlug, user_id: unauthorizedUser }),
      });

      assert.equal(res.status, 403);
      const body = await res.json() as Record<string, unknown>;
      assert.equal(body.error, "FORBIDDEN");
    });

    it("returns 403 when caller lacks target read permission", async () => {
      const readOnlySourceUser = "no-target-access";
      setPermission(projectSlug, readOnlySourceUser, "OWNER");
      // Don't set target permission

      const res = await app.request(url(projectSlug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_slug: targetSlug, user_id: readOnlySourceUser }),
      });

      assert.equal(res.status, 403);
    });

    it("returns 404 when target project does not exist", async () => {
      const res = await app.request(url(projectSlug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_slug: "non-existent-project", user_id: userId }),
      });

      assert.equal(res.status, 404);
    });

    it("returns 409 when duplicate link is created", async () => {
      const res = await app.request(url(projectSlug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_slug: targetSlug, user_id: userId }),
      });

      assert.equal(res.status, 409);
    });

    it("returns 400 on invalid request body", async () => {
      const res = await app.request(url(projectSlug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 400);
    });
  });

  describe("GET /cloud/projects/:slug/links", () => {
    it("returns 200 with links array", async () => {
      const res = await app.request(
        `/cloud/projects/${projectSlug}/links?user_id=${userId}`,
      );

      assert.equal(res.status, 200);
      const body = await res.json() as unknown[];
      assert.ok(Array.isArray(body));
      assert.ok(body.length >= 1);
    });

    it("returns 403 when caller lacks permission", async () => {
      const res = await app.request(
        `/cloud/projects/${projectSlug}/links?user_id=unauthorized`,
      );

      assert.equal(res.status, 403);
    });

    it("returns 400 when user_id is missing", async () => {
      const res = await app.request(
        `/cloud/projects/${projectSlug}/links`,
      );

      assert.equal(res.status, 400);
    });
  });

  describe("DELETE /cloud/projects/:slug/links/:target", () => {
    it("returns 200 when link is removed", async () => {
      // First ensure the link exists by re-creating it
      const createRes = await app.request(
        `/cloud/projects/${projectSlug}/links`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_slug: targetSlug, user_id: userId }),
        },
      );
      if (createRes.status === 409) {
        // Link already exists from previous test — that's fine
      }

      const res = await app.request(
        `/cloud/projects/${projectSlug}/links/${targetSlug}?user_id=${userId}`,
        { method: "DELETE" },
      );

      assert.equal(res.status, 200);
      const body = await res.json() as Record<string, unknown>;
      assert.equal(body.deleted, true);
    });

    it("returns 403 when caller lacks permission", async () => {
      const res = await app.request(
        `/cloud/projects/${projectSlug}/links/${targetSlug}?user_id=unauthorized`,
        { method: "DELETE" },
      );

      assert.equal(res.status, 403);
    });

    it("returns 400 when user_id is missing", async () => {
      const res = await app.request(
        `/cloud/projects/${projectSlug}/links/${targetSlug}`,
        { method: "DELETE" },
      );

      assert.equal(res.status, 400);
    });
  });
});
