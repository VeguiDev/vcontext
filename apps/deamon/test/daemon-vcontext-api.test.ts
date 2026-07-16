import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AppServices } from "../src/app.js";
import type { DaemonVContextAPI } from "../src/mcp/daemon-api.js";
import type { RegistryStore } from "../src/storage/registry-store.js";
import type { RegisteredProject } from "../src/storage/registry-store.js";

describe("DaemonVContextAPI", { concurrency: false }, () => {
  let api: DaemonVContextAPI;
  let registry: RegistryStore;
  let project: RegisteredProject;
  let temporaryHome = "";
  let previousHome: string | undefined;

  before(async () => {
    temporaryHome = await mkdtemp(path.join(tmpdir(), "vcontext-daemon-api-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = temporaryHome;

    const [{ RegistryStore }, { ProjectStore }, { DaemonVContextAPI }] =
      await Promise.all([
        import("../src/storage/registry-store.js"),
        import("../src/storage/project-store.js"),
        import("../src/mcp/daemon-api.js"),
      ]);

    registry = new RegistryStore();
    project = registry.create({
      name: "Integration Test Project",
      description: "SQLite fixture for DaemonVContextAPI",
    });

    const services: AppServices = {
      registry,
      Project: (slug) => {
        const registeredProject = registry.findBySlug(slug);
        return registeredProject ? new ProjectStore(registeredProject) : null;
      },
    };

    api = new DaemonVContextAPI(services);
  });

  after(async () => {
    registry["db"].close();

    await rm(temporaryHome, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });

    if (previousHome === undefined) {
      delete process.env.VCONTEXT_HOME;
    } else {
      process.env.VCONTEXT_HOME = previousHome;
    }
  });

  it("lists the registered project", async () => {
    const projects = await api.listProjects();

    assert.deepEqual(projects, [project]);
  });

  it("returns a project handle", async () => {
    const handle = await api.getProject(project.slug);

    assert.equal(typeof handle.tasks.list, "function");
    assert.equal(typeof handle.documents.list, "function");
  });

  it("renders project context as text", async () => {
    const context = await api.renderContext(project.slug);

    assert.equal(typeof context, "string");
    assert.match(context, /Project: Integration Test Project/);
  });

  it("adds a task through the project handle", async () => {
    const handle = await api.getProject(project.slug);

    const task = await handle.tasks.add({
      title: "Add integration coverage",
      description: "Exercise the daemon API directly",
    });

    assert.equal(task.project_id, project.id);
    assert.equal(task.title, "Add integration coverage");
    assert.equal(task.status, "BACKLOG");
  });

  it("lists tasks through the project handle", async () => {
    const handle = await api.getProject(project.slug);
    const task = await handle.tasks.add({ title: "List this task" });

    const tasks = await handle.tasks.list();

    assert.ok(tasks.some((candidate) => candidate.id === task.id));
  });

  it("updates a task through the project handle", async () => {
    const handle = await api.getProject(project.slug);
    const task = await handle.tasks.add({ title: "Update this task" });

    const updated = await handle.tasks.update(task.id, {
      title: "Updated task",
      status: "RUNNING",
    });

    assert.ok(updated);
    assert.equal(updated.title, "Updated task");
    assert.equal(updated.status, "RUNNING");
  });

  it("deletes a task through the project handle", async () => {
    const handle = await api.getProject(project.slug);
    const task = await handle.tasks.add({ title: "Delete this task" });

    const deleted = await handle.tasks.delete(task.id);

    assert.equal(deleted, true);
  });
});
