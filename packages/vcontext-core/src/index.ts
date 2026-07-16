import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const VCONTEXT_HOME =
  process.env.VCONTEXT_HOME ?? path.join(os.homedir(), ".vcontext");

export const PID_FILE = path.join(VCONTEXT_HOME, "vcontext.pid");
export const PORT_FILE = path.join(VCONTEXT_HOME, "vcontext.port");
export const TOKEN_FILE = path.join(VCONTEXT_HOME, "vcontext.token");
export const DEFAULT_PORT = 11434;

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
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
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
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
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
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
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
}

export interface FoundProjectMarker {
  readonly root: string;
  readonly path: string;
  readonly marker: ProjectMarker;
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

      const slug = "slug" in marker ? marker.slug : undefined;
      const uuid = "uuid" in marker ? marker.uuid : undefined;

      if (typeof slug !== "string" || typeof uuid !== "string") {
        throw new Error(`Invalid project marker: ${markerPath}`);
      }

      return {
        root: current,
        path: markerPath,
        marker: { slug, uuid },
      };
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
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
