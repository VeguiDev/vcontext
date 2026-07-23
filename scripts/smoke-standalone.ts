#!/usr/bin/env bun
import assert from "node:assert/strict";
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
const environment = {
  ...process.env,
  VCONTEXT_HOME: daemonHome,
  VCONTEXT_IDLE_TIMEOUT_MS: "60000",
  VCONTEXT_NO_UPDATE_CHECK: "1",
};

function run(args: string[]): string {
  return execFileSync(executable, args, {
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    windowsHide: true,
  }).trim();
}

function runJson<T>(args: string[]): T {
  const output = run(args);
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(
      `Expected JSON from ${path.basename(executable)} ${args.join(" ")}, received:\n${output}`,
    );
  }
}

function pidFromFile(): number | null {
  try {
    const pid = Number.parseInt(
      fs.readFileSync(path.join(daemonHome, "vcontext.pid"), "utf8"),
      10,
    );
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function waitForStop(): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = runJson<DaemonStatus>(["daemon", "status", "--json"]);
    if (status.running === false) return true;
    await sleep(100);
  }
  return false;
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

  const stopped = runJson<{ stopping?: boolean }>(["daemon", "stop", "--json"]);
  assert.equal(stopped.stopping, true);
  assert.equal(
    await waitForStop(),
    true,
    "Daemon did not stop within 4 seconds",
  );

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
