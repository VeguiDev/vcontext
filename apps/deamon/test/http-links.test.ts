import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Hono } from "hono";
import type { AppServices } from "../src/app.js";
import type { RegistryStore } from "../src/storage/registry-store.js";
import type { RegisteredProject } from "../src/storage/registry-store.js";

describe("HTTP project link routes", { concurrency: false }, () => {
  let registry: RegistryStore;
  let app: Hono;
  let tempHome: string;
  let prevHome: string | undefined;
  let projectA: RegisteredProject;
  let projectB: RegisteredProject;
  let projectC: RegisteredProject;

  before(async () => {
    tempHome = await mkdtemp(path.join(tmpdir(), "vcontext-http-links-"));
    prevHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = tempHome;

    const [{ RegistryStore: RS }, { registerRegistryRoutes }] =
      await Promise.all([
        import("../src/storage/registry-store.js"),
        import("../src/http/routes/registry.js"),
      ]);

    registry = new RS();
    projectA = registry.create({ name: "HTTP Link A" });
    projectB = registry.create({ name: "HTTP Link B" });
    projectC = registry.create({ name: "HTTP Link C" });

    const services: AppServices = {
      registry,
      projectService: undefined as never,
      application: undefined as never,
      Project: async () => null,
    };

    app = new Hono();
    registerRegistryRoutes(app, services);
  });

  after(async () => {
    registry.close();
    await rm(tempHome, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
    if (prevHome === undefined) {
      delete process.env.VCONTEXT_HOME;
    } else {
      process.env.VCONTEXT_HOME = prevHome;
    }
  });

  it("GET /projects/:slug/links returns empty array", async () => {
    const res = await app.request(`/projects/${projectA.slug}/links`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, []);
  });

  it("POST /projects/:slug/links creates a project-level link", async () => {
    const res = await app.request(`/projects/${projectA.slug}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_b_slug: projectB.slug }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { linked: boolean };
    assert.equal(body.linked, true);
  });

  it("POST /projects/:slug/links creates a branch-level link", async () => {
    const res = await app.request(`/projects/${projectA.slug}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_b_slug: projectC.slug,
        branch_name: "main",
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { linked: boolean };
    assert.equal(body.linked, true);
  });

  it("GET /projects/:slug/links lists all links", async () => {
    const res = await app.request(`/projects/${projectA.slug}/links`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 2);

    // Find expected links
    const linkB = body.find(
      (l: { slug: string }) => l.slug === projectB.slug,
    );
    assert.ok(linkB);
    assert.equal(linkB.branch_name, null);
    assert.equal(linkB.snapshot_id, null);

    const linkC = body.find(
      (l: { slug: string }) => l.slug === projectC.slug,
    );
    assert.ok(linkC);
    assert.equal(linkC.branch_name, "main");
    assert.equal(linkC.snapshot_id, null);
  });

  it("GET /projects/:slug/links returns 404 for unknown project", async () => {
    const res = await app.request("/projects/nonexistent/links");
    assert.equal(res.status, 404);
  });

  it("POST /projects/:slug/links returns 404 for unknown target", async () => {
    const res = await app.request(`/projects/${projectA.slug}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_b_slug: "nonexistent" }),
    });
    assert.equal(res.status, 404);
  });

  it("POST handles duplicate link gracefully", async () => {
    // Create the same link again
    const res = await app.request(`/projects/${projectA.slug}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_b_slug: projectB.slug }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { linked: boolean };
    // Duplicate insertion returns false (UNIQUE constraint)
    assert.equal(body.linked, false);
  });

  it("DELETE /projects/:slug/links removes a specific link", async () => {
    // Remove the branch-level link
    const res = await app.request(`/projects/${projectA.slug}/links`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_b_slug: projectC.slug,
        branch_name: "main",
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { unlinked: boolean };
    assert.equal(body.unlinked, true);

    // Verify only one link remains
    const listRes = await app.request(`/projects/${projectA.slug}/links`);
    const list = await listRes.json();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.slug, projectB.slug);
  });

  it("DELETE /projects/:slug/links returns false for non-existent link", async () => {
    const res = await app.request(`/projects/${projectA.slug}/links`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_b_slug: projectC.slug,
        branch_name: "nonexistent",
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { unlinked: boolean };
    assert.equal(body.unlinked, false);
  });

  it("DELETE /projects/:slug/links/all removes all links", async () => {
    // First re-add project-level link for projectC
    await app.request(`/projects/${projectA.slug}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_b_slug: projectC.slug }),
    });

    // Verify 2 links exist
    const beforeRes = await app.request(
      `/projects/${projectA.slug}/links`,
    );
    assert.equal((await beforeRes.json()).length, 2);

    // Delete all links between A and C
    const res = await app.request(`/projects/${projectA.slug}/links/all`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_b_slug: projectC.slug }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { unlinked: boolean };
    assert.equal(body.unlinked, true);

    // Verify only projectB link remains
    const afterRes = await app.request(
      `/projects/${projectA.slug}/links`,
    );
    const list = await afterRes.json();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.slug, projectB.slug);
  });

  it("DELETE /projects/:slug/links/all handles non-existent pair", async () => {
    const res = await app.request(`/projects/${projectA.slug}/links/all`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_b_slug: "nonexistent" }),
    });
    assert.equal(res.status, 404);
  });

  it("backward compat: project-level link survives alongside branch links", async () => {
    // projectA already has project-level link to projectB
    // Add a branch-level link to projectB
    const res = await app.request(`/projects/${projectA.slug}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_b_slug: projectB.slug,
        branch_name: "develop",
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { linked: boolean }).linked, true);

    // Both links should be present
    const listRes = await app.request(
      `/projects/${projectA.slug}/links`,
    );
    const list = await listRes.json();
    assert.equal(list.length, 2);

    const projectLevel = list.find(
      (l: { slug: string; branch_name: string | null }) =>
        l.slug === projectB.slug && l.branch_name === null,
    );
    assert.ok(projectLevel);

    const branchLevel = list.find(
      (l: { slug: string; branch_name: string | null }) =>
        l.slug === projectB.slug && l.branch_name === "develop",
    );
    assert.ok(branchLevel);
  });
});
