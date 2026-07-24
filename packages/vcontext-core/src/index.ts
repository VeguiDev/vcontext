import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export { IdentityStore, type LocalIdentity } from "./identity.js";

export const VCONTEXT_HOME =
  process.env.VCONTEXT_HOME ?? path.join(os.homedir(), ".vcontext");

export const PID_FILE = path.join(VCONTEXT_HOME, "vcontext.pid");
export const PORT_FILE = path.join(VCONTEXT_HOME, "vcontext.port");
export const TOKEN_FILE = path.join(VCONTEXT_HOME, "vcontext.token");
export const DAEMON_START_ERROR_FILE = path.join(
  VCONTEXT_HOME,
  "daemon-start-error.json",
);
export const DEFAULT_PORT = 11434;

export interface DaemonStartError {
  name: string;
  message: string;
  stack?: string;
  timestamp: string;
}

export function writeDaemonStartError(error: unknown): void {
  try {
    const value =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            ...(error.stack ? { stack: error.stack } : {}),
          }
        : { name: "Error", message: String(error) };
    fs.mkdirSync(VCONTEXT_HOME, { recursive: true });
    fs.writeFileSync(
      DAEMON_START_ERROR_FILE,
      `${JSON.stringify(
        {
          ...value,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } catch {
    // Startup diagnostics must never replace the original daemon failure.
  }
}

export function readDaemonStartError(): DaemonStartError | null {
  try {
    const value = JSON.parse(
      fs.readFileSync(DAEMON_START_ERROR_FILE, "utf8"),
    ) as Partial<DaemonStartError>;
    if (
      typeof value.name !== "string" ||
      typeof value.message !== "string" ||
      typeof value.timestamp !== "string" ||
      (value.stack !== undefined && typeof value.stack !== "string")
    ) {
      return null;
    }
    return value as DaemonStartError;
  } catch {
    return null;
  }
}

export function clearDaemonStartError(): void {
  try {
    fs.unlinkSync(DAEMON_START_ERROR_FILE);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
}

export function readToken(): string | null {
  try {
    return fs.readFileSync(TOKEN_FILE, "utf-8").trim();
  } catch {
    return null;
  }
}

export function writeToken(token: string): void {
  fs.mkdirSync(VCONTEXT_HOME, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token);
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function ensureToken(): string {
  const existing = readToken();

  if (existing) {
    return existing;
  }

  const token = generateToken();
  writeToken(token);
  return token;
}

export function readPid(): number | null {
  try {
    const value = fs.readFileSync(PID_FILE, "utf-8").trim();
    const pid = Number(value);

    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function writePid(pid = process.pid): void {
  fs.mkdirSync(VCONTEXT_HOME, { recursive: true });
  fs.writeFileSync(PID_FILE, `${pid}\n`);
}

export function removePid(pid = process.pid): void {
  if (readPid() !== pid) {
    return;
  }

  try {
    fs.unlinkSync(PID_FILE);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function runningPid(): number | null {
  const pid = readPid();

  if (!pid) {
    return null;
  }

  if (isProcessRunning(pid)) {
    return pid;
  }

  removeStalePid();

  return null;
}

export function removeStalePid(): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
}

export function readPort(): number | null {
  try {
    const value = fs.readFileSync(PORT_FILE, "utf-8").trim();
    const port = Number.parseInt(value, 10);

    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function writePort(port: number): void {
  fs.mkdirSync(VCONTEXT_HOME, { recursive: true });
  fs.writeFileSync(PORT_FILE, `${port}\n`);
}

export function removePort(): void {
  try {
    fs.unlinkSync(PORT_FILE);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
}

// ── Project marker utilities ──────────────────────────────────────────

export const PROJECT_MARKER_DIR = ".vcontext";
export const PROJECT_MARKER_FILE = "project.json";

export interface ProjectMarker {
  readonly slug: string;
  readonly uuid: string;
  readonly version?: 1;
  readonly project?: string;
  readonly remote?: string;
}

export interface FoundProjectMarker {
  readonly root: string;
  readonly path: string;
  readonly marker: ProjectMarker;
  readonly legacy: boolean;
  readonly raw: Readonly<Record<string, unknown>>;
}

export function findProjectMarker(
  start = process.cwd(),
): FoundProjectMarker | null {
  let current = path.resolve(start);

  while (true) {
    const markerPath = path.join(
      current,
      PROJECT_MARKER_DIR,
      PROJECT_MARKER_FILE,
    );

    if (fs.existsSync(markerPath)) {
      const marker: unknown = JSON.parse(fs.readFileSync(markerPath, "utf-8"));

      if (typeof marker !== "object" || marker === null) {
        throw new Error(`Invalid project marker: ${markerPath}`);
      }
      const markerValue = marker as Record<string, unknown>;

      const keys = Object.keys(markerValue).sort();
      const legacy = keys.join(",") === "slug,uuid";
      const canonical = keys.join(",") === "project,project_id,remote,version";
      if (!legacy && !canonical) throw invalidMarker(markerPath);
      let slug: string;
      let uuid: string;
      if (legacy) {
        slug = typeof markerValue.slug === "string" ? markerValue.slug : "";
        uuid = typeof markerValue.uuid === "string" ? markerValue.uuid : "";
      } else {
        if (
          markerValue.version !== 1 ||
          typeof markerValue.project !== "string" ||
          typeof markerValue.project_id !== "string" ||
          typeof markerValue.remote !== "string"
        )
          throw invalidMarker(markerPath);
        const projectParts = markerValue.project.split("/");
        if (
          projectParts.length !== 2 ||
          projectParts.some(
            (part) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part),
          )
        )
          throw invalidMarker(markerPath);
        let remote: URL;
        try {
          remote = new URL(markerValue.remote);
        } catch {
          throw invalidMarker(markerPath);
        }
        if (
          !/^https?:$/.test(remote.protocol) ||
          !remote.pathname.endsWith(
            `/api/v1/projects/${markerValue.project_id}`,
          )
        )
          throw invalidMarker(markerPath);
        slug = projectParts[1]!;
        uuid = markerValue.project_id;
      }
      if (!slug || !isUuid(uuid)) throw invalidMarker(markerPath);

      return {
        root: current,
        path: markerPath,
        marker: canonical
          ? {
              slug,
              uuid,
              version: 1,
              project: markerValue.project as string,
              remote: markerValue.remote as string,
            }
          : { slug, uuid },
        legacy,
        raw: markerValue,
      };
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

function invalidMarker(markerPath: string) {
  return new Error(
    `Invalid project marker: ${markerPath}. Expected version 1 marker; legacy markers must contain only {slug, uuid}.`,
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function resolveProjectSlug(opts: {
  slug?: string;
  cwd?: string;
}): string {
  if (opts.slug !== undefined) {
    return opts.slug;
  }

  const marker = findProjectMarker(opts.cwd ?? process.cwd());

  if (marker !== null) {
    return marker.marker.slug;
  }

  throw new Error(
    "Could not resolve project. Run inside a vcontext project or pass --project <slug>.",
  );
}

export function resolvePort(): Promise<number> {
  return new Promise((resolve) => {
    function tryPort(port: number, attempt: number): void {
      const server = net.createServer();

      server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE" && attempt < 5) {
          tryPort(port + 1, attempt + 1);
        } else {
          resolve(0);
        }
      });

      server.listen(port, "127.0.0.1", () => {
        const address = server.address();

        if (address && typeof address === "object") {
          server.close(() => resolve(address.port));
        } else {
          server.close(() => resolve(0));
        }
      });
    }

    tryPort(DEFAULT_PORT, 0);
  });
}
