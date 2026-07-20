import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ProjectStore as ProjectStoreType } from "../src/storage/project-store.js";
import type { RegistryStore } from "../src/storage/registry-store.js";

describe("ProjectStore merge", { concurrency: false }, () => {
  let home = "";
  let previousHome: string | undefined;
  let store: ProjectStoreType;
  let registry: RegistryStore;

  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "vcontext-merge-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;
    const [{ RegistryStore }, { ProjectService }] = await Promise.all([
      import("../src/storage/registry-store.js"),
      import("../src/project/project-service.js"),
    ]);
    registry = new RegistryStore();
    const project = registry.create({ name: "Merge Project" });
    store = await new ProjectService(registry).openStore(project);
  });

  after(async () => {
    store.close();
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  it("finds a common ancestor and merges independent field changes", () => {
    const document = store.branch("main").document.create({
      title: "Architecture",
      content: "Base",
    });
    const common = store.branch("main").snapshot_id;
    store.branches.create("feature/automatic");
    store
      .branch("feature/automatic")
      .document.update(document.record_id, { title: "System Architecture" });
    const sourceBefore = store.branch("feature/automatic").snapshot_id;
    store
      .branch("main")
      .document.update(document.record_id, { content: "Target content" });
    const targetBefore = store.branch("main").snapshot_id;

    assert.equal(
      store.resolver.commonAncestor(sourceBefore, targetBefore),
      common,
    );
    const preview = store.merge.preview("feature/automatic", "main");
    assert.equal(preview.base_snapshot_id, common);
    assert.deepEqual(preview.conflicts, []);
    assert.equal(preview.changes.length, 1);

    const applied = store.merge.apply("feature/automatic", "main");
    const merged = store
      .branch("main")
      .document.findByRecordId(document.record_id);
    assert.equal(merged?.title, "System Architecture");
    assert.equal(merged?.content, "Target content");
    assert.equal(store.branch("feature/automatic").snapshot_id, sourceBefore);
    assert.equal(store.branch("main").snapshot_id, applied.snapshot.id);

    const parents = store.db
      .prepare(
        `SELECT parent_snapshot_id, parent_order
         FROM snapshot_parent WHERE snapshot_id = ? ORDER BY parent_order`,
      )
      .all(applied.snapshot.id) as Array<{
      parent_snapshot_id: string;
      parent_order: number;
    }>;
    assert.deepEqual(parents, [
      { parent_snapshot_id: targetBefore, parent_order: 0 },
      { parent_snapshot_id: sourceBefore, parent_order: 1 },
    ]);
  });

  it("reports same-field conflicts and rejects unresolved merges atomically", () => {
    const document = store.branch("main").document.create({
      title: "Conflict base",
      content: "Base",
    });
    store.branches.create("feature/conflict");
    store
      .branch("feature/conflict")
      .document.update(document.record_id, { content: "Source" });
    store
      .branch("main")
      .document.update(document.record_id, { content: "Target" });
    const targetBefore = store.branch("main").snapshot_id;
    const countBefore = (
      store.db.prepare("SELECT COUNT(*) AS count FROM snapshot").get() as {
        count: number;
      }
    ).count;

    const preview = store.merge.preview("feature/conflict", "main");
    assert.equal(preview.conflicts.length, 1);
    assert.deepEqual(
      {
        type: preview.conflicts[0]?.type,
        field: preview.conflicts[0]?.field,
      },
      { type: "FIELD_CONFLICT", field: "content" },
    );
    assert.throws(
      () => store.merge.apply("feature/conflict", "main"),
      /unresolved conflict/,
    );
    assert.equal(store.branch("main").snapshot_id, targetBefore);
    assert.equal(
      (
        store.db.prepare("SELECT COUNT(*) AS count FROM snapshot").get() as {
          count: number;
        }
      ).count,
      countBefore,
    );
  });

  it("reports delete/update conflicts and applies explicit resolutions", () => {
    const document = store.branch("main").document.create({
      title: "Delete conflict",
      content: "Base",
    });
    store.branches.create("feature/delete");
    store.branch("feature/delete").document.delete(document.record_id);
    store.branch("main").document.update(document.record_id, {
      title: "Updated target",
    });

    const preview = store.merge.preview("feature/delete", "main");
    assert.equal(preview.conflicts[0]?.type, "DELETE_UPDATE");

    store.merge.apply("feature/delete", "main", {
      [`document:${document.record_id}`]: "source",
    });
    assert.equal(
      store.branch("main").document.findByRecordId(document.record_id),
      null,
    );
  });
});
