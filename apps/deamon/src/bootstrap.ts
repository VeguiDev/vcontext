import { createServer } from "node:http";
import { getSocketPath } from "./util/pipe.js";
import { dirname } from "node:path";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createApp } from "./app.js";
import { RegistryStore } from "./storage/registry-store.js";
import { ProjectStore } from "./storage/project-store.js";
import { removePid, runningPid, writePid } from "./runtime/pid.js";

export class AppBoostrap {
  private registry = new RegistryStore();

  Project(slug: string) {
    const project = this.registry.findBySlug(slug);
    return project ? new ProjectStore(project) : null;
  }

  bootstrap() {
    const activePid = runningPid();

    if (activePid) {
      throw new Error(`vcontext daemon is already running with PID ${activePid}`);
    }

    let server: ReturnType<typeof createServer>;
    const app = createApp({
      registry: this.registry,
      Project: (slug) => this.Project(slug),
      pid: process.pid,
      shutdown: () => {
        setTimeout(() => {
          server.close(() => {
            removePid();
            process.exit(0);
          });
        }, 10);
      },
    });

    server = createServer(async (req, res) => {
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

    if (process.platform !== "win32" && existsSync(socket)) {
      unlinkSync(socket);
    }

    server.listen(socket, () => {
      writePid();
      console.log("Listening on " + socket);
      console.log("PID " + process.pid);
    });

    const cleanup = () => removePid();

    process.once("exit", cleanup);
    process.once("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      cleanup();
      process.exit(0);
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
