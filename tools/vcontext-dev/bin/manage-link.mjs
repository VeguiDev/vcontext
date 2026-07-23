#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePnpmInvocation } from "./vcontext-dev.mjs";

const MARKER = "vcontext-dev managed launcher";
const managerFile = fileURLToPath(import.meta.url);
const launcherFile = path.join(path.dirname(managerFile), "vcontext-dev.mjs");

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function powershellQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function cmdQuote(value) {
  return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
}

export function managedLaunchers(
  binDirectory,
  { platform = process.platform, launcher = launcherFile } = {},
) {
  if (platform !== "win32") {
    return [
      {
        path: path.join(binDirectory, "vcontext-dev"),
        type: "symlink",
        target: launcher,
      },
    ];
  }

  return [
    {
      path: path.join(binDirectory, "vcontext-dev.cmd"),
      type: "file",
      content: `@REM ${MARKER}\r\n@ECHO off\r\nnode ${cmdQuote(launcher)} %*\r\n`,
    },
    {
      path: path.join(binDirectory, "vcontext-dev.ps1"),
      type: "file",
      content: `# ${MARKER}\n& node ${powershellQuote(launcher)} @args\nexit $LASTEXITCODE\n`,
    },
    {
      path: path.join(binDirectory, "vcontext-dev"),
      type: "file",
      content: `#!/bin/sh\n# ${MARKER}\nexec node ${shellQuote(launcher)} "$@"\n`,
      mode: 0o755,
    },
  ];
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `pnpm exited with code ${code}`));
    });
  });
}

export async function resolveGlobalBin(env = process.env) {
  if (env.PNPM_HOME?.trim()) return path.resolve(env.PNPM_HOME.trim());

  const invocation = resolvePnpmInvocation(["bin", "--global"], { env });
  const result = await capture(invocation.command, invocation.args);
  const finalLine = result.split(/\r?\n/).filter(Boolean).at(-1);
  if (!finalLine)
    throw new Error("pnpm did not report its global bin directory");
  return path.resolve(finalLine);
}

function pathExists(value) {
  try {
    fs.lstatSync(value);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

function isManaged(entry) {
  if (!pathExists(entry.path)) return true;
  if (entry.type === "symlink") {
    try {
      return (
        path.resolve(path.dirname(entry.path), fs.readlinkSync(entry.path)) ===
        path.resolve(entry.target)
      );
    } catch {
      return false;
    }
  }
  try {
    return fs.readFileSync(entry.path, "utf8").includes(MARKER);
  } catch {
    return false;
  }
}

function removeManaged(entry) {
  if (!pathExists(entry.path)) return false;
  if (!isManaged(entry))
    throw new Error(`Refusing to replace unmanaged command: ${entry.path}`);
  fs.unlinkSync(entry.path);
  return true;
}

function assertReplaceable(entries) {
  for (const entry of entries) {
    if (pathExists(entry.path) && !isManaged(entry))
      throw new Error(`Refusing to replace unmanaged command: ${entry.path}`);
  }
}

export async function link(env = process.env) {
  const binDirectory = await resolveGlobalBin(env);
  if (!fs.existsSync(binDirectory))
    throw new Error(
      `pnpm global bin directory does not exist: ${binDirectory}`,
    );
  const entries = managedLaunchers(binDirectory);
  assertReplaceable(entries);
  for (const entry of entries) {
    removeManaged(entry);
    if (entry.type === "symlink") fs.symlinkSync(entry.target, entry.path);
    else fs.writeFileSync(entry.path, entry.content, { mode: entry.mode });
  }
  console.log(`Linked vcontext-dev in ${binDirectory}`);
}

export async function unlink(env = process.env) {
  const binDirectory = await resolveGlobalBin(env);
  const entries = managedLaunchers(binDirectory);
  assertReplaceable(entries);
  let removed = false;
  for (const entry of entries) removed = removeManaged(entry) || removed;
  console.log(
    removed
      ? `Unlinked vcontext-dev from ${binDirectory}`
      : "vcontext-dev is not linked",
  );
}

export async function main(operation = process.argv[2]) {
  if (operation === "link") return link();
  if (operation === "unlink") return unlink();
  throw new Error("Usage: manage-link.mjs <link|unlink>");
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFile === managerFile) {
  try {
    await main();
  } catch (error) {
    console.error(
      `vcontext-dev: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
