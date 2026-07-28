#!/usr/bin/env node

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const launcherFile = fileURLToPath(import.meta.url);

export const REPOSITORY_ROOT = path.resolve(
  path.dirname(launcherFile),
  "..",
  "..",
  "..",
);

export function resolveDevEnvironment({
  env = process.env,
  cwd = process.cwd(),
  home = os.homedir(),
} = {}) {
  const configuredHome = env.VCONTEXT_DEV_HOME?.trim();
  const devHome = configuredHome
    ? path.resolve(cwd, configuredHome)
    : path.join(home, ".vcontext-dev");

  return {
    ...env,
    VCONTEXT_HOME: devHome,
    VCONTEXT_KEYRING_SERVICE: "vcontext-cli-dev",
    VCONTEXT_CLI_NAME: "vcontext-dev",
  };
}

export function resolvePnpmInvocation(
  args,
  { env = process.env, platform = process.platform } = {},
) {
  const npmExecPath = env.npm_execpath;
  if (npmExecPath && /(?:^|[\\/])pnpm(?:\.c?js)?$/i.test(npmExecPath)) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
    };
  }

  if (platform === "win32") {
    return {
      command: env.ComSpec || env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", "pnpm", ...args],
    };
  }

  return { command: "pnpm", args };
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function exitCode(result) {
  return result.code ?? (result.signal ? 128 : 1);
}

export async function main(args = process.argv.slice(2)) {
  const callerCwd = process.cwd();
  const environment = resolveDevEnvironment({ cwd: callerCwd });
  const buildInvocation = resolvePnpmInvocation([
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=vcontext...",
    "--filter=@app/deamon...",
  ]);

  let buildResult;
  try {
    buildResult = await run(buildInvocation.command, buildInvocation.args, {
      cwd: REPOSITORY_ROOT,
      env: environment,
    });
  } catch (error) {
    console.error(
      `vcontext-dev: unable to start pnpm: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  if (buildResult.code !== 0) {
    console.error("vcontext-dev: the development build failed.");
    return exitCode(buildResult);
  }

  const cliEntry = path.join(
    REPOSITORY_ROOT,
    "apps",
    "cli",
    "dist",
    "src",
    "index.js",
  );

  try {
    const cliResult = await run(process.execPath, [cliEntry, ...args], {
      cwd: callerCwd,
      env: environment,
    });
    return exitCode(cliResult);
  } catch (error) {
    console.error(
      `vcontext-dev: unable to start the CLI: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFile === launcherFile) {
  process.exitCode = await main();
}
