import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import * as semver from "semver";
import { VCONTEXT_HOME } from "@repo/vcontext-core";

export interface NpmUpdateStatus {
  current: string;
  latest: string;
  updateType: "major" | "minor" | "patch" | null;
  checkedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FAILURE_BACKOFF_MS = 60 * 60 * 1000; // 1h
const FETCH_TIMEOUT_MS = 1_000;
const CACHE_FILE = "npm-update-check.json";
const PACKAGE_NAME = "vcontext";

function getCacheDir(): string {
  return path.join(
    process.env.VCONTEXT_HOME || path.join(homedir(), ".vcontext"),
    "update-cache",
  );
}

export function getCachePath(override?: string): string {
  return override ?? path.join(getCacheDir(), CACHE_FILE);
}

async function readCache(cachePath: string): Promise<NpmUpdateStatus | null> {
  try {
    const data = await readFile(cachePath, "utf-8");
    return JSON.parse(data) as NpmUpdateStatus;
  } catch {
    return null;
  }
}

async function writeCache(
  cachePath: string,
  status: NpmUpdateStatus,
): Promise<void> {
  const dir = path.dirname(cachePath);
  await mkdir(dir, { recursive: true });
  await writeFile(cachePath, JSON.stringify(status));
}

function classifyUpdate(
  current: string,
  latest: string,
): "major" | "minor" | "patch" | null {
  const c = semparse(current);
  const l = semparse(latest);
  if (!c || !l) return null;
  if (l.major > c.major) return "major";
  if (l.minor > c.minor) return "minor";
  if (l.patch > c.patch) return "patch";
  return null;
}

function semparse(
  v: string,
): { major: number; minor: number; patch: number } | null {
  const parsed = semver.parse(v);
  if (!parsed) return null;
  return { major: parsed.major, minor: parsed.minor, patch: parsed.patch };
}

export interface CheckOptions {
  fetch?: typeof fetch;
  now?: () => number;
  cachePath?: string;
}

export async function checkForNpmUpdates(
  currentVersion: string,
  options: CheckOptions = {},
): Promise<NpmUpdateStatus | null> {
  const fetchFn = options.fetch || globalThis.fetch;
  const now = options.now || (() => Date.now());
  const cachePath = getCachePath(options.cachePath);

  const cached = await readCache(cachePath);
  if (cached && now() - cached.checkedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetchFn(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      {
        signal: controller.signal,
        headers: { Accept: "application/vnd.npm.install-v1+json" },
      },
    );
    clearTimeout(timeout);

    if (!res.ok) {
      if (cached) {
        cached.checkedAt = now();
        await writeCache(cachePath, cached).catch(() => {});
        return cached;
      }
      return null;
    }

    const data = (await res.json()) as { version?: string };
    const latest: string = data?.version || "";
    if (!latest) {
      if (cached) return cached;
      return null;
    }

    const updateType = classifyUpdate(currentVersion, latest);
    const status: NpmUpdateStatus = {
      current: currentVersion,
      latest,
      updateType,
      checkedAt: now(),
    };
    await writeCache(cachePath, status);
    return status;
  } catch {
    if (cached) {
      cached.checkedAt = now();
      await writeCache(cachePath, cached).catch(() => {});
      return cached;
    }
    return null;
  }
}

export function classifyNpmUpdate(
  currentVersion: string,
  latestVersion: string,
): "major" | "minor" | "patch" | null {
  return classifyUpdate(currentVersion, latestVersion);
}
