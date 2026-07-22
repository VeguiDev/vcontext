import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { RegistryStore } from "../src/storage/registry-store.js";
import type { SyncService } from "../src/sync/sync-service.js";

describe("SyncService clone", { concurrency: false }, () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  let home = "";
  let previousHome: string | undefined;
  let registry: RegistryStore;
  let sync: SyncService;
  let requests: string[];

  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "vcontext-clone-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;
    requests = [];

    const [{ RegistryStore }, { ProjectService }, { SyncService }] =
      await Promise.all([
        import("../src/storage/registry-store.js"),
        import("../src/project/project-service.js"),
        import("../src/sync/sync-service.js"),
      ]);
    registry = new RegistryStore();
    const projects = new ProjectService(registry);
    const fakeFetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push(String(input));
      if (init?.method === "GET") {
        return Response.json({
          protocol_version: 1,
          project_id: projectId,
          refs: [{ name: "main", snapshot_id: null }],
        });
      }
      return Response.json({
        protocol_version: 1,
        project_id: projectId,
        objects: [],
        refs: [{ name: "main", snapshot_id: null }],
        continuation: null,
      });
    }) as typeof fetch;
    sync = new SyncService(projects, {
      fetch: fakeFetch,
      credentials: {
        async get() {
          return null;
        },
        async set() {},
      },
    });
  });

  after(async () => {
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  it("publishes an empty unborn repository without partial state", async () => {
    const target = path.join(home, "workspaces", "vcontext");
    const result = await sync.clone(
      "https://cloud.example/api/v1/repos/veguidev/vcontext",
      target,
    );

    assert.equal(result.empty, true);
    assert.equal(result.path, target);
    assert.equal(result.uuid, projectId);
    assert.equal(registry.findBySlug("vcontext")?.uuid, projectId);
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(target, ".vcontext", "project.json"), "utf8"),
      ),
      {
        version: 1,
        project_id: projectId,
        project: "veguidev/vcontext",
        remote: `https://cloud.example/api/v1/projects/${projectId}`,
      },
    );
    assert.deepEqual(requests, [
      "https://cloud.example/api/v1/repos/veguidev/vcontext/sync/v1",
      "https://cloud.example/api/v1/repos/veguidev/vcontext/sync/v1/fetch",
    ]);
  });

  it("cleans staging and preserves an existing workspace when initialization is interrupted", async () => {
    const [{ ProjectService }, { SyncService }] = await Promise.all([import("../src/project/project-service.js"), import("../src/sync/sync-service.js")]);
    const interruptedId = "00000000-0000-4000-8000-000000000002";
    let calls = 0;
    const interrupted = new SyncService(new ProjectService(registry), {
      credentials: { async get() { return null; }, async set() {} },
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        if (init?.method === "GET") return Response.json({ protocol_version: 2, project_id: interruptedId, refs: [{ name: "main", snapshot_id: null }] });
        throw new Error("connection interrupted");
      }) as typeof fetch,
    });
    const workspace = path.join(home, "workspaces", "existing");
    await mkdir(workspace, { recursive: true }); await writeFile(path.join(workspace, "source.txt"), "keep");
    await assert.rejects(() => interrupted.initializeExisting({ project_id: interruptedId, project: "acme/existing", remote: `https://cloud.example/api/v1/projects/${interruptedId}`, cwd: workspace }), /connect|interrupted/i);
    assert.equal(await readFile(path.join(workspace, "source.txt"), "utf8"), "keep");
    assert.equal(registry.findByUuid(interruptedId), null);
    assert.equal((await readdir(path.join(home, "projects"))).some((name) => name.startsWith(`.resolve-${interruptedId}`)), false);
    assert.ok(calls >= 2);
  });
});
