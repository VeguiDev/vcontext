import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ProjectHandle,
  RegisteredProjectRecord,
  VContextAPI,
} from "../src/api.js";
import { createToolDefinitions } from "../src/index.js";

interface OutsideLinkRecord {
  record_id: string;
  source_file_context_id: string | null;
  target_project_slug: string;
  target_path: string | null;
  target_type: string;
  target_branch_name: string | null;
  target_snapshot_id: string | null;
  kind: string;
  description: string;
}

const PROJECT: RegisteredProjectRecord = {
  id: 1,
  uuid: "outside-test",
  slug: "test-project",
  name: "Test",
  description: null,
  created_at: 1,
  updated_at: 1,
};

class MockProjectHandle implements ProjectHandle {
  readonly tasks = {
    list: async () => [],
    add: async () => ({}) as never,
    update: async () => null,
    delete: async () => true,
  };
  readonly documents = {
    list: async () => [],
    get: async () => null,
    add: async () => ({}) as never,
    update: async () => null,
    delete: async () => true,
  };
  readonly changes = {
    list: async () => [],
    add: async () => ({}) as never,
  };
  readonly fileContexts = {
    list: async () => [],
    upsert: async () => ({}) as never,
    delete: async () => true,
  };
  readonly prompts = {
    list: async () => [],
    add: async () => ({}) as never,
    update: async () => null,
    delete: async () => true,
  };
}

class MockOutsideLinkAPI implements VContextAPI {
  readonly links: OutsideLinkRecord[] = [];
  private nextId = 1;

  async listProjects(): Promise<readonly RegisteredProjectRecord[]> {
    return [PROJECT];
  }

  async getProject(): Promise<ProjectHandle> {
    return new MockProjectHandle();
  }

  async renderContext(): Promise<string> {
    return "";
  }

  async migrationStatus() {
    return {} as never;
  }

  async migrationList() {
    return {} as never;
  }

  async projectStatus() {
    return { slug: "test-project" } as never;
  }

  async entityList() {
    return [];
  }

  async entityGet() {
    return null;
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

  async outsideLinksList(
    _selector: Record<string, unknown>,
    sourceFileContextId?: string,
  ): Promise<readonly unknown[]> {
    if (sourceFileContextId) {
      return this.links.filter(
        (l) => l.source_file_context_id === sourceFileContextId,
      );
    }
    return [...this.links];
  }

  async outsideLinksAdd(
    input: Record<string, unknown>,
    _selector: Record<string, unknown>,
  ): Promise<unknown> {
    const id = String(this.nextId++);
    const record: OutsideLinkRecord = {
      record_id: id,
      source_file_context_id:
        (input.source_file_context_id as string | null) ?? null,
      target_project_slug: input.target_project_slug as string,
      target_path: (input.target_path as string | null) ?? null,
      target_type: (input.target_type as string) ?? "project",
      target_branch_name: (input.target_branch_name as string | null) ?? null,
      target_snapshot_id: (input.target_snapshot_id as string | null) ?? null,
      kind: (input.kind as string) ?? "api",
      description: input.description as string,
    };
    this.links.push(record);
    return record;
  }

  async outsideLinksGet(
    recordId: string,
    _selector: Record<string, unknown>,
  ): Promise<unknown> {
    return this.links.find((l) => l.record_id === recordId) ?? null;
  }

  async outsideLinksUpdate(
    recordId: string,
    input: Record<string, unknown>,
    _selector: Record<string, unknown>,
  ): Promise<unknown> {
    const index = this.links.findIndex((l) => l.record_id === recordId);
    if (index < 0) return null;
    const current = this.links[index]!;
    const updated: OutsideLinkRecord = {
      ...current,
      source_file_context_id:
        input.source_file_context_id !== undefined
          ? (input.source_file_context_id as string | null)
          : current.source_file_context_id,
      target_project_slug:
        (input.target_project_slug as string | undefined) ??
        current.target_project_slug,
      target_path:
        input.target_path !== undefined
          ? (input.target_path as string | null)
          : current.target_path,
      target_type:
        (input.target_type as string | undefined) ?? current.target_type,
      target_branch_name:
        input.target_branch_name !== undefined
          ? (input.target_branch_name as string | null)
          : current.target_branch_name,
      target_snapshot_id:
        input.target_snapshot_id !== undefined
          ? (input.target_snapshot_id as string | null)
          : current.target_snapshot_id,
      kind: (input.kind as string | undefined) ?? current.kind,
      description:
        (input.description as string | undefined) ?? current.description,
    };
    this.links[index] = updated;
    return updated;
  }

  async outsideLinksDelete(
    recordId: string,
    _selector: Record<string, unknown>,
  ): Promise<unknown> {
    const index = this.links.findIndex((l) => l.record_id === recordId);
    if (index < 0) return { deleted: false };
    this.links.splice(index, 1);
    return { deleted: true };
  }

  async branchList() {
    return [];
  }

  async branchCurrent() {
    return null;
  }

  async branchGet() {
    return null;
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
    return {} as never;
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

  async linksList() {
    return [];
  }

  async linksAdd() {
    return {};
  }

  async linksRemove() {
    return { deleted: true };
  }
}

const OUTSIDE_LINK_TOOLS = [
  "vcontext_outside_links_list",
  "vcontext_outside_links_add",
  "vcontext_outside_links_get",
  "vcontext_outside_links_update",
  "vcontext_outside_links_delete",
] as const;

describe("vcontext MCP outside-link tools", () => {
  const api = new MockOutsideLinkAPI();
  const tools = createToolDefinitions(api);

  it("registers all 5 outside-link tools", () => {
    for (const name of OUTSIDE_LINK_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool, `${name} is registered`);
      assert.ok(tool.description.length > 0);
      assert.ok(tool.inputSchema);
    }
  });

  it("adds an outside link", async () => {
    const tool = tools.find((t) => t.name === "vcontext_outside_links_add");
    assert.ok(tool);

    const result = await tool.handler({
      project_slug: "test-project",
      target_project_slug: "dependency-proj",
      target_type: "project",
      kind: "api",
      description: "Depends on dependency-proj",
    });

    const body = JSON.parse(result.content[0]!.text!) as OutsideLinkRecord;
    assert.ok(body.record_id);
    assert.equal(body.target_project_slug, "dependency-proj");
    assert.equal(body.target_type, "project");
    assert.equal(body.kind, "api");
    assert.equal(body.description, "Depends on dependency-proj");
  });

  it("lists outside links", async () => {
    const tool = tools.find((t) => t.name === "vcontext_outside_links_list");
    assert.ok(tool);

    const result = await tool.handler({
      project_slug: "test-project",
    });

    const body = JSON.parse(result.content[0]!.text!) as OutsideLinkRecord[];
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
  });

  it("gets an outside link by record_id", async () => {
    const tool = tools.find((t) => t.name === "vcontext_outside_links_get");
    assert.ok(tool);

    const result = await tool.handler({
      project_slug: "test-project",
      record_id: "1",
    });

    const body = JSON.parse(
      result.content[0]!.text!,
    ) as OutsideLinkRecord | null;
    assert.ok(body);
    assert.equal(body!.record_id, "1");
    assert.equal(body!.target_project_slug, "dependency-proj");
  });

  it("returns null for non-existent record_id", async () => {
    const tool = tools.find((t) => t.name === "vcontext_outside_links_get");
    assert.ok(tool);

    const result = await tool.handler({
      project_slug: "test-project",
      record_id: "non-existent",
    });

    const body = JSON.parse(
      result.content[0]!.text!,
    ) as OutsideLinkRecord | null;
    assert.equal(body, null);
  });

  it("updates an outside link", async () => {
    const tool = tools.find(
      (t) => t.name === "vcontext_outside_links_update",
    );
    assert.ok(tool);

    const result = await tool.handler({
      project_slug: "test-project",
      record_id: "1",
      description: "Updated description",
      kind: "sdk",
    });

    const body = JSON.parse(result.content[0]!.text!) as OutsideLinkRecord;
    assert.equal(body.record_id, "1");
    assert.equal(body.description, "Updated description");
    assert.equal(body.kind, "sdk");
    assert.equal(body.target_project_slug, "dependency-proj");
  });

  it("deletes an outside link", async () => {
    const tool = tools.find(
      (t) => t.name === "vcontext_outside_links_delete",
    );
    assert.ok(tool);

    const result = await tool.handler({
      project_slug: "test-project",
      record_id: "1",
    });

    const body = JSON.parse(result.content[0]!.text!) as {
      deleted: boolean;
    };
    assert.equal(body.deleted, true);

    const listTool = tools.find(
      (t) => t.name === "vcontext_outside_links_list",
    );
    assert.ok(listTool);
    const listResult = await listTool.handler({
      project_slug: "test-project",
    });
    const links = JSON.parse(
      listResult.content[0]!.text!,
    ) as OutsideLinkRecord[];
    assert.equal(links.length, 0);
  });

  it("deleting non-existent link returns deleted: false", async () => {
    const tool = tools.find(
      (t) => t.name === "vcontext_outside_links_delete",
    );
    assert.ok(tool);

    const result = await tool.handler({
      project_slug: "test-project",
      record_id: "non-existent",
    });

    const body = JSON.parse(result.content[0]!.text!) as {
      deleted: boolean;
    };
    assert.equal(body.deleted, false);
  });

  it("filters list by source_file_context_id", async () => {
    const addTool = tools.find((t) => t.name === "vcontext_outside_links_add");
    assert.ok(addTool);

    await addTool.handler({
      project_slug: "test-project",
      source_file_context_id: "fc-001",
      target_project_slug: "filter-a",
      target_type: "project",
      kind: "api",
      description: "Filtered A",
    });
    await addTool.handler({
      project_slug: "test-project",
      source_file_context_id: "fc-001",
      target_project_slug: "filter-b",
      target_type: "project",
      kind: "lib",
      description: "Filtered B",
    });

    const listTool = tools.find(
      (t) => t.name === "vcontext_outside_links_list",
    );
    assert.ok(listTool);

    const result = await listTool.handler({
      project_slug: "test-project",
      source_file_context_id: "fc-001",
    });

    const body = JSON.parse(result.content[0]!.text!) as OutsideLinkRecord[];
    assert.equal(body.length, 2);
    assert.ok(body.every((l) => l.source_file_context_id === "fc-001"));
  });

  it("creates a link with all optional fields", async () => {
    const tool = tools.find((t) => t.name === "vcontext_outside_links_add");
    assert.ok(tool);

    const result = await tool.handler({
      project_slug: "test-project",
      source_file_context_id: "fc-002",
      target_project_slug: "rich-link",
      target_path: "src/deep/path.ts",
      target_type: "file",
      target_branch_name: "feature/bar",
      target_snapshot_id: "snap-xyz",
      kind: "external_call",
      description: "Rich link with all fields",
    });

    const body = JSON.parse(result.content[0]!.text!) as OutsideLinkRecord;
    assert.equal(body.source_file_context_id, "fc-002");
    assert.equal(body.target_project_slug, "rich-link");
    assert.equal(body.target_path, "src/deep/path.ts");
    assert.equal(body.target_type, "file");
    assert.equal(body.target_branch_name, "feature/bar");
    assert.equal(body.target_snapshot_id, "snap-xyz");
    assert.equal(body.kind, "external_call");
    assert.equal(body.description, "Rich link with all fields");
  });
});
