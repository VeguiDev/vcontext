import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  checkForUpdates,
  markUpdateNotified,
  shouldNotifyUpdate,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FAILURE_BACKOFF_MS,
} from "../src/update/checker.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function cachePath() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "vcontext-update-check-"),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, "cache.json");
}

function release(version = "0.1.1+13") {
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/VeguiDev/vcontext/releases/tag/v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "vcontext-linux-x64.tar.gz",
        browser_download_url:
          "https://github.com/VeguiDev/vcontext/releases/download/release/archive",
        digest: "sha256:abc",
      },
    ],
  };
}

test("successful checks are cached for one day", async () => {
  const file = await cachePath();
  let requests = 0;
  const fakeFetch = (async () => {
    requests += 1;
    return Response.json(release(), { headers: { etag: '"release-13"' } });
  }) as typeof fetch;

  const first = await checkForUpdates({
    currentVersion: "0.1.1+12",
    dependencies: { cachePath: file, now: () => 1_000, fetch: fakeFetch },
  });
  const cached = await checkForUpdates({
    currentVersion: "0.1.1+12",
    dependencies: {
      cachePath: file,
      now: () => 1_000 + UPDATE_CHECK_INTERVAL_MS - 1,
      fetch: fakeFetch,
    },
  });

  assert.equal(requests, 1);
  assert.equal(first?.updateAvailable, true);
  assert.equal(first?.fromCache, false);
  assert.equal(cached?.fromCache, true);
  assert.equal(cached?.latestVersion, "0.1.1+13");
});

test("expired checks use ETag revalidation", async () => {
  const file = await cachePath();
  const headers: Array<string | null> = [];
  let requests = 0;
  const fakeFetch = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    requests += 1;
    headers.push(new Headers(init?.headers).get("if-none-match"));
    if (requests === 1)
      return Response.json(release(), { headers: { etag: '"release-13"' } });
    return new Response(null, {
      status: 304,
      headers: { etag: '"release-13"' },
    });
  }) as typeof fetch;

  await checkForUpdates({
    currentVersion: "0.1.1+12",
    dependencies: { cachePath: file, now: () => 1_000, fetch: fakeFetch },
  });
  const revalidated = await checkForUpdates({
    currentVersion: "0.1.1+12",
    dependencies: {
      cachePath: file,
      now: () => 1_000 + UPDATE_CHECK_INTERVAL_MS,
      fetch: fakeFetch,
    },
  });

  assert.deepEqual(headers, [null, '"release-13"']);
  assert.equal(revalidated?.fromCache, true);
  assert.equal(revalidated?.stale, false);
});

test("automatic failures back off without breaking the caller", async () => {
  const file = await cachePath();
  let requests = 0;
  const failingFetch = (async () => {
    requests += 1;
    return new Response("unavailable", { status: 503 });
  }) as typeof fetch;

  const first = await checkForUpdates({
    currentVersion: "0.1.1",
    dependencies: { cachePath: file, now: () => 1_000, fetch: failingFetch },
  });
  const backedOff = await checkForUpdates({
    currentVersion: "0.1.1",
    dependencies: {
      cachePath: file,
      now: () => 1_000 + UPDATE_FAILURE_BACKOFF_MS - 1,
      fetch: failingFetch,
    },
  });

  assert.equal(first, null);
  assert.equal(backedOff, null);
  assert.equal(requests, 1);
  await assert.rejects(
    checkForUpdates({
      currentVersion: "0.1.1",
      force: true,
      dependencies: {
        cachePath: file,
        now: () => 2_000,
        fetch: failingFetch,
      },
    }),
    /HTTP 503/,
  );
  assert.equal(requests, 2);
});

test("a cache write failure does not discard a successful release check", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "vcontext-update-cache-directory-"),
  );
  temporaryDirectories.push(directory);
  const status = await checkForUpdates({
    currentVersion: "0.1.1+12",
    force: true,
    dependencies: {
      cachePath: directory,
      fetch: (async () => Response.json(release())) as typeof fetch,
    },
  });
  assert.equal(status?.latestVersion, "0.1.1+13");
  assert.equal(status?.updateAvailable, true);
});

test("notification timestamps suppress repeated notices for one day", async () => {
  const file = await cachePath();
  const now = 10_000;
  const status = await checkForUpdates({
    currentVersion: "0.1.1+12",
    dependencies: {
      cachePath: file,
      now: () => now,
      fetch: (async () => Response.json(release())) as typeof fetch,
    },
  });
  assert.ok(status);
  assert.equal(
    await shouldNotifyUpdate(status, { cachePath: file, now: () => now }),
    true,
  );
  await markUpdateNotified(status, { cachePath: file, now: () => now });
  assert.equal(
    await shouldNotifyUpdate(status, {
      cachePath: file,
      now: () => now + UPDATE_CHECK_INTERVAL_MS - 1,
    }),
    false,
  );
  assert.equal(
    await shouldNotifyUpdate(status, {
      cachePath: file,
      now: () => now + UPDATE_CHECK_INTERVAL_MS,
    }),
    true,
  );
});

test("prereleases and insecure release metadata are rejected", async () => {
  const prerelease = release("0.2.0-beta.1");
  const file = await cachePath();
  await assert.rejects(
    checkForUpdates({
      currentVersion: "0.1.1",
      force: true,
      dependencies: {
        cachePath: file,
        fetch: (async () => Response.json(prerelease)) as typeof fetch,
      },
    }),
    /invalid stable release/,
  );

  const insecure = release();
  insecure.html_url = "http://example.test/release";
  await assert.rejects(
    checkForUpdates({
      currentVersion: "0.1.1",
      force: true,
      dependencies: {
        cachePath: file,
        fetch: (async () => Response.json(insecure)) as typeof fetch,
      },
    }),
    /invalid stable release/,
  );
});
