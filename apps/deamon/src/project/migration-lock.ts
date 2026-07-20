import fs from "node:fs";
import path from "node:path";

const WAIT_TIMEOUT_MS = 30_000;
const STALE_LOCK_MS = 5 * 60_000;

export async function withProjectMigrationLock<T>(
  projectDirectory: string,
  operation: () => Promise<T>,
): Promise<T> {
  fs.mkdirSync(projectDirectory, { recursive: true });
  const lockPath = path.join(projectDirectory, ".migration.lock");
  const startedAt = Date.now();
  let descriptor: number | undefined;

  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockPath, "wx");
      fs.writeFileSync(
        descriptor,
        JSON.stringify({ pid: process.pid, created_at: Date.now() }),
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (isStale(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Another process recovered or replaced the stale lock.
        }
        continue;
      }
      if (Date.now() - startedAt >= WAIT_TIMEOUT_MS) {
        throw new Error(
          `Timed out waiting for project migration lock at ${lockPath}`,
        );
      }
      await delay(50);
    }
  }

  try {
    return await operation();
  } finally {
    fs.closeSync(descriptor);
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // The lock may have been removed by recovery tooling.
    }
  }
}

function isStale(lockPath: string) {
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) return true;
    const value = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
      pid?: unknown;
    };
    if (typeof value.pid !== "number") return false;
    try {
      process.kill(value.pid, 0);
      return false;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

function isAlreadyExists(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
