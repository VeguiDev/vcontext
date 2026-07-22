import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

describe("ProjectResolverService", { concurrency: false }, () => {
  const id = "00000000-0000-4000-8000-000000000099";
  let root: string; let previousHome: string | undefined;
  before(async () => { root = await mkdtemp(path.join(tmpdir(), "vcontext-resolver-")); previousHome = process.env.VCONTEXT_HOME; process.env.VCONTEXT_HOME = path.join(root, "home"); });
  after(async () => { await rm(root, { recursive: true, force: true }); if (previousHome === undefined) delete process.env.VCONTEXT_HOME; else process.env.VCONTEXT_HOME = previousHome; });
  it("serializes initialization by project id and never rewrites the marker", async () => {
    const cwd = path.join(root, "repo"); const markerDir = path.join(cwd, ".vcontext"); fs.mkdirSync(markerDir, { recursive: true });
    const marker = { version: 1, project_id: id, project: "acme/docs", remote: `https://cloud.example/api/v1/projects/${id}` };
    const markerText = JSON.stringify(marker, null, 2) + "\n"; fs.writeFileSync(path.join(markerDir, "project.json"), markerText);
    const [{ RegistryStore }, { ProjectService }, { ProjectResolverService }] = await Promise.all([import("../src/storage/registry-store.js"), import("../src/project/project-service.js"), import("../src/project/project-resolver-service.js")]);
    const registry = new RegistryStore(); const projects = new ProjectService(registry); let calls = 0;
    const resolver = new ProjectResolverService(projects, { initialize: async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return registry.registerImported({ uuid: id, slug: "docs", name: "docs" }); } });
    const [first, second] = await Promise.all([resolver.resolve({ cwd }), resolver.resolve({ cwd })]);
    assert.equal(first.uuid, id); assert.equal(second.uuid, id); assert.equal(calls, 1);
    assert.equal(fs.readFileSync(path.join(markerDir, "project.json"), "utf8"), markerText);
    registry.close();
  });
});
