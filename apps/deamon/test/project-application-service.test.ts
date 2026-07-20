import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ProjectApplicationService } from "../src/application/project-application-service.js";
import type { RegistryStore } from "../src/storage/registry-store.js";

describe("ProjectApplicationService", { concurrency: false }, () => {
  let home = "";
  let previousHome: string | undefined;
  let registry: RegistryStore;
  let application: ProjectApplicationService;
  let slug = "";

  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "vcontext-application-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;
    const [
      { RegistryStore },
      { ProjectService },
      { ProjectApplicationService },
    ] = await Promise.all([
      import("../src/storage/registry-store.js"),
      import("../src/project/project-service.js"),
      import("../src/application/project-application-service.js"),
    ]);
    registry = new RegistryStore();
    const project = registry.create({ name: "Application Project" });
    slug = project.slug;
    registry.addPath(slug, {
      type: "local",
      path: path.join(home, "workspace"),
      label: "workspace",
    });
    application = new ProjectApplicationService(new ProjectService(registry));
  });

  after(async () => {
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  it("provides stable status, chronological history, log, and business diff", async () => {
    const locator = { project_slug: slug };
    const initial = await application.status(locator);
    const created = await application.create(
      locator,
      "document",
      { title: "Architecture", content: "v1" },
      { message: "create architecture" },
    );
    const updated = await application.update(
      locator,
      "document",
      created.record_id,
      { content: "v2" },
      { message: "update architecture" },
    );
    const status = await application.status(locator);

    assert.equal(status.counts.document, 1);
    assert.equal(status.current_branch, "main");
    assert.equal(status.local_path, path.join(home, "workspace"));
    const history = await application.history(
      locator,
      "document",
      created.record_id,
    );
    assert.deepEqual(
      history.map((entry) => entry.id),
      [created.id, updated.id],
    );
    const diff = await application.diff(
      locator,
      `snapshot:${initial.current_snapshot_id}`,
      `snapshot:${status.current_snapshot_id}`,
    );
    assert.equal(diff.changes.length, 1);
    assert.equal(diff.changes[0]?.type, "created");
    assert.deepEqual(diff.changes[0]?.after, {
      title: "Architecture",
      content: "v2",
    });
    const log = await application.log(locator);
    assert.equal(log[0]?.id, status.current_snapshot_id);
    assert.deepEqual(
      log[0]?.parents.map((parent) => parent.parent_order),
      [0],
    );
  });

  it("rejects detached writes and invalid selector combinations at adapters", async () => {
    await assert.rejects(
      application.list({ project_slug: slug }, "document", {
        branch: "main",
        snapshot_id: "anything",
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "VALIDATION_ERROR",
    );
    await assert.rejects(
      application.log({ project_slug: slug }, {}, 501),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "VALIDATION_ERROR",
    );
  });
});
