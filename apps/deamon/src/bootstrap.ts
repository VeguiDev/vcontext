import { createServer } from "node:http";
import { getSocketPath } from "./util/pipe.js";
import { dirname } from "node:path";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createApp } from "./app.js";
import { RegistryStore } from "./storage/registry-store.js";
import { ProjectStore } from "./storage/project-store.js";

export class AppBoostrap {
  private registry = new RegistryStore();

  Project(id: number) {
    const project = this.registry.findById(id);
    return project ? new ProjectStore(project) : null;
  }

  bootstrap() {
    const app = createApp({
      registry: this.registry,
      Project: (id) => this.Project(id),
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      const body = await readBody(req);

      const request = new Request(url, {
        method,
        headers: req.headers as HeadersInit,
        body: method === "GET" || method === "HEAD" ? undefined : body,
      });

      const response = await app.fetch(request);
      const responseBody = Buffer.from(await response.arrayBuffer());

      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(responseBody);
    });

    const socket = getSocketPath();

    if (process.platform !== "win32") {
      mkdirSync(dirname(socket), { recursive: true });
    }

    if (existsSync(socket)) {
      unlinkSync(socket);
    }

    server.listen(socket, () => {
      console.log("Listening on " + socket);
    });
  }
}

async function readBody(req: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
