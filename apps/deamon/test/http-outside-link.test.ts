import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AppServices } from "../src/app.js";
import type { RegistryStore } from "../src/storage/registry-store.js";
import type { RegisteredProject } from "../src/storage/registry-store.js";

const BASE_URL = "http://localhost";

describe("HTTP outside-link endpoints", { concurrency: false }, () => {
  let home = "";
  let previousHome: string | undefined;
  let registry: RegistryStore;
  let app: { request: (url: string, init?: RequestInit) => Promise<Response> };
  let authToken: string;
  let headers: Record<string, string>;
  let slug = "";

  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "vcontext-http-outside-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;

    const [{ RegistryStore }, { ProjectService }, { createApp }] =
      await Promise.all([
        import("../src/storage/registry-store.js"),
        import("../src/project/project-service.js"),
        import("../src/app.js"),
      ]);

    registry = new RegistryStore();
    const project = registry.create({ name: "HTTP Outside Link Test" });
    slug = project.slug;
    const projectService = new ProjectService(registry);

    const services: AppServices = {
      registry,
      projectService,
      Project: async (s) =>
        registry.findBySlug(s) ? projectService.openStore(s) : null,
    };

    const instance = createApp(services);
    authToken = "test-token";
    app = {
      request: async (url, init) => {
        const requestInit: RequestInit = {
          ...init,
          headers: {
            authorization: `Bearer ${authToken}`,
            "content-type": "application/json",
            ...((init?.headers as Record<string, string>) || {}),
          },
        };
        return instance.fetch(
          new Request(new URL(url, BASE_URL).toString(), requestInit),
        );
      },
    };
    headers = {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json",
    };
  });

  after(async () => {
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  it("POST /projects/:slug/outside-links creates a link", async () => {
    const res = await app.request(`/projects/${slug}/outside-links`, {
      method: "POST",
      body: JSON.stringify({
        target_project_slug: "target-project",
        target_type: "project",
        kind: "api",
        description: "HTTP-created link",
      }),
    });
    assert.equal(res.status, 201);
    const body: Record<string, unknown> = await res.json();
    assert.ok(body.record_id);
    assert.equal(body.target_project_slug, "target-project");
    assert.equal(body.kind, "api");
    assert.equal(body.description, "HTTP-created link");
  });

  it("GET /projects/:slug/outside-links lists links", async () => {
    const res = await app.request(`/projects/${slug}/outside-links`);
    assert.equal(res.status, 200);
    const body: unknown[] = await res.json();
    assert.ok(Array.isArray(body));
    assert.ok(body.length >= 1);
  });

  it("GET /projects/:slug/outside-links/:recordId gets a link", async () => {
    // Create a link first
    const createRes = await app.request(`/projects/${slug}/outside-links`, {
      method: "POST",
      body: JSON.stringify({
        target_project_slug: "get-test",
        target_type: "file",
        kind: "lib",
        description: "Get this link",
      }),
    });
    const created: Record<string, unknown> = await createRes.json();

    const res = await app.request(
      `/projects/${slug}/outside-links/${created.record_id}`,
    );
    assert.equal(res.status, 200);
    const body: Record<string, unknown> = await res.json();
    assert.equal(body.record_id, created.record_id);
    assert.equal(body.description, "Get this link");
  });

  it("PATCH /projects/:slug/outside-links/:recordId updates a link", async () => {
    const createRes = await app.request(`/projects/${slug}/outside-links`, {
      method: "POST",
      body: JSON.stringify({
        target_project_slug: "update-test",
        target_type: "project",
        kind: "dependency",
        description: "Before update",
      }),
    });
    const created: Record<string, unknown> = await createRes.json();

    const res = await app.request(
      `/projects/${slug}/outside-links/${created.record_id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          description: "After update",
          kind: "sdk",
        }),
      },
    );
    assert.equal(res.status, 200);
    const body: Record<string, unknown> = await res.json();
    assert.equal(body.record_id, created.record_id);
    assert.equal(body.description, "After update");
    assert.equal(body.kind, "sdk");
  });

  it("DELETE /projects/:slug/outside-links/:recordId deletes a link", async () => {
    const createRes = await app.request(`/projects/${slug}/outside-links`, {
      method: "POST",
      body: JSON.stringify({
        target_project_slug: "delete-test",
        target_type: "directory",
        kind: "import",
        description: "Delete me",
      }),
    });
    const created: Record<string, unknown> = await createRes.json();

    const res = await app.request(
      `/projects/${slug}/outside-links/${created.record_id}`,
      { method: "DELETE" },
    );
    assert.equal(res.status, 200);
    const body: Record<string, unknown> = await res.json();
    assert.equal(body.deleted, true);

    // Confirm deletion — getOutsideLink throws RECORD_NOT_FOUND (404)
    const getRes = await app.request(
      `/projects/${slug}/outside-links/${created.record_id}`,
    );
    assert.equal(getRes.status, 404);
  });

  it("GET /projects/:slug/outside-links/by-source/:fileContextRecordId filters by source", async () => {
    const fcRes = await app.request(`/projects/${slug}/file-context`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        path: "src/filtered.ts",
        description: "Filtered source",
        kind: "file",
      }),
    });
    const fc: Record<string, unknown> = await fcRes.json();
    const fcRecordId = fc.record_id as string;
    assert.ok(fcRecordId, "file context record_id should exist");

    // Create two links with same source
    await app.request(`/projects/${slug}/outside-links`, {
      method: "POST",
      body: JSON.stringify({
        source_file_context_id: fcRecordId,
        target_project_slug: "source-a",
        target_type: "project",
        kind: "api",
        description: "Source A link 1",
      }),
    });
    await app.request(`/projects/${slug}/outside-links`, {
      method: "POST",
      body: JSON.stringify({
        source_file_context_id: fcRecordId,
        target_project_slug: "source-b",
        target_type: "project",
        kind: "lib",
        description: "Source A link 2",
      }),
    });

    const res = await app.request(
      `/projects/${slug}/outside-links/by-source/${fcRecordId}`,
    );
    assert.equal(res.status, 200);
    const body: unknown[] = await res.json();
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 2);
  });

  it("POST /projects/:slug/outside-links returns 400 for missing required fields", async () => {
    const res = await app.request(`/projects/${slug}/outside-links`, {
      method: "POST",
      body: JSON.stringify({
        target_project_slug: "p",
        // missing description
      }),
    });
    assert.equal(res.status, 400);
  });

  it("DELETE /projects/:slug/outside-links/:recordId returns error for non-existent", async () => {
    const res = await app.request(
      `/projects/${slug}/outside-links/non-existent-id`,
      { method: "DELETE" },
    );
    // The service throws RECORD_NOT_FOUND which maps to a 404 status
    assert.ok(res.status === 404 || res.status === 400);
  });
});
