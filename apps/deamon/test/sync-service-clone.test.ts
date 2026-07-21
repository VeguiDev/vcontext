import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      { slug: "vcontext", uuid: projectId },
    );
    assert.deepEqual(requests, [
      "https://cloud.example/api/v1/repos/veguidev/vcontext/sync/v1",
      "https://cloud.example/api/v1/repos/veguidev/vcontext/sync/v1/fetch",
    ]);
  });
});
