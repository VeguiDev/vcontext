import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { withSyncObjectHash } from "@vcontext/versioning-contract";
import type { RegistryStore } from "../src/storage/registry-store.js";
import type { ProjectService } from "../src/project/project-service.js";
import { SyncObjectStore } from "../src/sync/sync-object-store.js";

describe("local sync object storage", { concurrency: false }, () => {
  let home = "";
  let previousHome: string | undefined;
  let registry: RegistryStore;
  let projects: ProjectService;

  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "vcontext-sync-store-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;
    const modules = await Promise.all([
      import("../src/storage/registry-store.js"),
      import("../src/project/project-service.js"),
    ]);
    registry = new modules[0].RegistryStore();
    projects = new modules[1].ProjectService(registry);
  });

  after(async () => {
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  it("creates an unborn branch and makes the first write a root snapshot with CAS", async () => {
    const project = await projects.createProject({ name: "Unborn" });
    const store = await projects.openStore(project);
    try {
      assert.equal(store.branch().snapshot_id, null);
      assert.deepEqual(store.branch().document.find(), []);
      const document = store.branch().document.create({ title: "Root", content: "first" });
      const head = store.requireBranchHead("main");
      assert.equal(document.snapshot_id, head);
      assert.deepEqual(store.snapshotParents(head), []);
    } finally { store.close(); }
  });

  it("exports in dependency order and imports idempotently while rejecting collisions", async () => {
    const sourceProject = await projects.createProject({ name: "Source" });
    const source = await projects.openStore(sourceProject);
    const created = source.branch().document.create({ title: "A", content: "one" });
    source.branch().document.update(created.record_id, { content: "two" });
    const objects = new SyncObjectStore(source).exportAll(sourceProject.uuid);
    assert.equal(objects[0]?.object_type, "snapshot");
    assert.ok(objects.findIndex((object) => object.object_type === "record_identity") < objects.findIndex((object) => object.object_type === "record_revision"));
    source.close();

    const targetProject = await projects.createProject({ name: "Target" });
    const target = await projects.openStore(targetProject);
    try {
      const objectStore = new SyncObjectStore(target);
      assert.equal(objectStore.import(sourceProject.uuid, objects).imported, objects.length);
      assert.equal(objectStore.import(sourceProject.uuid, objects).existing, objects.length);
      const revision = objects.find((object) => object.object_type === "record_revision")!;
      const collision = withSyncObjectHash(sourceProject.uuid, {
        object_type: "record_revision",
        id: revision.id,
        payload: { ...revision.payload, data: { ...revision.payload.data, content: "collision" } },
      });
      assert.throws(() => objectStore.import(sourceProject.uuid, [collision]), /different content/);
    } finally { target.close(); }
  });

  it("stores read-only remote refs and resolves them for merge sources", async () => {
    const project = await projects.createProject({ name: "Remote refs" });
    const store = await projects.openStore(project);
    try {
      const root = store.branch().document.create({ title: "Shared", content: "base" });
      store.branches.create("remote-work");
      store.branch("remote-work").document.update(root.record_id, { content: "remote" });
      const remoteHead = store.requireBranchHead("remote-work");
      store.remotes.add("origin", "https://example.test/team/repo");
      store.remotes.replaceRefs("origin", [{ name: "main", snapshot_id: remoteHead }]);
      store.branch("main").document.update(root.record_id, { title: "Local" });
      const result = store.merge.apply("origin/main", "main");
      assert.equal(result.source_snapshot_id, remoteHead);
      assert.equal(store.branch("main").document.findByRecordId(root.record_id)?.content, "remote");
    } finally { store.close(); }
  });
});
