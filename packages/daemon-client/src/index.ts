import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type FoundProjectMarker,
  type ProjectMarker,
  PROJECT_MARKER_DIR,
  PROJECT_MARKER_FILE,
  findProjectMarker,
  resolveProjectSlug,
  PORT_FILE,
  readPort,
  runningPid,
} from "@repo/vcontext-core";

export interface CliResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export class DaemonClientError extends Error {
  readonly exitCode: number;
  readonly cause?: Error;

  constructor(message: string, exitCode = 1, cause?: Error) {
    super(message);
    this.name = "DaemonClientError";
    this.exitCode = exitCode;
    this.cause = cause;
  }
}

function resolveDaemonUrl(): string {
  const port = readPort();
  if (port === null) {
    throw new DaemonClientError(
      "Daemon is not running. Port file not found at " + PORT_FILE,
    );
  }
  return `http://127.0.0.1:${port}`;
}

function _socketRequest(
  method: string,
  requestPath: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<CliResponse> {
  return new Promise<CliResponse>((resolve, reject) => {
    const port = Number.parseInt(new URL(resolveDaemonUrl()).port, 10);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        method,
        headers: {
          ...headers,
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload).toString(),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          const response: CliResponse = {
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          };

          if (response.status >= 400) {
            reject(
              new DaemonClientError(
                formatApiError(response),
                apiExitCode(response),
              ),
            );
            return;
          }

          resolve(response);
        });
      },
    );

    req.on("error", (error) => {
      reject(
        new DaemonClientError(
          "Could not connect to vcontext daemon. Run `vcontext daemon start` first.",
          1,
          error,
        ),
      );
    });

    if (payload !== undefined) {
      req.write(payload);
    }

    req.end();
  });
}

export async function request(
  method: string,
  requestPath: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<CliResponse> {
  await ensureDaemon();
  return _socketRequest(method, requestPath, body, headers);
}

export function rawRequest(
  method: string,
  requestPath: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<CliResponse> {
  return _socketRequest(method, requestPath, body, headers);
}

export function daemonEntry(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const candidates = [
    process.env.VCONTEXT_DAEMON_ENTRY,
    path.resolve(
      currentDir,
      "..",
      "..",
      "..",
      "..",
      "apps",
      "deamon",
      "dist",
      "src",
      "index.js",
    ),
    path.resolve(
      currentDir,
      "..",
      "..",
      "..",
      "apps",
      "deamon",
      "dist",
      "src",
      "index.js",
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new DaemonClientError(
    "Build the daemon before starting it: pnpm --filter @app/deamon build",
  );
}

export async function ensureDaemon(): Promise<void> {
  try {
    await _socketRequest("GET", "/health");
    return;
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
  }

  const pid = runningPid();

  if (pid !== null) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(500);

      try {
        await _socketRequest("GET", "/health");
        return;
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
      }
    }
  }

  const entry = daemonEntry();
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  const exitPromise = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? -1));
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const exitCode = await Promise.race([
      exitPromise,
      sleep(500).then(() => null),
    ]);

    if (exitCode !== null && exitCode !== 0) {
      throw new DaemonClientError(
        `Daemon exited immediately with code ${exitCode}. Check the daemon build.`,
      );
    }

    try {
      await _socketRequest("GET", "/health");
      return;
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
  }

  throw new DaemonClientError(
    "Daemon did not start within 10 seconds. Run `vcontext daemon status` to check.",
  );
}

function formatApiError(response: CliResponse): string {
  try {
    const parsed: unknown = JSON.parse(response.body);

    const error = apiError(parsed);
    if (error) {
      const message = error.message ? `: ${error.message}` : "";
      return `API error ${response.status}: ${error.code}${message}`;
    }

    return `API error ${response.status}`;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return `API error ${response.status}: ${response.body}`;
    }
    throw error;
  }
}

function apiExitCode(response: CliResponse) {
  try {
    const parsed: unknown = JSON.parse(response.body);
    const code = apiError(parsed)?.code;
    return (
      {
        INVALID_REQUEST: 2,
        VALIDATION_ERROR: 2,
        PROJECT_NOT_FOUND: 3,
        BRANCH_NOT_FOUND: 4,
        SNAPSHOT_NOT_FOUND: 5,
        RECORD_NOT_FOUND: 6,
        MERGE_CONFLICT: 7,
        MIGRATION_ERROR: 8,
        migration_failed: 8,
        DATABASE_ERROR: 9,
      }[code ?? ""] ?? 1
    );
  } catch {
    return 1;
  }
}

function apiError(value: unknown): { code: string; message?: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const parsed = value as Record<string, unknown>;

  if (typeof parsed.error === "string") {
    return {
      code: parsed.code === undefined ? parsed.error : String(parsed.code),
      ...(typeof parsed.message === "string"
        ? { message: parsed.message }
        : {}),
    };
  }

  if (
    typeof parsed.error === "object" &&
    parsed.error !== null &&
    typeof (parsed.error as Record<string, unknown>).code === "string"
  ) {
    const nested = parsed.error as Record<string, unknown>;
    return {
      code: nested.code as string,
      ...(typeof nested.message === "string" ? { message: nested.message } : {}),
    };
  }

  if (typeof parsed.code === "string") {
    return {
      code: parsed.code,
      ...(typeof parsed.message === "string"
        ? { message: parsed.message }
        : {}),
    };
  }

  return null;
}

export {
  findProjectMarker,
  resolveProjectSlug,
  type FoundProjectMarker,
  type ProjectMarker,
  PROJECT_MARKER_DIR,
  PROJECT_MARKER_FILE,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
