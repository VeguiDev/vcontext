import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  ChangeRecord,
  DocumentRecord,
  FileContextRecord,
  ProjectHandle,
  ProjectPromptRecord,
  RegisteredProjectRecord,
  TaskRecord,
  VContextAPI,
} from "../src/api.js";
import { buildMcp, createToolDefinitions } from "../src/index.js";
import type { ToolDefinition } from "../src/tools.js";

// allow: SIZE_OK — one self-contained fake backs the complete 20-tool contract matrix.
const PROJECT: RegisteredProjectRecord = {
  id: 1,
  uuid: "abc",
  slug: "test-project",
  name: "Test",
  description: null,
  created_at: 1,
  updated_at: 1,
};

function updateRecord<T extends { readonly id: number }>(
  records: T[],
  id: number,
  transform: (record: T) => T,
): T | null {
  const index = records.findIndex((record) => record.id === id);
  const current = records[index];
  if (current === undefined) return null;
  const updated = transform(current);
  records.splice(index, 1, updated);
  return updated;
}

function deleteRecord<T extends { readonly id: number }>(
  records: T[],
  id: number,
): boolean {
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return false;
  records.splice(index, 1);
  return true;
}

class MockProjectHandle implements ProjectHandle {
  private readonly taskRecords: TaskRecord[] = [];
  private readonly documentRecords: DocumentRecord[] = [];
  private readonly changeRecords: ChangeRecord[] = [];
  private readonly fileContextRecords: FileContextRecord[] = [];
  private readonly promptRecords: ProjectPromptRecord[] = [];

  readonly tasks: ProjectHandle["tasks"] = {
    list: async () => this.taskRecords,
    add: async (input) => {
      const record: TaskRecord = {
        id: this.taskRecords.length + 1,
        project_id: PROJECT.id,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "BACKLOG",
        document_id: input.document_id ?? null,
        created_at: 1,
        updated_at: 1,
      };
      this.taskRecords.push(record);
      return record;
    },
    update: async (id, input) =>
      updateRecord(this.taskRecords, id, (record) => ({
        ...record,
        title: input.title ?? record.title,
        description:
          input.description === undefined ? record.description : input.description,
        status: input.status ?? record.status,
        document_id:
          input.document_id === undefined ? record.document_id : input.document_id,
        updated_at: 2,
      })),
    delete: async (id) => deleteRecord(this.taskRecords, id),
  };

  readonly documents: ProjectHandle["documents"] = {
    list: async () => this.documentRecords,
    get: async (id) =>
      this.documentRecords.find((record) => record.id === id) ?? null,
    add: async (input) => {
      const record: DocumentRecord = {
        id: this.documentRecords.length + 1,
        project_id: PROJECT.id,
        title: input.title,
        content: input.content,
        created_at: 1,
        updated_at: 1,
      };
      this.documentRecords.push(record);
      return record;
    },
    update: async (id, input) =>
      updateRecord(this.documentRecords, id, (record) => ({
        ...record,
        title: input.title ?? record.title,
        content: input.content ?? record.content,
        updated_at: 2,
      })),
    delete: async (id) => deleteRecord(this.documentRecords, id),
  };

  readonly changes: ProjectHandle["changes"] = {
    list: async () => this.changeRecords,
    add: async (input) => {
      const record: ChangeRecord = {
        id: this.changeRecords.length + 1,
        project_id: PROJECT.id,
        note: input.note,
        document_id: input.document_id ?? null,
        created_at: 1,
        updated_at: 1,
      };
      this.changeRecords.push(record);
      return record;
    },
  };

  readonly fileContexts: ProjectHandle["fileContexts"] = {
    list: async () => this.fileContextRecords,
    upsert: async (input) => {
      const existing = this.fileContextRecords.find(
        (record) => record.path === input.path,
      );
      if (existing !== undefined) {
        return updateRecord(this.fileContextRecords, existing.id, (record) => ({
          ...record,
          kind: input.kind ?? record.kind,
          filename: input.filename ?? record.filename,
          hash: input.hash ?? record.hash,
          description: input.description,
          updated_at: 2,
        })) ?? existing;
      }
      const record: FileContextRecord = {
        id: this.fileContextRecords.length + 1,
        project_id: PROJECT.id,
        path: input.path,
        kind: input.kind ?? null,
        filename: input.filename ?? null,
        hash: input.hash ?? null,
        description: input.description,
        created_at: 1,
        updated_at: 1,
      };
      this.fileContextRecords.push(record);
      return record;
    },
    delete: async (id) => deleteRecord(this.fileContextRecords, id),
  };

  readonly prompts: ProjectHandle["prompts"] = {
    list: async () => this.promptRecords,
    add: async (input) => {
      const record: ProjectPromptRecord = {
        id: this.promptRecords.length + 1,
        prompt: input.prompt,
        created_at: 1,
        updated_at: 1,
      };
      this.promptRecords.push(record);
      return record;
    },
    update: async (id, input) =>
      updateRecord(this.promptRecords, id, (record) => ({
        ...record,
        prompt: input.prompt,
        updated_at: 2,
      })),
    delete: async (id) => deleteRecord(this.promptRecords, id),
  };
}

class MockVContextAPI implements VContextAPI {
  private readonly project = new MockProjectHandle();

  async listProjects(): Promise<readonly RegisteredProjectRecord[]> {
    return [PROJECT];
  }

  async getProject(_slug?: string): Promise<ProjectHandle> {
    return this.project;
  }

  async renderContext(_slug?: string): Promise<string> {
    return "context";
  }
}

const expectedNames = [
  "vcontext_context",
  "vcontext_projects",
  "vcontext_tasks_list",
  "vcontext_tasks_add",
  "vcontext_tasks_update",
  "vcontext_tasks_delete",
  "vcontext_documents_list",
  "vcontext_documents_get",
  "vcontext_documents_add",
  "vcontext_documents_update",
  "vcontext_documents_delete",
  "vcontext_changes_list",
  "vcontext_changes_add",
  "vcontext_file_context_list",
  "vcontext_file_context_upsert",
  "vcontext_file_context_delete",
  "vcontext_prompts_list",
  "vcontext_prompts_add",
  "vcontext_prompts_update",
  "vcontext_prompts_delete",
] as const;

let tools: readonly ToolDefinition[] = [];
let client: Client | undefined;

before(async () => {
  const api = new MockVContextAPI();
  const server = buildMcp(api);
  tools = createToolDefinitions(api);
  client = new Client({ name: "contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
});

after(async () => {
  await client?.close();
});

describe("vcontext MCP tool contracts", () => {
  it("registers all 20 tools for tools/list", async () => {
    assert.ok(client);
    const result = await client.listTools();
    assert.equal(result.tools.length, 20);
    assert.deepEqual(
      result.tools.map((tool) => tool.name),
      expectedNames,
    );
  });

  it("exposes complete metadata for every tool", () => {
    assert.equal(tools.length, 20);
    for (const tool of tools) {
      assert.ok(tool.description.length > 0);
      assert.ok(tool.inputSchema);
    }
  });

  it("returns valid JSON from every tool handler", async () => {
    const calls: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ["vcontext_context", { slug: PROJECT.slug }],
      ["vcontext_projects", {}],
      ["vcontext_tasks_list", { slug: PROJECT.slug }],
      ["vcontext_tasks_add", { slug: PROJECT.slug, title: "Draft", status: "RUNNING" }],
      ["vcontext_tasks_update", { slug: PROJECT.slug, taskId: 1, title: "Done", status: "COMPLETED" }],
      ["vcontext_tasks_delete", { slug: PROJECT.slug, taskId: 1 }],
      ["vcontext_documents_list", { slug: PROJECT.slug }],
      ["vcontext_documents_add", { slug: PROJECT.slug, title: "Architecture", content: "Node" }],
      ["vcontext_documents_get", { slug: PROJECT.slug, documentId: 1 }],
      ["vcontext_documents_update", { slug: PROJECT.slug, documentId: 1, content: "TypeScript" }],
      ["vcontext_documents_delete", { slug: PROJECT.slug, documentId: 1 }],
      ["vcontext_changes_list", { slug: PROJECT.slug }],
      ["vcontext_changes_add", { slug: PROJECT.slug, note: "Added tests" }],
      ["vcontext_file_context_list", { slug: PROJECT.slug }],
      ["vcontext_file_context_upsert", { slug: PROJECT.slug, path: "src/", kind: "directory", description: "Source" }],
      ["vcontext_file_context_delete", { slug: PROJECT.slug, fileContextId: 1 }],
      ["vcontext_prompts_list", { slug: PROJECT.slug }],
      ["vcontext_prompts_add", { slug: PROJECT.slug, prompt: "Be concise" }],
      ["vcontext_prompts_update", { slug: PROJECT.slug, promptId: 1, prompt: "Be precise" }],
      ["vcontext_prompts_delete", { slug: PROJECT.slug, promptId: 1 }],
    ];

    for (const [name, args] of calls) {
      const tool = tools.find((candidate) => candidate.name === name);
      assert.ok(tool, `${name} is registered`);
      const result = await tool.handler(args);
      assert.deepEqual(result.content.map((item) => item.type), ["text"]);
      const parsed: unknown = JSON.parse(result.content[0]?.text ?? "");
      assert.notEqual(parsed, undefined, `${name} returns JSON`);
    }
  });
});
