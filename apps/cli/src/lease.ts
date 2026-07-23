import { rawRequest } from "@repo/daemon-client";
import { readPort, readToken } from "@repo/vcontext-core";
import { getUi } from "./ui/index.js";

export async function acquireLease(): Promise<string> {
  const port = readPort();
  if (!port) throw new Error("Daemon not running");
  const token = readToken();
  if (!token) throw new Error("No auth token");

  const resp = await rawRequest("POST", "/leases", undefined, {
    authorization: `Bearer ${token}`,
  });
  return JSON.parse(resp.body).leaseId;
}

export async function releaseLease(leaseId: string): Promise<void> {
  try {
    const port = readPort();
    const token = readToken();
    if (port && token) {
      await rawRequest("DELETE", `/leases/${leaseId}`, undefined, {
        authorization: `Bearer ${token}`,
      });
    }
  } catch {
    // Best-effort cleanup
  }
}

export function startHeartbeat(
  leaseId: string,
  intervalMs = 15_000,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const port = readPort();
      const token = readToken();
      if (port && token) {
        await rawRequest("POST", `/leases/${leaseId}/heartbeat`, undefined, {
          authorization: `Bearer ${token}`,
        });
      }
    } catch {
      getUi().errorLine("vcontext: heartbeat failed");
    }
  }, intervalMs);
}
