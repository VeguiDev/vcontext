import type { Hono } from "hono";
import type { AppServices } from "../../app.js";

export function registerDaemonRoutes(app: Hono, services: AppServices) {
  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/daemon/status", (c) => {
    return c.json({
      ok: true,
      pid: services.pid ?? process.pid,
    });
  });

  app.post("/daemon/stop", (c) => {
    if (!services.shutdown) {
      return c.json({ error: "shutdown_unavailable" }, 503);
    }

    services.shutdown();

    return c.json({ stopping: true });
  });
}
