import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VContextAPI } from "./api.js";
import { createToolDefinitions } from "./tools.js";

// Re-export all public types and schemas
export * from "./api.js";
export * from "./schemas.js";
export { createToolDefinitions, type ToolDefinition } from "./tools.js";

export function buildMcp(api: VContextAPI): McpServer {
  const server = new McpServer({ name: "vcontext", version: "0.1.1" });
  const tools = createToolDefinitions(api);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tool.handler as any,
    );
  }

  if (typeof api.projectStatus === "function") {
    registerResources(server, api);
  }

  return server;
}

function registerResources(server: McpServer, api: VContextAPI) {
  const json = (uri: URL, value: unknown) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(value),
      },
    ],
  });
  server.registerResource(
    "vcontext-projects",
    "vcontext://projects",
    { mimeType: "application/json", description: "Registered projects" },
    async (uri) => json(uri, await api.listProjects()),
  );

  const template = (value: string) =>
    new ResourceTemplate(value, { list: undefined });
  server.registerResource(
    "vcontext-project-status",
    template("vcontext://project/{slug}/status"),
    { mimeType: "application/json", description: "Project status" },
    (async (uri: URL, variables: Record<string, string>) =>
      json(
        uri,
        await api.projectStatus({ project_slug: String(variables.slug) }),
      )) as never,
  );
  server.registerResource(
    "vcontext-branch-context",
    template("vcontext://project/{slug}/branch/{branch}/context"),
    { mimeType: "application/json", description: "Versioned branch context" },
    (async (uri: URL, variables: Record<string, string>) => {
      const selector = {
        project_slug: String(variables.slug),
        branch: String(variables.branch),
      };
      const [prompts, documents, tasks, changes, file_context] =
        await Promise.all([
          api.entityList("project_prompt", selector),
          api.entityList("document", selector),
          api.entityList("task", selector),
          api.entityList("change_note", selector),
          api.entityList("file_context", selector),
        ]);
      return json(uri, {
        project_slug: selector.project_slug,
        branch: selector.branch,
        prompts,
        documents,
        tasks,
        changes,
        file_context,
      });
    }) as never,
  );
  server.registerResource(
    "vcontext-snapshot",
    template("vcontext://project/{slug}/snapshot/{snapshotId}"),
    {
      mimeType: "application/json",
      description: "Snapshot metadata, parents, labels, and counts",
    },
    (async (uri: URL, variables: Record<string, string>) =>
      json(
        uri,
        await api.snapshotGet(String(variables.snapshotId), {
          project_slug: String(variables.slug),
        }),
      )) as never,
  );
  server.registerResource(
    "vcontext-document",
    template("vcontext://project/{slug}/document/{recordId}"),
    {
      mimeType: "application/json",
      description: "Document on the current branch",
    },
    (async (uri: URL, variables: Record<string, string>) =>
      json(
        uri,
        await api.entityGet("document", String(variables.recordId), {
          project_slug: String(variables.slug),
        }),
      )) as never,
  );
}
