import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ProjectStore as ProjectStoreType } from "../src/storage/project-store.js";
import type { RegisteredProject } from "../src/storage/registry-store.js";
import type { RegistryStore } from "../src/storage/registry-store.js";
import type { ProjectService } from "../src/project/project-service.js";

describe("ProjectStore versioning", { concurrency: false }, () => {
  let home = "";
  let previousHome: string | undefined;
  let store: ProjectStoreType;
  let project: RegisteredProject;
  let registry: RegistryStore;
  let projects: ProjectService;

  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "vcontext-versioning-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;
    const [{ RegistryStore }, { ProjectService }] = await Promise.all([
      import("../src/storage/registry-store.js"),
      import("../src/project/project-service.js"),
    ]);
    registry = new RegistryStore();
    project = registry.create({ name: "Versioned Project" });
    projects = new ProjectService(registry);
    store = await projects.openStore(project);
  });

  after(async () => {
    store.close();
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  it("initializes an empty main branch and project config", () => {
    assert.deepEqual(store.branch().document.find(), []);
    assert.deepEqual(
      store.branches.find().map((branch) => branch.name),
      ["main"],
    );
    assert.equal(store.current_branch, "main");
    const config = JSON.parse(
      fs.readFileSync(
        path.join(home, "projects", project.slug, "project.json"),
        "utf8",
      ),
    );
    assert.equal(config.current_branch, "main");
    assert.equal(config.schema_version, "3.0.0");
    assert.deepEqual(config.migration.incomplete_post_migrations, []);
    assert.equal(config.migration.backup_paths.length, 2);
    assert.equal(
      (
        store.db.prepare("SELECT COUNT(*) AS count FROM snapshot").get() as {
          count: number;
        }
      ).count,
      1,
    );
  });

  it("creates immutable revisions and supports historical snapshot reads", () => {
    const initialSnapshot = store.branch().snapshot_id;
    const created = store.branch().document.create({
      title: "Architecture",
      content: "Initial",
    });
    const createSnapshot = store.branch().snapshot_id;
    const updated = store.branch().document.update(created.record_id, {
      content: "Updated",
    });

    assert.ok(updated);
    assert.notEqual(updated.id, created.id);
    assert.equal(updated.record_id, created.record_id);
    assert.equal(updated.previous_revision_id, created.id);
    assert.equal(updated.created_at, created.created_at);
    assert.equal(store.snapshot(initialSnapshot!).document.find().length, 0);
    assert.equal(
      store.snapshot(createSnapshot!).document.findByRecordId(created.record_id)
        ?.content,
      "Initial",
    );
    assert.deepEqual(
      store
        .branch()
        .document.history(created.record_id)
        .map((entry) => entry.id),
      [updated.id, created.id],
    );
    assert.equal(
      store.branch().document.findRevisionById(created.id)?.content,
      "Initial",
    );
  });

  it("writes tombstone revisions and hides deleted records", () => {
    const created = store.branch().task.create({ title: "Remove me" });
    const beforeDelete = store.branch().snapshot_id;
    assert.equal(store.branch().task.delete(created.record_id), true);
    assert.equal(store.branch().task.findByRecordId(created.record_id), null);
    assert.equal(
      store.snapshot(beforeDelete!).task.findByRecordId(created.record_id)
        ?.title,
      "Remove me",
    );
    const history = store.branch().task.history(created.record_id);
    assert.equal(history.length, 2);
    assert.ok(history[0]?.deleted_at);
    assert.equal(history[0]?.created_at, created.created_at);
  });

  it("creates, checks out, renames, and isolates branches", () => {
    const mainDocument = store.branch("main").document.create({
      title: "Shared",
      content: "main",
    });
    store.branches.create("feature/versioning");
    store.branches.checkout("feature/versioning");
    assert.equal(store.current_branch, "feature/versioning");
    store
      .branch()
      .document.update(mainDocument.record_id, { content: "feature" });
    assert.equal(
      store.branch("main").document.findByRecordId(mainDocument.record_id)
        ?.content,
      "main",
    );
    assert.equal(
      store
        .branch("feature/versioning")
        .document.findByRecordId(mainDocument.record_id)?.content,
      "feature",
    );
    store.branches.rename("feature/versioning", "feature/history");
    assert.equal(store.current_branch, "feature/history");
    store.branches.checkout("main");
    assert.equal(store.branches.delete("feature/history"), true);
    assert.throws(() => store.branches.delete("main"), /currently checked-out/);
    const config = JSON.parse(
      fs.readFileSync(
        path.join(home, "projects", project.slug, "project.json"),
        "utf8",
      ),
    );
    assert.equal(config.schema_version, "3.0.0");
  });

  it("loads the selected branch from project.json", async () => {
    store.branches.create("feature/reopen");
    store.branches.checkout("feature/reopen");
    const reopened = await projects.openStore(project);
    try {
      assert.equal(reopened.current_branch, "feature/reopen");
      assert.equal(reopened.branch().name, "feature/reopen");
    } finally {
      reopened.close();
    }
    store.branches.checkout("main");
    store.branches.delete("feature/reopen");
  });

  it("versions file-context upserts by visible branch path", () => {
    const created = store.branch().fileContext.upsert({
      path: "src/index.ts",
      description: "Entry point",
    });
    store.branches.create("feature/files");
    const updated = store.branch("feature/files").fileContext.upsert({
      path: "src/index.ts",
      description: "Feature entry point",
      hash: "abc",
    });
    assert.equal(updated.record_id, created.record_id);
    assert.equal(updated.previous_revision_id, created.id);
    assert.equal(
      store.branch("main").fileContext.findByRecordId(created.record_id)
        ?.description,
      "Entry point",
    );
  });

  it("generates messages and rolls back failed mutations", () => {
    const document = store.branch().document.create({
      title: "Messages",
      content: "",
    });
    const snapshot = store.requireSnapshot(document.snapshot_id);
    assert.equal(snapshot.message, 'Create document "Messages"');

    const branchBefore = store.branch().snapshot_id;
    const countBefore = (
      store.db.prepare("SELECT COUNT(*) AS count FROM snapshot").get() as {
        count: number;
      }
    ).count;
    assert.throws(() =>
      store.branch().task.create({
        title: "Invalid",
        status: "INVALID" as never,
      }),
    );
    assert.equal(store.branch().snapshot_id, branchBefore);
    assert.equal(
      (
        store.db.prepare("SELECT COUNT(*) AS count FROM snapshot").get() as {
          count: number;
        }
      ).count,
      countBefore,
    );
  });
});
