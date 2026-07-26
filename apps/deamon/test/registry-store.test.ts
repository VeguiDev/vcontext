import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { LinkProjectSchema } from "@repo/vcontext-mcp";
import type { RegistryStore, RegisteredProject, LinkedProject } from "../src/storage/registry-store.js";

describe("RegistryStore project linking", { concurrency: false }, () => {
  let registry: RegistryStore;
  let tempHome: string;
  let prevHome: string | undefined;
  let projectA: RegisteredProject;
  let projectB: RegisteredProject;
  let projectC: RegisteredProject;

  before(async () => {
    tempHome = await mkdtemp(path.join(tmpdir(), "vcontext-registry-store-"));
    prevHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = tempHome;

    const { RegistryStore: RS } = await import(
      "../src/storage/registry-store.js"
    );
    registry = new RS();

    projectA = registry.create({ name: "Project A" });
    projectB = registry.create({ name: "Project B" });
    projectC = registry.create({ name: "Project C" });
  });

  after(async () => {
    registry.close();
    await rm(tempHome, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
    if (prevHome === undefined) {
      delete process.env.VCONTEXT_HOME;
    } else {
      process.env.VCONTEXT_HOME = prevHome;
    }
  });

  it("starts with no links", () => {
    const links = registry.links(projectA.id);
    assert.deepEqual(links, []);
  });

  it("creates a project-level link (no branch)", () => {
    const result = registry.link(projectA.id, projectB.id);
    assert.equal(result, true);

    const links = registry.links(projectA.id) as LinkedProject[];
    assert.equal(links.length, 1);
    assert.equal(links[0]!.id, projectB.id);
    assert.equal(links[0]!.slug, projectB.slug);
    assert.equal(links[0]!.branch_name, null);
    assert.equal(links[0]!.snapshot_id, null);
  });

  it("creates a branch-level link coexisting with project-level link", () => {
    // projectA -> projectC with branch "main"
    const result = registry.link(projectA.id, projectC.id, "main");
    assert.equal(result, true);

    const links = registry.links(projectA.id) as LinkedProject[];
    assert.equal(links.length, 2);

    const projectCLink = links.find((l) => l.id === projectC.id)!;
    assert.ok(projectCLink);
    assert.equal(projectCLink.branch_name, "main");
    assert.equal(projectCLink.snapshot_id, null);
  });

  it("creates a second branch-level link for the same target project", () => {
    // projectA -> projectC with branch "develop"
    const result = registry.link(projectA.id, projectC.id, "develop");
    assert.equal(result, true);

    const links = registry.links(projectA.id) as LinkedProject[];
    // 3 links: project-level (B), main (C), develop (C)
    assert.equal(links.length, 3);
  });

  it("links are directional: projectB does not see the reverse link", () => {
    const bLinks = registry.links(projectB.id);
    assert.deepEqual(bLinks, []);
  });

  it("returns false for duplicate link", () => {
    // Same project_id, project_b_id, branch_name, snapshot_id
    const result = registry.link(projectA.id, projectB.id);
    assert.equal(result, false);
  });

  it("returns false for self-link", () => {
    const result = registry.link(projectA.id, projectA.id);
    assert.equal(result, false);
  });

  it("lists links by slug", () => {
    const links = registry.linksBySlug(projectA.slug) as LinkedProject[];
    assert.equal(links.length, 3);
  });

  it("returns null for linksBySlug with unknown slug", () => {
    const links = registry.linksBySlug("nonexistent");
    assert.equal(links, null);
  });

  it("removes a specific branch link via unlink", () => {
    // Remove the "develop" link
    const result = registry.unlink(projectA.id, projectC.id, "develop");
    assert.equal(result, true);

    const links = registry.links(projectA.id) as LinkedProject[];
    assert.equal(links.length, 2);

    const developLink = links.find(
      (l) => l.id === projectC.id && l.branch_name === "develop",
    );
    assert.equal(developLink, undefined);
  });

  it("returns false when unlinking a non-existent link", () => {
    const result = registry.unlink(projectA.id, projectC.id, "nonexistent");
    assert.equal(result, false);
  });

  it("returns false when unlinking non-existent project pair", () => {
    // projectA -> projectB has a project-level link but not a branch-level one
    const result = registry.unlink(projectA.id, projectB.id, "main");
    assert.equal(result, false);
  });

  it("removes all links between two projects via unlinkAll", () => {
    // projectA -> projectB (project-level) and projectA -> projectC (main)
    // After unlinkAll(projectA, projectC), only A->B should remain
    const result = registry.unlinkAll(projectA.id, projectC.id);
    assert.equal(result, true);

    const links = registry.links(projectA.id) as LinkedProject[];
    assert.equal(links.length, 1);
    assert.equal(links[0]!.id, projectB.id);
  });

  it("backward compat: project-level link co-exists with branch-level links", async () => {
    // Recreate the setup: A->C with main branch, A->B already exists as project-level
    registry.link(projectA.id, projectC.id, "main");

    const links = registry.links(projectA.id) as LinkedProject[];
    assert.equal(links.length, 2);

    const projectLevelB = links.find(
      (l) => l.id === projectB.id && l.branch_name === null,
    );
    assert.ok(projectLevelB);

    const branchLevelC = links.find(
      (l) => l.id === projectC.id && l.branch_name === "main",
    );
    assert.ok(branchLevelC);
  });
});
