import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { VCONTEXT_HOME } from "@repo/vcontext-core";
import {
  isStableReleaseVersion,
  isUpdateAvailable,
  normalizeReleaseVersion,
} from "./version.js";

const RELEASES_API =
  "https://api.github.com/repos/VeguiDev/vcontext/releases/latest";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_FAILURE_BACKOFF_MS = 60 * 60 * 1000;

export interface ReleaseAsset {
  name: string;
  url: string;
  digest?: string;
}

export interface ReleaseInfo {
  version: string;
  tag: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  release: ReleaseInfo;
  fromCache: boolean;
  stale: boolean;
}

interface UpdateCache {
  schemaVersion: 1;
  checkedAt?: number;
  lastAttemptAt: number;
  lastNotifiedAt?: number;
  etag?: string;
  release?: ReleaseInfo;
}

export interface UpdateCheckerDependencies {
  fetch?: typeof fetch;
  now?: () => number;
  cachePath?: string;
}

export interface CheckForUpdatesOptions {
  currentVersion: string;
  force?: boolean;
  timeoutMs?: number;
  dependencies?: UpdateCheckerDependencies;
}

export async function checkForUpdates(
  options: CheckForUpdatesOptions,
): Promise<UpdateStatus | null> {
  const dependencies = options.dependencies ?? {};
  const now = dependencies.now?.() ?? Date.now();
  const cachePath =
    dependencies.cachePath ?? path.join(VCONTEXT_HOME, "update-check.json");
  const cache = await readUpdateCache(cachePath);
  const currentVersion = normalizeReleaseVersion(options.currentVersion);
  if (!currentVersion)
    throw new TypeError(`Invalid current version: ${options.currentVersion}`);

  if (!options.force && cache?.release && cache.checkedAt !== undefined) {
    if (now - cache.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
      return statusFor(currentVersion, cache.release, true, false);
    }
  }
  if (
    !options.force &&
    cache &&
    now - cache.lastAttemptAt < UPDATE_FAILURE_BACKOFF_MS
  ) {
    return cache.release
      ? statusFor(currentVersion, cache.release, true, true)
      : null;
  }

  try {
    const response = await requestLatestRelease(
      dependencies.fetch ?? fetch,
      cache?.etag,
      options.timeoutMs ?? 15_000,
      currentVersion,
    );
    const release = response.release ?? cache?.release;
    if (!release)
      throw new Error("GitHub returned 304 without a cached release.");
    const etag = response.etag ?? cache?.etag;
    await writeUpdateCache(cachePath, {
      schemaVersion: 1,
      checkedAt: now,
      lastAttemptAt: now,
      ...(cache?.lastNotifiedAt !== undefined
        ? { lastNotifiedAt: cache.lastNotifiedAt }
        : {}),
      ...(etag ? { etag } : {}),
      release,
    }).catch(() => {});
    return statusFor(currentVersion, release, response.release === null, false);
  } catch (error) {
    await writeUpdateCache(cachePath, {
      schemaVersion: 1,
      ...(cache?.checkedAt !== undefined ? { checkedAt: cache.checkedAt } : {}),
      lastAttemptAt: now,
      ...(cache?.lastNotifiedAt !== undefined
        ? { lastNotifiedAt: cache.lastNotifiedAt }
        : {}),
      ...(cache?.etag ? { etag: cache.etag } : {}),
      ...(cache?.release ? { release: cache.release } : {}),
    }).catch(() => {});
    if (options.force) throw error;
    return cache?.release
      ? statusFor(currentVersion, cache.release, true, true)
      : null;
  }
}

export async function shouldNotifyUpdate(
  status: UpdateStatus,
  dependencies: UpdateCheckerDependencies = {},
): Promise<boolean> {
  if (!status.updateAvailable) return false;
  const cachePath =
    dependencies.cachePath ?? path.join(VCONTEXT_HOME, "update-check.json");
  const cache = await readUpdateCache(cachePath);
  const now = dependencies.now?.() ?? Date.now();
  return (
    cache?.lastNotifiedAt === undefined ||
    now - cache.lastNotifiedAt >= UPDATE_CHECK_INTERVAL_MS
  );
}

export async function markUpdateNotified(
  status: UpdateStatus,
  dependencies: UpdateCheckerDependencies = {},
): Promise<void> {
  const cachePath =
    dependencies.cachePath ?? path.join(VCONTEXT_HOME, "update-check.json");
  const cache = await readUpdateCache(cachePath);
  if (!cache || cache.release?.version !== status.latestVersion) return;
  await writeUpdateCache(cachePath, {
    ...cache,
    lastNotifiedAt: dependencies.now?.() ?? Date.now(),
  });
}

async function requestLatestRelease(
  fetcher: typeof fetch,
  etag: string | undefined,
  timeoutMs: number,
  currentVersion: string,
): Promise<{ release: ReleaseInfo | null; etag?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(RELEASES_API, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": `vcontext/${currentVersion}`,
        "x-github-api-version": "2022-11-28",
        ...(etag ? { "if-none-match": etag } : {}),
      },
      signal: controller.signal,
    });
    if (response.status === 304)
      return {
        release: null,
        ...(response.headers.get("etag")
          ? { etag: response.headers.get("etag")! }
          : {}),
      };
    if (!response.ok)
      throw new Error(
        `GitHub release check failed with HTTP ${response.status}.`,
      );
    const release = parseRelease(await response.json());
    const responseEtag = response.headers.get("etag");
    return {
      release,
      ...(responseEtag ? { etag: responseEtag } : {}),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseRelease(value: unknown): ReleaseInfo {
  if (!isRecord(value)) throw new Error("GitHub returned an invalid release.");
  const tag = typeof value.tag_name === "string" ? value.tag_name : "";
  const version = normalizeReleaseVersion(tag);
  const releaseUrl = typeof value.html_url === "string" ? value.html_url : "";
  if (
    !version ||
    !isStableReleaseVersion(version) ||
    !isHttpsUrl(releaseUrl) ||
    value.draft === true ||
    value.prerelease === true
  )
    throw new Error("GitHub returned an invalid stable release.");
  const assets = Array.isArray(value.assets)
    ? value.assets.flatMap((asset) => {
        if (!isRecord(asset)) return [];
        const name = typeof asset.name === "string" ? asset.name : "";
        const url =
          typeof asset.browser_download_url === "string"
            ? asset.browser_download_url
            : "";
        if (!name || !isHttpsUrl(url)) return [];
        const digest =
          typeof asset.digest === "string" ? asset.digest : undefined;
        return [{ name, url, ...(digest ? { digest } : {}) }];
      })
    : [];
  return { version, tag, releaseUrl, assets };
}

function statusFor(
  currentVersion: string,
  release: ReleaseInfo,
  fromCache: boolean,
  stale: boolean,
): UpdateStatus {
  return {
    currentVersion,
    latestVersion: release.version,
    updateAvailable: isUpdateAvailable(currentVersion, release.version),
    releaseUrl: release.releaseUrl,
    release,
    fromCache,
    stale,
  };
}

async function readUpdateCache(cachePath: string): Promise<UpdateCache | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (!isRecord(value) || value.schemaVersion !== 1) return null;
    const lastAttemptAt = number(value.lastAttemptAt);
    if (lastAttemptAt === null) return null;
    const release = value.release
      ? parseCachedRelease(value.release)
      : undefined;
    return {
      schemaVersion: 1,
      lastAttemptAt,
      ...(number(value.checkedAt) !== null
        ? { checkedAt: number(value.checkedAt)! }
        : {}),
      ...(number(value.lastNotifiedAt) !== null
        ? { lastNotifiedAt: number(value.lastNotifiedAt)! }
        : {}),
      ...(typeof value.etag === "string" ? { etag: value.etag } : {}),
      ...(release ? { release } : {}),
    };
  } catch {
    return null;
  }
}

async function writeUpdateCache(
  cachePath: string,
  cache: UpdateCache,
): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(
      temporary,
      `${JSON.stringify(cache, null, 2)}\n`,
      "utf8",
    );
    await fs.rename(temporary, cachePath);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

function parseCachedRelease(value: unknown): ReleaseInfo | undefined {
  if (!isRecord(value)) return undefined;
  const version =
    typeof value.version === "string"
      ? normalizeReleaseVersion(value.version)
      : null;
  const tag = typeof value.tag === "string" ? value.tag : "";
  const releaseUrl =
    typeof value.releaseUrl === "string" ? value.releaseUrl : "";
  if (
    !version ||
    !isStableReleaseVersion(version) ||
    !tag ||
    !isHttpsUrl(releaseUrl) ||
    !Array.isArray(value.assets)
  )
    return undefined;
  const assets = value.assets.flatMap((asset) => {
    if (!isRecord(asset)) return [];
    const name = typeof asset.name === "string" ? asset.name : "";
    const url = typeof asset.url === "string" ? asset.url : "";
    if (!name || !isHttpsUrl(url)) return [];
    return [
      {
        name,
        url,
        ...(typeof asset.digest === "string" ? { digest: asset.digest } : {}),
      },
    ];
  });
  return { version, tag, releaseUrl, assets };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
