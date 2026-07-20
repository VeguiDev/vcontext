import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { VContextAPI } from "../src/api.js";
import { buildMcp, createToolDefinitions } from "../src/index.js";

const api = {
  listProjects: async () => [{ slug: "demo" }],
  getProject: async () => {
    throw new Error("not used");
  },
  renderContext: async () => "context",
  migrationStatus: async () => ({}),
  migrationList: async () => ({}),
  projectStatus: async () => ({ slug: "demo", current_branch: "main" }),
  entityList: async () => [],
  entityGet: async (_entity: string, recordId: string) => ({
    record_id: recordId,
  }),
  entityHistory: async () => [],
  entityAdd: async () => ({}),
  entityUpdate: async () => ({}),
  entityDelete: async () => ({ deleted: true }),
  fileContextUpsert: async () => ({}),
  fileContextByPath: async () => ({}),
  branchList: async () => [],
  branchCurrent: async () => ({ name: "main" }),
  branchGet: async () => ({}),
  branchCreate: async () => ({}),
  branchCheckout: async () => ({}),
  branchRename: async () => ({}),
  branchDelete: async () => ({ deleted: true }),
  snapshotList: async () => [],
  snapshotGet: async (snapshotId: string) => ({
    id: snapshotId,
    parents: [],
    branch_labels: ["main"],
    counts: {},
  }),
  snapshotDiff: async () => ({ changes: [] }),
  snapshotCheckout: async () => ({}),
  log: async () => [],
  diff: async () => ({ changes: [] }),
  mergePreview: async () => ({ conflicts: [] }),
  mergeApply: async () => ({ conflicts: [] }),
} as unknown as VContextAPI;

describe("versioning MCP registry", () => {
  let client: Client;

  before(async () => {
    const server = buildMcp(api);
    client = new Client({ name: "versioning-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  after(async () => client.close());

  it("registers exactly 48 backwards-compatible tools", async () => {
    const tools = createToolDefinitions(api);
    assert.equal(tools.length, 48);
    assert.equal(new Set(tools.map((tool) => tool.name)).size, 48);
    assert.ok(tools.some((tool) => tool.name === "vcontext_project_status"));
    assert.ok(tools.some((tool) => tool.name === "vcontext_merge_apply"));
  });

  it("registers one static and four templated read-only resources", async () => {
    const resources = await client.listResources();
    const templates = await client.listResourceTemplates();
    assert.equal(resources.resources.length, 1);
    assert.equal(templates.resourceTemplates.length, 4);
    assert.equal(resources.resources[0]?.uri, "vcontext://projects");

    const status = await client.readResource({
      uri: "vcontext://project/demo/status",
    });
    const text =
      status.contents[0] && "text" in status.contents[0]
        ? status.contents[0].text
        : "";
    assert.equal(JSON.parse(text).current_branch, "main");
  });

  it("returns structured errors for contradictory canonical and legacy IDs", async () => {
    const tool = createToolDefinitions(api).find(
      (candidate) => candidate.name === "vcontext_documents_get",
    );
    assert.ok(tool);
    const result = await tool.handler({
      project_slug: "demo",
      record_id: "canonical",
      documentId: "legacy",
    });
    assert.equal(result.isError, true);
    const body = JSON.parse(result.content[0]?.text ?? "{}");
    assert.equal(body.code, "VALIDATION_ERROR");
  });
});
