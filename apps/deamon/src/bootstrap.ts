import { createServer } from "node:http";
import { createApp } from "./app.js";
import { RegistryStore } from "./storage/registry-store.js";
import { ProjectStore } from "./storage/project-store.js";
import {
  ensureToken,
  removePid,
  removePort,
  resolvePort,
  runningPid,
  writePid,
  writePort,
} from "@repo/vcontext-core";

export class AppBoostrap {
  private registry = new RegistryStore();

  Project(slug: string) {
    const project = this.registry.findBySlug(slug);
    return project ? new ProjectStore(project) : null;
  }

  async bootstrap() {
    const activePid = runningPid();

    if (activePid) {
      throw new Error(`vcontext daemon is already running with PID ${activePid}`);
    }

    ensureToken();

    const activity = { activeRequests: 0, activeLeases: 0, lastActivityAt: Date.now() };
    const idleTimeout =
      Number(process.env.VCONTEXT_IDLE_TIMEOUT_MS) || 30 * 60 * 1000;
    let server: ReturnType<typeof createServer>;
    const services = {
      registry: this.registry,
      Project: (slug: string) => this.Project(slug),
      pid: process.pid,
      shutdown: () => {
        setTimeout(() => {
          server.close(() => {
            removePid();
            process.exit(0);
          });
        }, 10);
      },
      activity,
    };
    const app = createApp(services);

    const idleTimer = setInterval(() => {
      if (
        activity.activeRequests === 0 &&
        activity.activeLeases === 0 &&
        Date.now() - activity.lastActivityAt > idleTimeout
      ) {
        clearInterval(idleTimer);
        services.shutdown?.();
      }
    }, 30_000);

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

    const port = await resolvePort();
    server.listen(port, "127.0.0.1", () => {
      writePort(port);
      writePid();
      console.log(`Listening on http://127.0.0.1:${port}`);
      console.log(`PID ${process.pid}`);
    });

    const cleanup = () => {
      clearInterval(idleTimer);
      removePort();
      removePid();
    };

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
