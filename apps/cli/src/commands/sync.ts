import path from "node:path";
import { DaemonClientError } from "@repo/daemon-client";
import { getUi } from "../ui/index.js";
import {
  assertNoArgs,
  emit,
  outputOptions,
  takeFlag,
  takeOption,
  type OutputOptions,
} from "./common.js";
import { renderResult } from "../ui/renderers.js";

export interface SyncCommandDependencies {
  requestValue(method: string, path: string, body?: unknown): Promise<unknown>;
  resolveProjectSlug(input: string[]): Promise<string>;
  confirmRemoteMove?(from: string, to: string): Promise<boolean>;
  isTTY?: boolean;
  cwd?: string;
}

export async function cloneCommand(
  input: string[],
  dependencies: SyncCommandDependencies,
): Promise<void> {
  const output = outputOptions(input);
  const yes = takeFlag(input, "--yes");
  const path = takeOption(input, "--path");
  const host =
    takeOption(input, "--host") ??
    process.env.VCONTEXT_CLOUD_URL ??
    "https://cloud.vcontext.dev";
  const remoteInput = takePositional(
    input,
    "Usage: vcontext clone <url> [path|--path path] [--yes] [--json|--quiet]",
  );
  const remoteUrl =
    /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remoteInput)
      ? new URL(`/${remoteInput}`, host).toString()
      : remoteInput;
  const destination = path ?? takeOptionalPositional(input);
  assertNoArgs(
    input,
    "Usage: vcontext clone <url> [path|--path path] [--yes] [--json|--quiet]",
  );
  const value = await requestWithMove(
    dependencies,
    "POST",
    "/sync/clone",
    {
      remote_url: remoteUrl,
      path: resolveCloneDestination(
        remoteUrl,
        destination,
        dependencies.cwd ?? process.cwd(),
      ),
      yes,
    },
    output,
    yes,
    "Cloning project context",
  );
  emit(value, output, (result) => printSyncResult("Cloned", result));
}

function resolveCloneDestination(
  remoteUrl: string,
  destination: string | undefined,
  cwd: string,
): string {
  if (destination) return path.resolve(cwd, destination);

  let parts: string[];
  try {
    parts = new URL(remoteUrl).pathname.split("/").filter(Boolean);
  } catch {
    throw new DaemonClientError("Clone URL must be a valid URL", 2);
  }
  const encodedName =
    parts.at(-1) === "v1" && parts.at(-2) === "sync"
      ? parts.at(-3)
      : parts.at(-1);
  let name: string;
  try {
    name = encodedName ? decodeURIComponent(encodedName) : "";
  } catch {
    throw new DaemonClientError(
      "Clone URL contains an invalid project name",
      2,
    );
  }
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new DaemonClientError(
      "Could not determine the clone directory from the URL; provide a path",
      2,
    );
  }
  return path.resolve(cwd, name);
}

export async function fetchCommand(
  input: string[],
  dependencies: SyncCommandDependencies,
): Promise<void> {
  return projectSyncCommand("fetch", input, dependencies);
}

export async function pullCommand(
  input: string[],
  dependencies: SyncCommandDependencies,
): Promise<void> {
  return projectSyncCommand("pull", input, dependencies);
}

export async function pushCommand(
  input: string[],
  dependencies: SyncCommandDependencies,
): Promise<void> {
  return projectSyncCommand("push", input, dependencies);
}

async function projectSyncCommand(
  action: "fetch" | "pull" | "push",
  input: string[],
  dependencies: SyncCommandDependencies,
): Promise<void> {
  const output = outputOptions(input);
  const yes = takeFlag(input, "--yes");
  const force = takeFlag(input, "--force");
  const project = takeOption(input, "--project") ?? takeOption(input, "--slug");
  const remoteOption = takeOption(input, "--remote");
  const branchOption = takeOption(input, "--branch");
  const remote = remoteOption ?? takeOptionalPositional(input);
  const branch = branchOption ?? takeOptionalPositional(input);
  if (action !== "push" && force) {
    throw new DaemonClientError(`--force is only valid for push`, 2);
  }
  const slug = await dependencies.resolveProjectSlug(
    project ? ["--project", project] : [],
  );
  assertNoArgs(
    input,
    `Usage: vcontext ${action} [remote] [branch] [--project slug] [--json|--quiet]`,
  );
  if (action === "push") {
    const query = remote ? `?remote=${encodeURIComponent(remote)}` : "";
    const readiness = await dependencies.requestValue(
      "GET",
      `/projects/${encodeURIComponent(slug)}/sync/push-readiness${query}`,
    );
    assertPushReady(readiness);
  }
  const value = await requestWithMove(
    dependencies,
    "POST",
    `/projects/${encodeURIComponent(slug)}/sync/${action}`,
    { remote, branch, force: action === "push" ? force : undefined, yes },
    output,
    yes,
    `${action === "fetch" ? "Fetching" : action === "pull" ? "Pulling" : "Pushing"} project context`,
  );
  emit(value, output, (result) =>
    printSyncResult(
      `${action[0]!.toUpperCase()}${action.slice(1)} complete`,
      result,
    ),
  );
}

function assertPushReady(value: unknown): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !("ready" in value) ||
    typeof value.ready !== "boolean"
  ) {
    throw new DaemonClientError(
      "The daemon returned an invalid push readiness response.",
    );
  }
  if (value.ready) return;
  const record = value as Record<string, unknown>;
  const missing = Array.isArray(record.missing)
    ? record.missing.filter((item): item is string => typeof item === "string")
    : [];
  const hint =
    typeof record.hint === "string" && record.hint.trim()
      ? record.hint
      : "Configure Git and VContext user name and email before pushing.";
  throw new DaemonClientError(
    `Push requires Git and VContext user name and email${missing.length ? `. Missing: ${missing.join(", ")}` : "."}`,
    2,
    undefined,
    {
      code: "IDENTITY_REQUIRED",
      hint,
      details: record,
    },
  );
}

async function requestWithMove(
  dependencies: SyncCommandDependencies,
  method: string,
  path: string,
  body: Record<string, unknown>,
  output: OutputOptions,
  yes: boolean,
  progress: string,
): Promise<unknown> {
  let result = await getUi().run(progress, () =>
    dependencies.requestValue(method, path, body),
  );
  if (!isRemoteMoved(result)) return result;

  const tty = dependencies.isTTY ?? getUi().isTTY;
  let accepted = yes;
  if (!accepted && tty && !output.json && !output.quiet) {
    accepted = await (dependencies.confirmRemoteMove ?? confirmRemoteMove)(
      result.from ?? "configured remote",
      result.location,
    );
  }
  if (!accepted) {
    throw new DaemonClientError(
      result.message ?? "The remote moved; configuration was not changed.",
      10,
      undefined,
      {
        code: "REMOTE_MOVED",
        hint: "Re-run the command with `--yes` to accept the new location.",
        details: {
          location: result.location,
          note: `New remote URL: ${result.location}`,
        },
      },
    );
  }
  result = await getUi().run(progress, () =>
    dependencies.requestValue(method, path, {
      ...body,
      yes: true,
    }),
  );
  if (isRemoteMoved(result)) {
    throw new DaemonClientError(
      "The remote move could not be accepted.",
      10,
      undefined,
      {
        code: "REMOTE_MOVED",
        hint: "Check the remote URL and try again.",
        details: {
          location: result.location,
          note: `Remote URL: ${result.location}`,
        },
      },
    );
  }
  return result;
}

async function confirmRemoteMove(from: string, to: string): Promise<boolean> {
  return getUi().confirm(
    `Remote moved from ${from} to ${to}. Update the remote?`,
  );
}

function isRemoteMoved(value: unknown): value is {
  code: "REMOTE_MOVED";
  location: string;
  from?: string;
  message?: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    value.code === "REMOTE_MOVED" &&
    "location" in value &&
    typeof value.location === "string"
  );
}

function takePositional(input: string[], usage: string): string {
  const value = takeOptionalPositional(input);
  if (!value) throw new DaemonClientError(usage, 2);
  return value;
}

function takeOptionalPositional(input: string[]): string | undefined {
  if (!input[0] || input[0]!.startsWith("--")) return undefined;
  return input.shift();
}

function printSyncResult(label: string, value: unknown): void {
  if (typeof value !== "object" || value === null) {
    getUi().success(label);
    return;
  }
  const record = value as Record<string, unknown>;
  const message =
    typeof record.message === "string" && record.message.trim()
      ? record.message
      : label;
  const keys = [
    "project",
    "project_slug",
    "remote",
    "branch",
    "path",
    "destination",
    "imported",
    "updated",
    "pushed",
    "fetched",
  ];
  renderResult(
    getUi(),
    message,
    keys.flatMap((key) =>
      record[key] === undefined
        ? []
        : [[key.replaceAll("_", " "), record[key]] as [string, unknown]],
    ),
  );
}
