import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import type { LoadedProjectMigration } from "../src/project/migration-types.js";
import type { ProjectService } from "../src/project/project-service.js";
import type { RegistryStore } from "../src/storage/registry-store.js";

describe("ProjectService migration gate", { concurrency: false }, () => {
  let home = "";
  let previousHome: string | undefined;
  let registry: RegistryStore;
  let ProjectServiceClass: typeof ProjectService;

  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "vcontext-project-service-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;
    const [{ RegistryStore }, { ProjectService }] = await Promise.all([
      import("../src/storage/registry-store.js"),
      import("../src/project/project-service.js"),
    ]);
    registry = new RegistryStore();
    ProjectServiceClass = ProjectService;
  });

  after(async () => {
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  it("keeps status-only inspection non-applying and gates normal store access", async () => {
    const project = registry.create({ name: "Gate Project" });
    const service = new ProjectServiceClass(registry);

    const inspection = await service.inspect(project);
    assert.equal(inspection.store, null);
    assert.equal(inspection.runner.status().current_version, "0.0.0");
    assert.deepEqual(
      inspection.runner.pending().map((entry) => entry.version),
      ["1.0.0", "2.0.0", "3.0.0", "4.0.0"],
    );
    inspection.close();

    const store = await service.openStore(project);
    try {
      assert.ok(store.db.prepare("SELECT 1 FROM branch LIMIT 1").get());
    } finally {
      store.close();
    }
  });

  it("serializes concurrent migration attempts and rechecks pending state", async () => {
    const project = registry.create({ name: "Concurrent Project" });
    let executions = 0;
    const migrations = [
      loadedMigration("1.0.0", "Concurrent", async ({ scopedDb }) => {
        executions += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
        scopedDb.exec("CREATE TABLE concurrent_data (id INTEGER)");
      }),
    ];
    const firstService = new ProjectServiceClass(registry, migrations);
    const secondService = new ProjectServiceClass(registry, migrations);

    const [first, second] = await Promise.all([
      firstService.inspect(project),
      secondService.inspect(project),
    ]);
    await Promise.all([first.runner.migrate(), second.runner.migrate()]);
    first.close();
    second.close();
    assert.equal(executions, 1);
  });

  it("startup migration sweep isolates a failed project and migrates healthy projects", async () => {
    const healthy = registry.create({ name: "Healthy Startup" });
    const failed = registry.create({ name: "Failed Startup" });
    const failedDb = new Database(
      path.join(home, "projects", failed.slug, "data.db"),
    );
    failedDb.exec(
      "CREATE TABLE project_prompt (id INTEGER PRIMARY KEY, prompt TEXT NOT NULL); INSERT INTO project_prompt VALUES (1, 'broken')",
    );
    failedDb.close();
    const service = new ProjectServiceClass(registry);
    const { migrateRegisteredProjects } = await import("../src/bootstrap.js");
    const messages: string[] = [];
    const failures = await migrateRegisteredProjects(registry, service, {
      log: (message) => messages.push(message),
      error: (message) => messages.push(message),
    });

    assert.equal(failures.has(failed.slug), true);
    assert.equal(failures.has(healthy.slug), false);
    assert.match(failures.get(failed.slug)?.message ?? "", /Migration failed/);
    const inspection = await service.inspect(healthy);
    try {
      assert.equal(inspection.runner.status().current_version, "4.0.0");
    } finally {
      inspection.close();
    }
    assert.ok(messages.some((message) => message.includes(healthy.slug)));
    assert.ok(messages.some((message) => message.includes(failed.slug)));
  });

  it("skips failed migrations and contains background sync errors", async () => {
    const { drainRegisteredSyncQueues } = await import("../src/bootstrap.js");
    const attempted: string[] = [];
    const messages: string[] = [];

    await drainRegisteredSyncQueues(
      [{ slug: "healthy" }, { slug: "migration-failed" }],
      new Map([["migration-failed", new Error("checksum mismatch")]]),
      {
        drainQueue: async (slug: string) => {
          attempted.push(slug);
          throw new Error("remote unavailable");
        },
      },
      { error: (message) => messages.push(message) },
    );

    assert.deepEqual(attempted, ["healthy"]);
    assert.deepEqual(messages, [
      "Project healthy sync queue failed: remote unavailable",
    ]);
  });
});

function loadedMigration(
  version: string,
  name: string,
  migrate: LoadedProjectMigration["migrate"],
): LoadedProjectMigration {
  return {
    version,
    name,
    migrate,
    checksum: `checksum-${version}`,
    sourcePath: `${version}.ts`,
  };
}
