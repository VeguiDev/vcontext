#!/usr/bin/env bun
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

interface DaemonStatus {
  running?: boolean;
  pid?: number;
  api?: boolean;
}

const LEGACY_MIGRATION_CHECKSUMS = new Map([
  ["1.0.0", "7119b5cca4345155c1d8929d80567bbf71ce46559c24d289d915ef714134fe00"],
  ["2.0.0", "ee4ee2a054ca210115a9ad79a78a17a5796b428e04dc4a040794e119339d80eb"],
  ["3.0.0", "0b8bafc6de2e866cd94e26a5a21a96351d3a45857a4189b1c599f6088a489742"],
  ["4.0.0", "19efb65be0acadaf2f1a30da426e86ac80530eb505a909a4dd1099f96b613852"],
]);

const executable = path.resolve(process.argv[2] ?? "");
const expectedVersion =
  process.argv[3] ??
  (
    JSON.parse(fs.readFileSync("apps/cli/package.json", "utf8")) as {
      version: string;
    }
  ).version;

if (!process.argv[2]) {
  throw new Error(
    "Usage: bun scripts/smoke-standalone.ts <executable> [expected-version]",
  );
}
if (!fs.existsSync(executable)) {
  throw new Error(`Standalone executable not found: ${executable}`);
}

const daemonHome = fs.mkdtempSync(
  path.join(os.tmpdir(), "vcontext-standalone-smoke-"),
);

function run(args: string[], home = daemonHome): string {
  return execFileSync(executable, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      VCONTEXT_HOME: home,
      VCONTEXT_IDLE_TIMEOUT_MS: "60000",
      VCONTEXT_NO_UPDATE_CHECK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    windowsHide: true,
  }).trim();
}

function runJson<T>(args: string[], home = daemonHome): T {
  const output = run(args, home);
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(
      `Expected JSON from ${path.basename(executable)} ${args.join(" ")}, received:\n${output}`,
    );
  }
}

function runJsonFailure<T>(args: string[], home = daemonHome): T {
  try {
    run(args, home);
    throw new Error(
      `Expected ${path.basename(executable)} ${args.join(" ")} to fail`,
    );
  } catch (error) {
    const stderr =
      error &&
      typeof error === "object" &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    if (!stderr) throw error;
    return JSON.parse(stderr) as T;
  }
}

function pidFromFile(home = daemonHome): number | null {
  try {
    const pid = Number.parseInt(
      fs.readFileSync(path.join(home, "vcontext.pid"), "utf8"),
      10,
    );
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function waitForStop(home = daemonHome): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = runJson<DaemonStatus>(["daemon", "status", "--json"], home);
    if (status.running === false) return true;
    await sleep(100);
  }
  return false;
}

async function stopDaemon(home = daemonHome): Promise<void> {
  const stopped = runJson<{ stopping?: boolean }>(
    ["daemon", "stop", "--json"],
    home,
  );
  assert.equal(stopped.stopping, true);
  assert.equal(
    await waitForStop(home),
    true,
    "Daemon did not stop within 4 seconds",
  );
}

try {
  assert.equal(run(["--version"]), expectedVersion);
  assert.match(run(["--help"]), /^vcontext\b/m);

  const started = runJson<DaemonStatus>(["daemon", "start", "--json"]);
  assert.equal(started.running, true);

  const status = runJson<DaemonStatus>(["daemon", "status", "--json"]);
  assert.equal(status.running, true);
  assert.equal(status.api, true);
  assert.equal(Number.isInteger(status.pid) && (status.pid ?? 0) > 0, true);

  const workspace = path.join(daemonHome, "legacy-checksum-workspace");
  fs.mkdirSync(workspace);
  const project = runJson<{ slug?: string }>([
    "init",
    "legacy-checksum-smoke",
    "--path",
    workspace,
    "--json",
  ]);
  assert.equal(project.slug, "legacy-checksum-smoke");
  await stopDaemon();

  const database = new Database(
    path.join(daemonHome, "projects", "legacy-checksum-smoke", "data.db"),
  );
  const replaceChecksum = database.query(
    "UPDATE schema_migrations SET checksum = ? WHERE version = ?",
  );
  for (const [version, checksum] of LEGACY_MIGRATION_CHECKSUMS) {
    replaceChecksum.run(checksum, version);
  }
  database.close();

  assert.equal(
    runJson<DaemonStatus>(["daemon", "start", "--json"]).running,
    true,
  );
  const legacyStatus = runJson<{ slug?: string }>([
    "status",
    "legacy-checksum-smoke",
    "--json",
  ]);
  assert.equal(legacyStatus.slug, "legacy-checksum-smoke");
  await stopDaemon();

  const invalidDatabase = new Database(
    path.join(daemonHome, "projects", "legacy-checksum-smoke", "data.db"),
  );
  invalidDatabase
    .query(
      "UPDATE schema_migrations SET checksum = 'invalid' WHERE version = '1.0.0'",
    )
    .run();
  invalidDatabase.close();
  assert.equal(
    runJson<DaemonStatus>(["daemon", "start", "--json"]).running,
    true,
  );
  const rejected = runJsonFailure<{
    error?: { code?: string; message?: string };
  }>(["status", "legacy-checksum-smoke", "--json"]);
  assert.equal(rejected.error?.code, "MIGRATION_ERROR");
  assert.match(rejected.error?.message ?? "", /Checksum mismatch/);
  assert.equal(
    runJson<DaemonStatus>(["daemon", "status", "--json"]).running,
    true,
  );
  await stopDaemon();

  const existingHomeSource = process.env.VCONTEXT_SMOKE_EXISTING_HOME;
  if (existingHomeSource) {
    const copyRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "vcontext-existing-home-smoke-"),
    );
    const copiedHome = path.join(copyRoot, "home");
    try {
      fs.cpSync(path.resolve(existingHomeSource), copiedHome, {
        recursive: true,
      });
      fs.rmSync(path.join(copiedHome, "vcontext.pid"), { force: true });
      fs.rmSync(path.join(copiedHome, "vcontext.port"), { force: true });
      const projectSlug = process.env.VCONTEXT_SMOKE_PROJECT ?? "vcontext";
      const copiedStatus = runJson<{ slug?: string }>(
        ["status", projectSlug, "--json"],
        copiedHome,
      );
      assert.equal(copiedStatus.slug, projectSlug);
      await stopDaemon(copiedHome);
    } finally {
      const pid = pidFromFile(copiedHome);
      if (pid !== null) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // The daemon already exited.
        }
      }
      fs.rmSync(copyRoot, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    }
  }

  console.log(
    `Smoke-tested ${path.basename(executable)} ${expectedVersion} with embedded daemon`,
  );
} finally {
  const pid = pidFromFile();
  if (pid !== null) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The daemon already exited.
    }
    await sleep(100);
  }
  fs.rmSync(daemonHome, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}
