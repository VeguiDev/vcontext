import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { managedLaunchers, resolveGlobalBin } from "../bin/manage-link.mjs";
import {
  REPOSITORY_ROOT,
  resolveDevEnvironment,
  resolvePnpmInvocation,
} from "../bin/vcontext-dev.mjs";

test("resolves the repository independently from the working directory", () => {
  assert.equal(path.basename(REPOSITORY_ROOT), "vcontext");
  assert.equal(fs.existsSync(path.join(REPOSITORY_ROOT, "turbo.json")), true);
});

test("isolates development state from an existing production home", () => {
  const environment = resolveDevEnvironment({
    env: { VCONTEXT_HOME: "production-home" },
    cwd: path.resolve("work"),
    home: path.resolve("user-home"),
  });

  assert.equal(
    environment.VCONTEXT_HOME,
    path.join(path.resolve("user-home"), ".vcontext-dev"),
  );
  assert.equal(environment.VCONTEXT_KEYRING_SERVICE, "vcontext-cli-dev");
  assert.equal(environment.VCONTEXT_CLI_NAME, "vcontext-dev");
});

test("resolves a configured development home from the caller directory", () => {
  const cwd = path.resolve("project");
  const environment = resolveDevEnvironment({
    env: { VCONTEXT_DEV_HOME: ".state" },
    cwd,
    home: os.homedir(),
  });

  assert.equal(environment.VCONTEXT_HOME, path.join(cwd, ".state"));
});

test("uses the active pnpm entrypoint when invoked by a pnpm script", () => {
  const invocation = resolvePnpmInvocation(["exec", "turbo"], {
    env: { npm_execpath: path.join("tools", "pnpm.cjs") },
    platform: "linux",
  });

  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [
    path.join("tools", "pnpm.cjs"),
    "exec",
    "turbo",
  ]);
});

test("uses cmd.exe for a globally linked launcher on Windows", () => {
  const invocation = resolvePnpmInvocation(["exec", "turbo"], {
    env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    platform: "win32",
  });

  assert.equal(invocation.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(invocation.args, [
    "/d",
    "/s",
    "/c",
    "pnpm",
    "exec",
    "turbo",
  ]);
});

test("creates only the vcontext-dev command for Unix", () => {
  const entries = managedLaunchers("/bin", {
    platform: "linux",
    launcher: "/repo/vcontext-dev.mjs",
  });

  assert.deepEqual(entries, [
    {
      path: path.join("/bin", "vcontext-dev"),
      type: "symlink",
      target: "/repo/vcontext-dev.mjs",
    },
  ]);
});

test("creates cmd, PowerShell, and shell shims for Windows", () => {
  const entries = managedLaunchers("C:\\pnpm", {
    platform: "win32",
    launcher: "C:\\repo\\vcontext-dev.mjs",
  });

  assert.deepEqual(
    entries.map((entry) => path.extname(entry.path)),
    [".cmd", ".ps1", ""],
  );
  assert.equal(
    entries.every((entry) =>
      entry.content.includes("vcontext-dev managed launcher"),
    ),
    true,
  );
});

test("prefers PNPM_HOME without querying the global package environment", async () => {
  const bin = path.resolve("pnpm-home");
  assert.equal(await resolveGlobalBin({ PNPM_HOME: bin }), bin);
});
