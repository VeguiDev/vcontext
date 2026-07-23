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

export interface DaemonClientErrorMetadata {
  code?: string;
  status?: number;
  hint?: string;
  details?: Record<string, unknown>;
}

export class DaemonClientError extends Error {
  readonly exitCode: number;
  readonly cause?: Error;
  readonly code?: string;
  readonly status?: number;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    exitCode = 1,
    cause?: Error,
    metadata: DaemonClientErrorMetadata = {},
  ) {
    super(message);
    this.name = "DaemonClientError";
    this.exitCode = exitCode;
    this.cause = cause;
    this.code = metadata.code;
    this.status = metadata.status;
    this.hint = metadata.hint;
    this.details = metadata.details;
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
            const error = responseError(response);
            reject(
              new DaemonClientError(
                error.message,
                apiExitCode(response),
                undefined,
                {
                  code: error.code,
                  status: response.status,
                  hint: detailString(error.details, "hint"),
                  details: error.details,
                },
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

function daemonCommand(): string[] {
  if (process.env.VCONTEXT_STANDALONE === "1") return ["__vcontext_daemon"];
  return [daemonEntry()];
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

function responseError(response: CliResponse): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  try {
    const parsed: unknown = JSON.parse(response.body);

    const error = apiError(parsed);
    if (error)
      return {
        code: error.code,
        message:
          error.message ?? `Request failed with HTTP ${response.status}.`,
        ...(error.details ? { details: error.details } : {}),
      };

    return {
      code: "HTTP_ERROR",
      message: `Request failed with HTTP ${response.status}.`,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        code: "HTTP_ERROR",
        message:
          response.body.trim() ||
          `Request failed with HTTP ${response.status}.`,
      };
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

function apiError(value: unknown): {
  code: string;
  message?: string;
  details?: Record<string, unknown>;
} | null {
  if (typeof value !== "object" || value === null) return null;
  const parsed = value as Record<string, unknown>;
  const topLevelDetails = record(parsed.details);

  if (typeof parsed.error === "string") {
    return {
      code: parsed.code === undefined ? parsed.error : String(parsed.code),
      ...(typeof parsed.message === "string"
        ? { message: parsed.message }
        : {}),
      ...(topLevelDetails ? { details: topLevelDetails } : {}),
    };
  }

  if (
    typeof parsed.error === "object" &&
    parsed.error !== null &&
    typeof (parsed.error as Record<string, unknown>).code === "string"
  ) {
    const nested = parsed.error as Record<string, unknown>;
    const nestedDetails = record(nested.details);
    return {
      code: nested.code as string,
      ...(typeof nested.message === "string"
        ? { message: nested.message }
        : {}),
      ...(nestedDetails ? { details: nestedDetails } : {}),
    };
  }

  if (typeof parsed.code === "string") {
    return {
      code: parsed.code,
      ...(typeof parsed.message === "string"
        ? { message: parsed.message }
        : {}),
      ...(topLevelDetails ? { details: topLevelDetails } : {}),
    };
  }

  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function detailString(
  details: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = details?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
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
