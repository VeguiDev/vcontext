import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import type { CLIVContextAPI } from "../src/vcontext-api.js";
import {
  CLI_ENTRY,
  type DaemonFixture,
  startDaemonFixture,
} from "./integration-harness.js";

const PROJECT_NAME = "test-project";
const PROJECT_SLUG = "test-project";

let fixture: DaemonFixture | undefined;
let api: CLIVContextAPI | undefined;

before(async () => {
  fixture = await startDaemonFixture();
  process.env.VCONTEXT_HOME = fixture.home;
  execFileSync(
    process.execPath,
    [CLI_ENTRY, "init", PROJECT_NAME, "--path", fixture.projectPath],
    {
      cwd: fixture.projectPath,
      env: fixture.env,
      stdio: "pipe",
    },
  );
  const module = await import("../src/vcontext-api.js");
  api = new module.CLIVContextAPI();
});

after(async () => {
  await fixture?.stop();
});

describe("CLIVContextAPI daemon integration", () => {
  it("lists the project created by the compiled CLI", async () => {
    assert.ok(api);

    const projects = await api.listProjects();

    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.name, PROJECT_NAME);
    assert.equal(projects[0]?.slug, PROJECT_SLUG);
  });

  it("gets a project handle by slug", async () => {
    assert.ok(api);

    const project = await api.getProject(PROJECT_SLUG);
    const tasks = await project.tasks.list();

    assert.deepEqual(tasks, []);
  });

  it("creates, lists, updates, and deletes tasks", async () => {
    assert.ok(api);
    const project = await api.getProject(PROJECT_SLUG);

    const created = await project.tasks.add({
      title: "Integration task",
      description: "Created through CLIVContextAPI",
      status: "BACKLOG",
    });
    assert.equal(created.title, "Integration task");
    assert.equal(created.status, "BACKLOG");

    const listed = await project.tasks.list();
    assert.deepEqual(
      listed.map((task) => task.id),
      [created.id],
    );

    const updated = await project.tasks.update(created.record_id, {
      title: "Updated integration task",
      status: "RUNNING",
    });
    assert.equal(updated?.title, "Updated integration task");
    assert.equal(updated?.status, "RUNNING");

    const deleted = await project.tasks.delete(created.record_id);
    assert.equal(deleted, true);
  });

  it("returns the same project and task state over direct HTTP", async () => {
    assert.ok(fixture);
    const headers = { authorization: `Bearer ${fixture.token}` };

    const projectResponse = await fetch(
      `http://127.0.0.1:${fixture.port}/projects/${PROJECT_SLUG}`,
      { headers },
    );
    assert.equal(projectResponse.status, 200);
    const projectBody: unknown = await projectResponse.json();
    assert.ok(typeof projectBody === "object" && projectBody !== null);
    assert.equal(
      "slug" in projectBody ? projectBody.slug : undefined,
      PROJECT_SLUG,
    );

    const tasksResponse = await fetch(
      `http://127.0.0.1:${fixture.port}/projects/${PROJECT_SLUG}/tasks`,
      { headers },
    );
    assert.equal(tasksResponse.status, 200);
    const tasksBody: unknown = await tasksResponse.json();
    assert.deepEqual(tasksBody, []);
  });

  it("reports migration status and list through the API", async () => {
    assert.ok(api);
    const status = await api.migrationStatus(PROJECT_SLUG);
    assert.equal(status.current_version, "5.0.0");
    assert.equal(status.latest_version, "5.0.0");
    assert.equal(status.checksum_state, "valid");
    assert.deepEqual(status.pending, []);

    const list = await api.migrationList(PROJECT_SLUG);
    assert.deepEqual(
      list.migrations.map((migration) => migration.version),
      ["1.0.0", "2.0.0", "3.0.0", "4.0.0", "5.0.0"],
    );
  });

  it("emits valid JSON for migration status and run commands", () => {
    assert.ok(fixture);
    const statusOutput = execFileSync(
      process.execPath,
      [CLI_ENTRY, "migration", "status", PROJECT_SLUG, "--json"],
      { cwd: fixture.projectPath, env: fixture.env, encoding: "utf8" },
    );
    const status = JSON.parse(statusOutput) as { current_version: string };
    assert.equal(status.current_version, "5.0.0");

    const runOutput = execFileSync(
      process.execPath,
      [
        CLI_ENTRY,
        "migration",
        "run",
        PROJECT_SLUG,
        "--to",
        "5.0.0",
        "--json",
        "--yes",
      ],
      { cwd: fixture.projectPath, env: fixture.env, encoding: "utf8" },
    );
    const run = JSON.parse(runOutput) as { applied: string[] };
    assert.deepEqual(run.applied, []);
  });
});
