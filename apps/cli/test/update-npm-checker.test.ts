import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  checkForNpmUpdates,
  classifyNpmUpdate,
} from "../src/update/npm-checker.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
    path.join(os.tmpdir(), "vcontext-npm-check-"),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, "npm-cache.json");
}

function npmVersionResponse(version: string) {
  return Response.json({ version }, { status: 200 });
}

test("cache hit within 24h returns cached result without network", async () => {
  const file = await cachePath();
  let requests = 0;
  const fakeFetch = (async () => {
    requests += 1;
    return npmVersionResponse("0.2.0");
  }) as typeof fetch;

  const first = await checkForNpmUpdates("0.1.0", {
    cachePath: file,
    now: () => 1_000,
    fetch: fakeFetch,
  });
  const cached = await checkForNpmUpdates("0.1.0", {
    cachePath: file,
    now: () => 1_000 + CACHE_TTL_MS - 1,
    fetch: fakeFetch,
  });

  assert.equal(requests, 1);
  assert.equal(first?.latest, "0.2.0");
  assert.equal(first?.updateType, "minor");
  assert.equal(cached?.latest, "0.2.0");
  assert.equal(cached?.updateType, "minor");
});

test("fresh registry response returns correct update type", async () => {
  const file = await cachePath();
  const fakeFetch = (async () =>
    npmVersionResponse("0.2.0")) as typeof fetch;

  const status = await checkForNpmUpdates("0.1.0", {
    cachePath: file,
    now: () => 1_000,
    fetch: fakeFetch,
  });

  assert.equal(status?.current, "0.1.0");
  assert.equal(status?.latest, "0.2.0");
  assert.equal(status?.updateType, "minor");
  assert.equal(typeof status?.checkedAt, "number");
});

test("up-to-date version returns updateType null", async () => {
  const file = await cachePath();
  const fakeFetch = (async () =>
    npmVersionResponse("0.1.0")) as typeof fetch;

  const status = await checkForNpmUpdates("0.1.0", {
    cachePath: file,
    now: () => 1_000,
    fetch: fakeFetch,
  });

  assert.equal(status?.latest, "0.1.0");
  assert.equal(status?.updateType, null);
});

test("major version bump is classified correctly", async () => {
  const status = await checkForNpmUpdates("1.0.0", {
    cachePath: await cachePath(),
    now: () => 1_000,
    fetch: (async () => npmVersionResponse("2.0.0")) as typeof fetch,
  });
  assert.equal(status?.updateType, "major");
});

test("patch version bump is classified correctly", async () => {
  const status = await checkForNpmUpdates("0.1.0", {
    cachePath: await cachePath(),
    now: () => 1_000,
    fetch: (async () => npmVersionResponse("0.1.1")) as typeof fetch,
  });
  assert.equal(status?.updateType, "patch");
});

test("classifyNpmUpdate utility works for semver edge cases", () => {
  assert.equal(classifyNpmUpdate("0.1.0", "0.1.0"), null);
  assert.equal(classifyNpmUpdate("0.1.0", "0.1.1"), "patch");
  assert.equal(classifyNpmUpdate("0.1.0", "0.2.0"), "minor");
  assert.equal(classifyNpmUpdate("0.1.0", "1.0.0"), "major");
  assert.equal(classifyNpmUpdate("1.0.0", "1.0.0-pre"), null);
  assert.equal(classifyNpmUpdate("invalid", "0.1.0"), null);
});

test("registry HTTP 500 returns stale cache when available", async () => {
  const file = await cachePath();
  let requests = 0;
  const fetchSequence = (async () => {
    requests += 1;
    if (requests === 1) return npmVersionResponse("0.2.0");
    return new Response("Server Error", { status: 500 });
  }) as typeof fetch;

  const first = await checkForNpmUpdates("0.1.0", {
    cachePath: file,
    now: () => 1_000,
    fetch: fetchSequence,
  });
  assert.equal(first?.latest, "0.2.0");

  // Second call (after cache expiry) gets 500 but returns stale cache
  const expired = await checkForNpmUpdates("0.1.0", {
    cachePath: file,
    now: () => 1_000 + CACHE_TTL_MS + 1,
    fetch: fetchSequence,
  });
  assert.equal(requests, 2);
  assert.equal(expired?.latest, "0.2.0");
  assert.equal(expired?.updateType, "minor");
});

test("registry 500 without cache returns null", async () => {
  const file = await cachePath();
  const status = await checkForNpmUpdates("0.1.0", {
    cachePath: file,
    now: () => 1_000,
    fetch: (async () => new Response("Error", {
      status: 500,
    })) as typeof fetch,
  });
  assert.equal(status, null);
});

test("registry fetch failure returns stale cache when available", async () => {
  const file = await cachePath();
  let requests = 0;
  const fetchSequence = (async () => {
    requests += 1;
    if (requests === 1) return npmVersionResponse("0.2.0");
    // Second call rejects (simulate network failure)
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  const first = await checkForNpmUpdates("0.1.0", {
    cachePath: file,
    now: () => 1_000,
    fetch: fetchSequence,
  });
  assert.equal(first?.latest, "0.2.0");

  const failed = await checkForNpmUpdates("0.1.0", {
    cachePath: file,
    now: () => 1_000 + CACHE_TTL_MS + 1,
    fetch: fetchSequence,
  });
  assert.equal(requests, 2);
  assert.equal(failed?.latest, "0.2.0");
});

test("invalid registry response body returns stale cache", async () => {
  const file = await cachePath();
  let requests = 0;
  const fetchSequence = (async () => {
    requests += 1;
    if (requests === 1)
      return Response.json({ version: "0.2.0" }, { status: 200 });
    return Response.json({}, { status: 200 });
  }) as typeof fetch;

  const first = await checkForNpmUpdates("0.1.0", {
    cachePath: file,
    now: () => 1_000,
    fetch: fetchSequence,
  });
  assert.equal(first?.latest, "0.2.0");

  const empty = await checkForNpmUpdates("0.1.0", {
    cachePath: file,
    now: () => 1_000 + CACHE_TTL_MS + 1,
    fetch: fetchSequence,
  });
  assert.equal(requests, 2);
  assert.equal(empty?.latest, "0.2.0");
});
