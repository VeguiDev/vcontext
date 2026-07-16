import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { readToken } from "@repo/vcontext-core";
import { buildMcp } from "@repo/vcontext-mcp";
import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import { DaemonVContextAPI } from "../../mcp/daemon-api.js";

export function registerMcpRoutes(app: Hono, services: AppServices): void {
  const activity = services.activity ?? {
    activeRequests: 0,
    activeLeases: 0,
    lastActivityAt: Date.now(),
  };
  const api = new DaemonVContextAPI(services);
  const mcpServer = buildMcp(api);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });

  let connected = false;

  app.use("/mcp", async (c, next) => {
    activity.lastActivityAt = Date.now();
    const auth = c.req.header("authorization") ?? "";
    const expectedToken = readToken();

    if (!expectedToken || auth !== `Bearer ${expectedToken}`) {
      return c.json(
        {
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized" },
          id: null,
        },
        401,
      );
    }

    await next();
  });

  app.all("/mcp", async (c) => {
    activity.activeRequests += 1;
    activity.lastActivityAt = Date.now();
    try {
      if (!connected) {
        await mcpServer.connect(transport);
        connected = true;
      }
      return await transport.handleRequest(c.req.raw);
    } finally {
      activity.activeRequests -= 1;
    }
  });
}
