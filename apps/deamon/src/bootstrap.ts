import { createServer } from "node:http";
import { createApp } from "./app.js";
import { RegistryStore } from "./storage/registry-store.js";
import { ProjectService } from "./project/project-service.js";
import { ProjectApplicationService } from "./application/project-application-service.js";
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
  private projects = new ProjectService(this.registry);

  async Project(slug: string) {
    const project = this.registry.findBySlug(slug);
    return project ? this.projects.openStore(project) : null;
  }

  async bootstrap() {
    const activePid = runningPid();

    if (activePid) {
      throw new Error(
        `vcontext daemon is already running with PID ${activePid}`,
      );
    }

    ensureToken();

    const migrationFailures = await migrateRegisteredProjects(
      this.registry,
      this.projects,
    );

    const activity = {
      activeRequests: 0,
      activeLeases: 0,
      lastActivityAt: Date.now(),
    };
    const idleTimeout =
      Number(process.env.VCONTEXT_IDLE_TIMEOUT_MS) || 30 * 60 * 1000;
    let server: ReturnType<typeof createServer>;
    const services = {
      registry: this.registry,
      projectService: this.projects,
      application: new ProjectApplicationService(this.projects),
      Project: (slug: string) => this.Project(slug),
      migrationFailures,
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

export async function migrateRegisteredProjects(
  registry: RegistryStore,
  projects: ProjectService,
  log: Pick<Console, "log" | "error"> = console,
) {
  const failures = new Map<string, Error>();
  for (const project of registry.all()) {
    try {
      const handle = await projects.open(project);
      handle.close();
      log.log(`Project ${project.slug} migrations are current`);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failures.set(project.slug, failure);
      log.error(`Project ${project.slug} migration failed: ${failure.message}`);
    }
  }
  return failures;
}

async function readBody(req: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
