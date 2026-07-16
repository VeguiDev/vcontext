import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { AppServices } from "../../app.js";

const leases = new Map<string, number>();

export function registerLeaseRoutes(app: Hono, services: AppServices): void {
  const activity = services.activity ?? {
    activeRequests: 0,
    activeLeases: 0,
    lastActivityAt: Date.now(),
  };

  app.post("/leases", (c) => {
    const leaseId = randomUUID();
    const expiresAt = Date.now() + 30_000;
    leases.set(leaseId, expiresAt);
    activity.activeLeases += 1;
    activity.lastActivityAt = Date.now();
    return c.json({ leaseId, expiresAt }, 201);
  });

  app.post("/leases/:id/heartbeat", (c) => {
    const id = c.req.param("id");
    if (!leases.has(id)) return c.json({ error: "lease_not_found" }, 404);
    leases.set(id, Date.now() + 30_000);
    activity.lastActivityAt = Date.now();
    return c.json({ ok: true });
  });

  app.delete("/leases/:id", (c) => {
    const id = c.req.param("id");
    if (!leases.has(id)) return c.json({ error: "lease_not_found" }, 404);
    leases.delete(id);
    activity.activeLeases = Math.max(0, activity.activeLeases - 1);
    return c.json({ ok: true });
  });
}
