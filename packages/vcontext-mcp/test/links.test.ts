import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  ProjectLocator,
  VContextAPI,
} from "../src/api.js";
import { buildMcp, createToolDefinitions } from "../src/index.js";
import type { ToolDefinition } from "../src/tools.js";

interface LinkEntry {
  targetSlug: string;
  branchName: string | null;
  snapshotId: string | null;
}

class MockLinkAPI {
  readonly links: LinkEntry[] = [];

  async listProjects() {
    return [{ slug: "project-a" }];
  }

  async getProject() {
    throw new Error("not used");
  }

  async renderContext() {
    return "";
  }

  async migrationStatus() {
    return {} as never;
  }

  async migrationList() {
    return {} as never;
  }

  async projectStatus(locator: ProjectLocator) {
    return { slug: locator.project_slug ?? locator.slug ?? "project-a" };
  }

  async entityList() {
    return [];
  }

  async entityGet() {
    return {};
  }

  async entityHistory() {
    return [];
  }

  async entityAdd() {
    return {};
  }

  async entityUpdate() {
    return {};
  }

  async entityDelete() {
    return { deleted: true };
  }

  async fileContextUpsert() {
    return {};
  }

  async fileContextByPath() {
    return {};
  }

  async branchList() {
    return [];
  }

  async branchCurrent() {
    return {};
  }

  async branchGet() {
    return {};
  }

  async branchCreate() {
    return {};
  }

  async branchCheckout() {
    return {};
  }

  async branchRename() {
    return {};
  }

  async branchDelete() {
    return { deleted: true };
  }

  async snapshotList() {
    return [];
  }

  async snapshotGet() {
    return {};
  }

  async snapshotDiff() {
    return { changes: [] };
  }

  async snapshotCheckout() {
    return {};
  }

  async log() {
    return [];
  }

  async diff() {
    return { changes: [] };
  }

  async mergePreview() {
    return { conflicts: [] };
  }

  async mergeApply() {
    return { conflicts: [] };
  }

  async outsideLinksList() {
    return [];
  }

  async outsideLinksAdd() {
    return {};
  }

  async outsideLinksGet() {
    return {};
  }

  async outsideLinksUpdate() {
    return {};
  }

  async outsideLinksDelete() {
    return { deleted: true };
  }

  async linksList(locator: ProjectLocator) {
    return this.links.map((l) => ({
      slug: l.targetSlug,
      branch_name: l.branchName,
      snapshot_id: l.snapshotId,
    }));
  }

  async linksAdd(
    _locator: ProjectLocator,
    projectBSlug: string,
    branchName?: string,
    snapshotId?: string,
  ) {
    // Simulate UNIQUE constraint: reject duplicate (project_slug, target, branch, snapshot)
    const exists = this.links.some(
      (l) =>
        l.targetSlug === projectBSlug &&
        l.branchName === (branchName ?? null) &&
        l.snapshotId === (snapshotId ?? null),
    );
    if (exists) return { linked: false };
    this.links.push({
      targetSlug: projectBSlug,
      branchName: branchName ?? null,
      snapshotId: snapshotId ?? null,
    });
    return { linked: true };
  }

  async linksRemove(
    _locator: ProjectLocator,
    projectBSlug: string,
    branchName?: string,
    snapshotId?: string,
  ) {
    const index = this.links.findIndex(
      (l) =>
        l.targetSlug === projectBSlug &&
        l.branchName === (branchName ?? null) &&
        l.snapshotId === (snapshotId ?? null),
    );
    if (index < 0) return { unlinked: false };
    this.links.splice(index, 1);
    return { unlinked: true };
  }
}

describe("vcontext MCP link tools", () => {
  let client: Client;
  let api: MockLinkAPI;

  before(async () => {
    api = new MockLinkAPI();
    const server = buildMcp(api as unknown as VContextAPI);
    client = new Client({
      name: "link-test",
      version: "1.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  after(async () => {
    await client?.close();
  });

  it("registers vcontext_links_list, vcontext_links_add, vcontext_links_remove", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    assert.ok(names.includes("vcontext_links_list"));
    assert.ok(names.includes("vcontext_links_add"));
    assert.ok(names.includes("vcontext_links_remove"));
  });

  it("vcontext_links_list returns empty initially", async () => {
    const result = await client.callTool({
      name: "vcontext_links_list",
      arguments: { project_slug: "project-a" },
    });
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    assert.deepEqual(JSON.parse(text), []);
  });

  it("vcontext_links_add creates a project-level link", async () => {
    const result = await client.callTool({
      name: "vcontext_links_add",
      arguments: {
        project_slug: "project-a",
        project_b_slug: "project-b",
      },
    });
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    assert.deepEqual(JSON.parse(text), { linked: true });
  });

  it("vcontext_links_add creates a branch-level link", async () => {
    const result = await client.callTool({
      name: "vcontext_links_add",
      arguments: {
        project_slug: "project-a",
        project_b_slug: "project-c",
        branch_name: "main",
      },
    });
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    assert.deepEqual(JSON.parse(text), { linked: true });
  });

  it("vcontext_links_list returns all links", async () => {
    const result = await client.callTool({
      name: "vcontext_links_list",
      arguments: { project_slug: "project-a" },
    });
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    const links = JSON.parse(text);
    assert.equal(links.length, 2);

    const linkB = links.find((l: { slug: string }) => l.slug === "project-b");
    assert.ok(linkB);
    assert.equal(linkB.branch_name, null);

    const linkC = links.find((l: { slug: string }) => l.slug === "project-c");
    assert.ok(linkC);
    assert.equal(linkC.branch_name, "main");
  });

  it("vcontext_links_add handles duplicate", async () => {
    const result = await client.callTool({
      name: "vcontext_links_add",
      arguments: {
        project_slug: "project-a",
        project_b_slug: "project-b",
      },
    });
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    assert.deepEqual(JSON.parse(text), { linked: false });
  });

  it("vcontext_links_remove removes a link", async () => {
    const result = await client.callTool({
      name: "vcontext_links_remove",
      arguments: {
        project_slug: "project-a",
        project_b_slug: "project-b",
      },
    });
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    assert.deepEqual(JSON.parse(text), { unlinked: true });

    // Verify list now has one link
    const listResult = await client.callTool({
      name: "vcontext_links_list",
      arguments: { project_slug: "project-a" },
    });
    const listText =
      listResult.content[0] && "text" in listResult.content[0]
        ? listResult.content[0].text
        : "";
    const links = JSON.parse(listText);
    assert.equal(links.length, 1);
    assert.equal(links[0].slug, "project-c");
  });

  it("vcontext_links_remove handles non-existent link", async () => {
    const result = await client.callTool({
      name: "vcontext_links_remove",
      arguments: {
        project_slug: "project-a",
        project_b_slug: "nonexistent",
      },
    });
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    assert.deepEqual(JSON.parse(text), { unlinked: false });
  });

  it("backward compat: project-level and branch-level links coexist", async () => {
    // Add project-level link to project-b
    await client.callTool({
      name: "vcontext_links_add",
      arguments: {
        project_slug: "project-a",
        project_b_slug: "project-b",
      },
    });

    // Add branch-level link to project-b
    await client.callTool({
      name: "vcontext_links_add",
      arguments: {
        project_slug: "project-a",
        project_b_slug: "project-b",
        branch_name: "develop",
      },
    });

    const result = await client.callTool({
      name: "vcontext_links_list",
      arguments: { project_slug: "project-a" },
    });
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    const links = JSON.parse(text);
    assert.equal(links.length, 3);

    const projectLevel = links.find(
      (l: { slug: string; branch_name: string | null }) =>
        l.slug === "project-b" && l.branch_name === null,
    );
    assert.ok(projectLevel);

    const branchLevel = links.find(
      (l: { slug: string; branch_name: string | null }) =>
        l.slug === "project-b" && l.branch_name === "develop",
    );
    assert.ok(branchLevel);
  });

  it("removes a branch-level link", async () => {
    const result = await client.callTool({
      name: "vcontext_links_remove",
      arguments: {
        project_slug: "project-a",
        project_b_slug: "project-b",
        branch_name: "develop",
      },
    });
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    assert.deepEqual(JSON.parse(text), { unlinked: true });
  });

  it("exposes complete tool metadata", () => {
    const tools = createToolDefinitions(api as unknown as VContextAPI);
    const linkTools = tools.filter((t) =>
      t.name.startsWith("vcontext_links_"),
    );
    assert.equal(linkTools.length, 3);
    for (const tool of linkTools) {
      assert.ok(tool.description.length > 0);
      assert.ok(tool.inputSchema);
    }
  });
});
