import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ProjectStore } from "../src/storage/project-store.js";
import type { RegistryStore } from "../src/storage/registry-store.js";

describe("ProjectStore file_outside_link CRUD", { concurrency: false }, () => {
  let home = "";
  let previousHome: string | undefined;
  let registry: RegistryStore;
  let store: ProjectStore;
  let slug = "";

  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "vcontext-outside-link-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;
    const [{ RegistryStore }, { ProjectService }] = await Promise.all([
      import("../src/storage/registry-store.js"),
      import("../src/project/project-service.js"),
    ]);
    registry = new RegistryStore();
    const project = registry.create({ name: "Outside Link Test" });
    slug = project.slug;
    const projectService = new ProjectService(registry);
    store = await projectService.openStore(project);
  });

  after(async () => {
    store.close();
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  it("creates a file_outside_link record", () => {
    const link = store.branch().fileOutsideLink.create({
      target_project_slug: "other-project",
      target_type: "project",
      kind: "api",
      description: "Depends on other-project API",
    });

    assert.ok(link);
    assert.ok(link.record_id);
    assert.equal(link.target_project_slug, "other-project");
    assert.equal(link.target_type, "project");
    assert.equal(link.kind, "api");
    assert.equal(link.description, "Depends on other-project API");
    assert.equal(link.source_file_context_id, null);
    assert.equal(link.target_path, null);
    assert.equal(link.target_branch_name, null);
    assert.equal(link.target_snapshot_id, null);
    assert.equal(link.deleted_at, null);
    assert.ok(link.created_at > 0);
    assert.ok(link.updated_at > 0);
  });

  it("finds the created link in the list", () => {
    const links = store.branch().fileOutsideLink.find();
    assert.equal(links.length, 1);
    assert.equal(links[0]?.target_project_slug, "other-project");
  });

  it("finds a link by record_id", () => {
    const link = store.branch().fileOutsideLink.create({
      target_project_slug: "another-project",
      target_type: "file",
      kind: "lib",
      description: "Shared library",
    });

    const found = store.branch().fileOutsideLink.findByRecordId(link.record_id);
    assert.ok(found);
    assert.equal(found?.record_id, link.record_id);
    assert.equal(found?.target_project_slug, "another-project");
  });

  it("updates a file_outside_link record", () => {
    const link = store.branch().fileOutsideLink.create({
      target_project_slug: "project-to-update",
      target_type: "project",
      kind: "dependency",
      description: "Initial description",
    });

    const updated = store.branch().fileOutsideLink.update(link.record_id, {
      description: "Updated description",
      kind: "sdk",
    });

    assert.ok(updated);
    assert.equal(updated.record_id, link.record_id);
    assert.equal(updated.description, "Updated description");
    assert.equal(updated.kind, "sdk");
    // Fields not in update should remain unchanged
    assert.equal(updated.target_project_slug, "project-to-update");
    assert.equal(updated.target_type, "project");
  });

  it("deletes a file_outside_link record", () => {
    const link = store.branch().fileOutsideLink.create({
      target_project_slug: "project-to-delete",
      target_type: "directory",
      kind: "import",
      description: "Delete me",
    });

    const deleted = store.branch().fileOutsideLink.delete(link.record_id);
    assert.equal(deleted, true);

    const found = store.branch().fileOutsideLink.findByRecordId(link.record_id);
    assert.equal(found, null);
  });

  it("creates a link with all optional fields populated", () => {
    // First create a file context to reference
    const fileCtx = store.branch().fileContext.upsert({
      path: "src/api/index.ts",
      description: "API entry point",
      kind: "file",
      filename: "index.ts",
    });

    const link = store.branch().fileOutsideLink.create({
      source_file_context_id: fileCtx.record_id,
      target_project_slug: "target-proj",
      target_path: "src/handlers.ts",
      target_type: "file",
      target_branch_name: "feature/foo",
      target_snapshot_id: "snap-001",
      kind: "external_call",
      description: "Calls external handler",
    });

    assert.ok(link);
    assert.equal(link.source_file_context_id, fileCtx.record_id);
    assert.equal(link.target_project_slug, "target-proj");
    assert.equal(link.target_path, "src/handlers.ts");
    assert.equal(link.target_type, "file");
    assert.equal(link.target_branch_name, "feature/foo");
    assert.equal(link.target_snapshot_id, "snap-001");
    assert.equal(link.kind, "external_call");
    assert.equal(link.description, "Calls external handler");
  });

  it("returns null for a non-existent record_id", () => {
    const result = store.branch().fileOutsideLink.findByRecordId(
      "non-existent-id",
    );
    assert.equal(result, null);
  });

  it("returns false when deleting a non-existent record", () => {
    const result = store.branch().fileOutsideLink.delete("non-existent-id");
    assert.equal(result, false);
  });

  it("filters links by source_file_context_id", () => {
    const fc1 = store.branch().fileContext.upsert({
      path: "src/service-a.ts",
      description: "Service A",
    });
    const fc2 = store.branch().fileContext.upsert({
      path: "src/service-b.ts",
      description: "Service B",
    });

    store.branch().fileOutsideLink.create({
      source_file_context_id: fc1.record_id,
      target_project_slug: "proj-a",
      target_type: "project",
      kind: "api",
      description: "A's link",
    });

    store.branch().fileOutsideLink.create({
      source_file_context_id: fc1.record_id,
      target_project_slug: "proj-b",
      target_type: "project",
      kind: "lib",
      description: "A's second link",
    });

    store.branch().fileOutsideLink.create({
      source_file_context_id: fc2.record_id,
      target_project_slug: "proj-c",
      target_type: "project",
      kind: "sdk",
      description: "B's link",
    });

    const fc1Links =
      store.branch().fileOutsideLink.findBySourceFileContext(fc1.record_id);
    assert.equal(fc1Links.length, 2);
    assert.ok(
      fc1Links.every(
        (l) => l.source_file_context_id === fc1.record_id,
      ),
    );

    const fc2Links =
      store.branch().fileOutsideLink.findBySourceFileContext(fc2.record_id);
    assert.equal(fc2Links.length, 1);
    assert.equal(fc2Links[0]?.source_file_context_id, fc2.record_id);
  });

  it("returns empty array when source_file_context_id has no links", () => {
    const links =
      store.branch().fileOutsideLink.findBySourceFileContext("no-links-id");
    assert.deepEqual(links, []);
  });

  it("throws when creating with missing required fields", () => {
    const linkStore = store.branch()
      .fileOutsideLink as unknown as { create: (i: Record<string, unknown>) => unknown };
    assert.throws(
      () =>
        linkStore.create({
          target_project_slug: "p",
          // missing description
        }),
      /description|required|TypeError/,
    );
  });

  it("preserves history across updates on the same record", () => {
    const link = store.branch().fileOutsideLink.create({
      target_project_slug: "history-proj",
      target_type: "project",
      kind: "api",
      description: "v1",
    });
    const createSnapshot = store.branch().snapshot_id;

    store.branch().fileOutsideLink.update(link.record_id, {
      description: "v2",
    });
    const updateSnapshot = store.branch().snapshot_id;

    // Historical snapshot should still see v1
    const snapLink = store
      .snapshot(createSnapshot!)
      .fileOutsideLink.findByRecordId(link.record_id);
    assert.equal(snapLink?.description, "v1");

    // Current branch sees v2
    const current = store
      .branch()
      .fileOutsideLink.findByRecordId(link.record_id);
    assert.equal(current?.description, "v2");

    // History has 2 entries
    const history = store.branch().fileOutsideLink.history(link.record_id);
    assert.equal(history.length, 2);
  });
});
