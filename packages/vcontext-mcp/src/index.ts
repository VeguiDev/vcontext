import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VContextAPI } from "./api.js";
import { createToolDefinitions } from "./tools.js";

// Re-export all public types and schemas
export * from "./api.js";
export * from "./schemas.js";
export { createToolDefinitions, type ToolDefinition } from "./tools.js";

export function buildMcp(api: VContextAPI): McpServer {
  const server = new McpServer({ name: "vcontext", version: "0.1.0" });
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

  return server;
}
