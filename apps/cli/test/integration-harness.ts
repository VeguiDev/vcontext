import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const DAEMON_ENTRY = path.join(
  REPOSITORY_ROOT,
  "apps/deamon/dist/src/index.js",
);
const CLI_ENTRY = path.join(REPOSITORY_ROOT, "apps/cli/dist/src/index.js");
const DAEMON_LOCK = path.join(os.tmpdir(), "vcontext-integration-daemon.lock");

export { CLI_ENTRY, REPOSITORY_ROOT };

export interface DaemonFixture {
  readonly root: string;
  readonly home: string;
  readonly projectPath: string;
  readonly port: number;
  readonly token: string;
  readonly env: NodeJS.ProcessEnv;
  stop(): Promise<void>;
}

class IntegrationHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationHarnessError";
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireDaemonLock(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(DAEMON_LOCK);
      return;
    } catch (error) {
      if (!isErrnoCode(error, "EEXIST")) throw error;
      await delay(100);
    }
  }
  throw new IntegrationHarnessError("Timed out waiting for daemon test lock");
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function waitForHealth(
  child: ChildProcess,
  home: string,
  stderr: () => string,
): Promise<{ readonly port: number; readonly token: string }> {
  const portFile = path.join(home, "vcontext.port");
  const tokenFile = path.join(home, "vcontext.token");
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new IntegrationHarnessError(
        `Daemon exited with code ${child.exitCode}: ${stderr()}`,
      );
    }

    if (fs.existsSync(portFile) && fs.existsSync(tokenFile)) {
      const port = Number.parseInt(
        fs.readFileSync(portFile, "utf8").trim(),
        10,
      );
      if (Number.isInteger(port) && port > 0) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`);
          if (response.ok) {
            return {
              port,
              token: fs.readFileSync(tokenFile, "utf8").trim(),
            };
          }
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
        }
      }
    }

    await delay(100);
  }

  throw new IntegrationHarnessError(`Daemon health timed out: ${stderr()}`);
}

export async function startDaemonFixture(): Promise<DaemonFixture> {
  await acquireDaemonLock();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vcontext-integration-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  fs.mkdirSync(home);
  fs.mkdirSync(projectPath);
  const env = {
    ...process.env,
    VCONTEXT_HOME: home,
    VCONTEXT_IDLE_TIMEOUT_MS: "600000",
  };
  const child = spawn(process.execPath, [DAEMON_ENTRY], {
    cwd: REPOSITORY_ROOT,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let daemonStderr = "";
  child.stderr?.on("data", (chunk: Buffer | string) => {
    daemonStderr += chunk.toString();
  });

  try {
    const { port, token } = await waitForHealth(
      child,
      home,
      () => daemonStderr,
    );
    let stopped = false;

    return {
      root,
      home,
      projectPath,
      port,
      token,
      env,
      async stop(): Promise<void> {
        if (stopped) return;
        stopped = true;
        child.kill("SIGTERM");
        let exited = await waitForExit(child, 5_000);
        if (!exited) {
          child.kill("SIGKILL");
          exited = await waitForExit(child, 5_000);
        }
        fs.rmSync(root, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
        fs.rmSync(DAEMON_LOCK, { recursive: true, force: true });
        if (!exited) {
          throw new IntegrationHarnessError(
            "Daemon did not stop within 10 seconds",
          );
        }
      },
    };
  } catch (error) {
    child.kill("SIGKILL");
    await waitForExit(child, 5_000);
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    fs.rmSync(DAEMON_LOCK, { recursive: true, force: true });
    throw error;
  }
}
