#!/usr/bin/env node
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type CliResponse,
  DaemonClientError,
  ensureDaemon,
  rawRequest,
  request,
} from "@repo/daemon-client";
import {
  isProcessRunning,
  readPid,
  readPort,
  removeStalePid,
} from "@repo/vcontext-core";
import { buildMcp } from "@repo/vcontext-mcp";
import { acquireLease, releaseLease, startHeartbeat } from "./lease.js";
import { gitRemoteUrl } from "./runtime/git.js";
import {
  findProjectMarker,
  writeProjectMarker,
} from "./runtime/project-marker.js";
import { CLIVContextAPI } from "./vcontext-api.js";

const args = process.argv.slice(2);

try {
  await main(args);
} catch (error) {
  if (error instanceof DaemonClientError) {
    console.error(
      process.env.VCONTEXT_DEBUG === "1" && error.stack
        ? error.stack
        : error.message,
    );
    process.exit(error.exitCode);
  }

  console.error(
    error instanceof Error
      ? process.env.VCONTEXT_DEBUG === "1"
        ? error.stack
        : error.message
      : String(error),
  );
  process.exit(1);
}

async function main(input: string[]) {
  const command = input.shift();
  if (command === undefined || command === "-h" || command === "--help") {
    return usage();
  }
  const commands: Record<string, (args: string[]) => unknown> = {
    daemon,
    init,
    projects: projectsCommand,
    "give-context": giveContext,
    mcp: (args) => (args[0] === "serve" ? mcpServe() : mcpBridge()),
    doc: (args) => entityCommand("document", args),
    document: (args) => entityCommand("document", args),
    prompt: (args) => entityCommand("project_prompt", args),
    prompts: (args) => entityCommand("project_prompt", args),
    task: (args) => entityCommand("task", args),
    change: (args) => entityCommand("change_note", args),
    migration,
    migrations: migration,
    "path-context": (args) => entityCommand("file_context", args),
    path: (args) => entityCommand("file_context", args),
    "file-context": (args) => entityCommand("file_context", args),
    file: (args) => entityCommand("file_context", args),
    status: statusCommand,
    log: logCommand,
    diff: diffCommand,
    branch: branchCommand,
    snapshot: snapshotCommand,
    merge: mergeCommand,
    checkout: (args) => branchCommand(["checkout", ...args]),
  };
  const handler = commands[command];
  if (!handler) {
    throw new DaemonClientError(`Unknown command: ${command}`, 2);
  }
  return handler(input);
}

type EntityCommandType =
  | "document"
  | "project_prompt"
  | "task"
  | "change_note"
  | "file_context";

async function entityCommand(entity: EntityCommandType, input: string[]) {
  const subcommand = input.shift();
  const output = outputOptions(input);
  const reading = ["list", "show", "history", "get-by-path"].includes(
    subcommand ?? "",
  );
  const read = reading ? takeReadSelector(input) : new URLSearchParams();
  const write = reading ? new URLSearchParams() : takeWriteSelector(input);
  const route = cliEntityRoute(entity);

  if (subcommand === "list") {
    rejectWriteOnlyOptions(write);
    const slug = await resolveProjectSlug(input);
    return emit(
      await requestValue("GET", `/projects/${slug}/${route}?${read}`),
      output,
    );
  }

  if (subcommand === "get-by-path" && entity === "file_context") {
    rejectWriteOnlyOptions(write);
    const filePath = requiredOption(input, "--path");
    const slug = await resolveProjectSlug(input);
    read.set("path", filePath);
    return emit(
      await requestValue(
        "GET",
        `/projects/${slug}/file-context/by-path?${read}`,
      ),
      output,
    );
  }

  if (["show", "history", "update", "delete"].includes(subcommand ?? "")) {
    const updateBody =
      subcommand === "update" ? entityInput(entity, input, true) : undefined;
    const target = await resolveRightTarget(input);
    const suffix = subcommand === "history" ? "/history" : "";
    const method =
      subcommand === "update"
        ? "PATCH"
        : subcommand === "delete"
          ? "DELETE"
          : "GET";
    const query =
      subcommand === "show" || subcommand === "history" ? read : write;
    if (method === "GET") rejectWriteOnlyOptions(write);
    return emit(
      await requestValue(
        method,
        `/projects/${target.slug}/${route}/${encodeURIComponent(target.value)}${suffix}?${query}`,
        updateBody,
      ),
      output,
    );
  }

  if (
    subcommand === "add" ||
    (subcommand === "upsert" && entity === "file_context")
  ) {
    const body = entityInput(entity, input, false);
    const slug = await resolveProjectSlug(input);
    const suffix =
      entity === "file_context" && subcommand === "add" ? "/add" : "";
    return emit(
      await requestValue(
        "POST",
        `/projects/${slug}/${route}${suffix}?${write}`,
        body,
      ),
      output,
    );
  }

  throw new DaemonClientError(
    `Usage: vcontext ${route} <list|show|add|update|delete|history>`,
    2,
  );
}

function cliEntityRoute(entity: EntityCommandType) {
  return entity === "document"
    ? "documents"
    : entity === "project_prompt"
      ? "prompts"
      : entity === "task"
        ? "tasks"
        : entity === "change_note"
          ? "changes"
          : "file-context";
}

function entityInput(
  entity: EntityCommandType,
  input: string[],
  partial: boolean,
) {
  const body: Record<string, unknown> = {};
  const option = (name: string, key = name.slice(2).replaceAll("-", "_")) => {
    const value = takeOption(input, name);
    if (value !== undefined) body[key] = value;
  };
  if (entity === "document") {
    option("--title");
    option("--content");
    if (!partial) {
      body.title ??= requiredMissing("--title");
      body.content ??= requiredMissing("--content");
    }
  } else if (entity === "project_prompt") {
    option("--prompt");
    if (!partial) body.prompt ??= requiredMissing("--prompt");
  } else if (entity === "task") {
    option("--title");
    option("--description");
    option("--status");
    const documentId = takeOption(input, "--document-id");
    const clearDocument = takeFlag(input, "--clear-document");
    if (documentId && clearDocument) {
      throw new DaemonClientError(
        "--document-id and --clear-document are mutually exclusive",
        2,
      );
    }
    if (documentId !== undefined) body.document_id = documentId;
    if (clearDocument) body.document_id = null;
    if (!partial) body.title ??= requiredMissing("--title");
    if (
      body.status !== undefined &&
      !["BACKLOG", "RUNNING", "COMPLETED", "CANCELLED"].includes(
        String(body.status),
      )
    ) {
      throw new DaemonClientError(
        "Task status must be BACKLOG, RUNNING, COMPLETED, or CANCELLED",
        2,
      );
    }
  } else if (entity === "change_note") {
    option("--note");
    const documentId = takeOption(input, "--document-id");
    const clearDocument = takeFlag(input, "--clear-document");
    if (documentId && clearDocument) {
      throw new DaemonClientError(
        "--document-id and --clear-document are mutually exclusive",
        2,
      );
    }
    if (documentId !== undefined) body.document_id = documentId;
    if (clearDocument) body.document_id = null;
    if (!partial) body.note ??= requiredMissing("--note");
  } else {
    option("--path");
    option("--kind");
    option("--filename");
    option("--hash");
    option("--description");
    if (!partial) {
      body.path ??= requiredMissing("--path");
      body.description ??= requiredMissing("--description");
    }
  }
  if (partial && Object.keys(body).length === 0) {
    throw new DaemonClientError("At least one update field is required", 2);
  }
  return body;
}

function requiredMissing(name: string): never {
  throw new DaemonClientError(`Missing required option ${name}`, 2);
}

async function statusCommand(input: string[]) {
  const output = outputOptions(input);
  const slug = await resolveProjectSlug(input);
  return emit(await requestValue("GET", `/projects/${slug}/status`), output);
}

async function logCommand(input: string[]) {
  const output = outputOptions(input);
  const selector = takeReadSelector(input);
  const limit = takeOption(input, "--limit");
  if (limit) selector.set("limit", limit);
  const slug = await resolveProjectSlug(input);
  return emit(
    await requestValue("GET", `/projects/${slug}/log?${selector}`),
    output,
  );
}

async function diffCommand(input: string[]) {
  const output = outputOptions(input);
  const from = takeOption(input, "--from");
  const to = takeOption(input, "--to");
  const slug = await resolveProjectSlug(input);
  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  return emit(
    await requestValue("GET", `/projects/${slug}/diff?${query}`),
    output,
  );
}

async function branchCommand(input: string[]) {
  const subcommand = input.shift();
  const output = outputOptions(input);
  if (subcommand === "list" || subcommand === "current") {
    const slug = await resolveProjectSlug(input);
    return emit(
      await requestValue(
        "GET",
        `/projects/${slug}/branches${subcommand === "current" ? "/current" : ""}`,
      ),
      output,
    );
  }
  if (
    !["show", "create", "checkout", "rename", "delete"].includes(
      subcommand ?? "",
    )
  ) {
    throw new DaemonClientError(
      "Usage: vcontext branch <list|current|show|create|checkout|rename|delete>",
      2,
    );
  }
  const newName = takeOption(input, "--new-name");
  const from = takeOption(input, "--from");
  const target = await resolveRightTarget(input);
  if (subcommand === "create") {
    return emit(
      await requestValue("POST", `/projects/${target.slug}/branches`, {
        name: target.value,
        from,
      }),
      output,
    );
  }
  const route = `/projects/${target.slug}/branches/${encodeURIComponent(target.value)}`;
  const response =
    subcommand === "show"
      ? await requestValue("GET", route)
      : subcommand === "checkout"
        ? await requestValue("POST", `${route}/checkout`)
        : subcommand === "rename"
          ? await requestValue("PATCH", route, {
              name: newName ?? requiredMissing("--new-name"),
            })
          : await requestValue("DELETE", route);
  return emit(response, output);
}

async function snapshotCommand(input: string[]) {
  const subcommand = input.shift();
  const output = outputOptions(input);
  if (subcommand === "list") {
    const selector = takeReadSelector(input);
    const limit = takeOption(input, "--limit");
    if (limit) selector.set("limit", limit);
    const slug = await resolveProjectSlug(input);
    return emit(
      await requestValue("GET", `/projects/${slug}/snapshots?${selector}`),
      output,
    );
  }
  if (!["show", "diff", "checkout"].includes(subcommand ?? "")) {
    throw new DaemonClientError(
      "Usage: vcontext snapshot <list|show|diff|checkout>",
      2,
    );
  }
  const from = takeOption(input, "--from");
  const branch = takeOption(input, "--branch");
  const target = await resolveRightTarget(input);
  const route = `/projects/${target.slug}/snapshots/${encodeURIComponent(target.value)}`;
  const response =
    subcommand === "show"
      ? await requestValue("GET", route)
      : subcommand === "diff"
        ? await requestValue(
            "GET",
            `${route}/diff${from ? `?from=${encodeURIComponent(from)}` : ""}`,
          )
        : await requestValue("POST", `${route}/checkout`, {
            branch: branch ?? requiredMissing("--branch"),
          });
  return emit(response, output);
}

async function mergeCommand(input: string[]) {
  const subcommand = input.shift();
  if (!["preview", "apply"].includes(subcommand ?? "")) {
    throw new DaemonClientError("Usage: vcontext merge <preview|apply>", 2);
  }
  const output = outputOptions(input);
  const targetBranch = takeOption(input, "--target");
  const strategy = takeOption(input, "--strategy");
  const message = takeOption(input, "--message");
  const resolutionsText = takeOption(input, "--resolutions");
  const source = await resolveRightTarget(input);
  let resolutions: unknown;
  if (resolutionsText) {
    try {
      resolutions = JSON.parse(resolutionsText);
    } catch {
      throw new DaemonClientError("--resolutions must be valid JSON", 2);
    }
  }
  return emit(
    await requestValue("POST", `/projects/${source.slug}/merge/${subcommand}`, {
      source_branch: source.value,
      target_branch: targetBranch,
      strategy,
      message,
      resolutions,
    }),
    output,
  );
}

async function resolveRightTarget(input: string[]) {
  const explicit =
    takeOption(input, "--project") ?? takeOption(input, "--slug");
  const positional = input.filter((value) => !value.startsWith("--"));
  if (positional.length === 0) {
    throw new DaemonClientError("Missing record, branch, or snapshot ID", 2);
  }
  const value = positional.at(-1)!;
  const slug =
    explicit ??
    (positional.length > 1
      ? positional[0]!
      : await resolveCurrentProjectSlug());
  return { slug, value };
}

async function resolveCurrentProjectSlug() {
  const marker = findProjectMarker();
  if (marker) return marker.marker.slug;
  const project = await resolveProjectByCurrentPath();
  if (project) return project.slug;
  throw new DaemonClientError(
    "Could not resolve project. Pass --project <slug>.",
    3,
  );
}

function takeReadSelector(input: string[]) {
  const branch = takeOption(input, "--branch");
  const snapshot = takeOption(input, "--snapshot");
  if (branch && snapshot) {
    throw new DaemonClientError(
      "--branch and --snapshot are mutually exclusive",
      2,
    );
  }
  const query = new URLSearchParams();
  if (branch) query.set("branch", branch);
  if (snapshot) query.set("snapshot_id", snapshot);
  return query;
}

function takeWriteSelector(input: string[]) {
  if (input.includes("--snapshot")) {
    throw new DaemonClientError(
      "Writes cannot target --snapshot; select a branch",
      2,
    );
  }
  const branch = takeOption(input, "--branch");
  const message = takeOption(input, "--message");
  const query = new URLSearchParams();
  if (branch) query.set("branch", branch);
  if (message !== undefined) query.set("message", message);
  return query;
}

function rejectWriteOnlyOptions(query: URLSearchParams) {
  if ([...query].length > 0) {
    throw new DaemonClientError(
      "--message is only valid for write operations",
      2,
    );
  }
}

function outputOptions(input: string[]) {
  const json = takeFlag(input, "--json");
  const quiet = takeFlag(input, "--quiet");
  if (json && quiet) {
    throw new DaemonClientError("--json and --quiet are incompatible", 2);
  }
  return { json, quiet };
}

async function requestValue(method: string, route: string, body?: unknown) {
  return parseJson(await request(method, route, body));
}

function emit(value: unknown, output: { json: boolean; quiet: boolean }) {
  if (output.quiet) return;
  if (output.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  printHuman(value);
}

function printHuman(value: unknown) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      console.log("(none)");
      return;
    }
    for (const entry of value) console.log(formatHumanValue(entry));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (Array.isArray(item) || (item && typeof item === "object")) {
        console.log(`${key}: ${JSON.stringify(item)}`);
      } else {
        console.log(`${key}: ${formatTimestamp(key, item)}`);
      }
    }
    return;
  }
  console.log(String(value));
}

function formatHumanValue(value: unknown) {
  if (!value || typeof value !== "object") return String(value);
  return Object.entries(value)
    .map(([key, item]) => `${key}=${formatTimestamp(key, item)}`)
    .join("  ");
}

function formatTimestamp(key: string, value: unknown) {
  return key.endsWith("_at") && typeof value === "number"
    ? new Date(value).toISOString()
    : String(value ?? "");
}

async function daemon(input: string[]) {
  const subcommand = input.shift();

  switch (subcommand) {
    case "start":
      return daemonStart();
    case "status":
      return daemonStatus();
    case "stop":
      return daemonStop();
    default:
      throw new DaemonClientError("Usage: vcontext daemon <start|status|stop>");
  }
}

async function daemonStart() {
  await ensureDaemon();
}

async function daemonStatus() {
  const pid = readPid();

  if (!pid) {
    console.log("vcontext daemon is not running");
    return;
  }

  if (!isProcessRunning(pid)) {
    removeStalePid();
    console.log("vcontext daemon is not running");
    console.log("Removed stale PID file");
    return;
  }

  try {
    const response = await rawRequest("GET", "/daemon/status");
    const status = parseJson<{ pid: number }>(response);

    console.log(`vcontext daemon is running with PID ${status.pid}`);
  } catch {
    console.log(`vcontext daemon process exists with PID ${pid}`);
    console.log("The local API did not respond");
  }
}

async function daemonStop() {
  const pid = readPid();

  if (!pid || !isProcessRunning(pid)) {
    removeStalePid();
    console.log("vcontext daemon is not running");
    return;
  }

  try {
    await rawRequest("POST", "/daemon/stop");
    console.log(`vcontext daemon stopping with PID ${pid}`);
    return;
  } catch {
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to vcontext daemon PID ${pid}`);
  }
}

async function init(input: string[]) {
  const output = outputOptions(input);
  const name = collectName(input);
  const description = takeOption(input, "--description");
  const localPath = path.resolve(takeOption(input, "--path") ?? process.cwd());

  if (!name) {
    throw new DaemonClientError(
      "Usage: vcontext init <project name> [--description text] [--path path]",
    );
  }

  const remote = gitRemoteUrl(localPath);
  const response = await request("POST", "/projects", {
    name,
    description,
    paths: [
      {
        type: "local",
        path: localPath,
        label: "workspace",
      },
      ...(remote
        ? [
            {
              type: "remote",
              path: remote,
              label: "git:origin",
            },
          ]
        : []),
    ],
  });
  const project = parseJson<{ slug: string; uuid: string }>(response);

  writeProjectMarker(localPath, {
    slug: project.slug,
    uuid: project.uuid,
  });

  emit(project, output);
}

async function projectsCommand(input: string[]) {
  const output = outputOptions(input);
  if (input.length > 0) {
    throw new DaemonClientError("Usage: vcontext projects [--json|--quiet]", 2);
  }
  emit(await requestValue("GET", "/projects"), output);
}

async function giveContext(input: string[]) {
  const output = outputOptions(input);
  const slug = await resolveProjectSlug(input);
  const response = await request(
    "GET",
    `/projects/${slug}/context`,
    undefined,
    {
      accept: output.json ? "application/json" : "text/plain",
    },
  );

  if (output.quiet) return;
  if (output.json) return emit(parseJson(response), output);
  console.log(response.body);
}

async function migration(input: string[]) {
  const subcommand = input.shift();
  if (!["status", "list", "pending", "run"].includes(subcommand ?? "")) {
    throw new DaemonClientError(
      "Usage: vcontext migration <status|list|pending|run> [project-slug] [--to version] [--json]",
    );
  }
  const output = outputOptions(input);
  const target = takeOption(input, "--to");
  const slug = await resolveProjectSlug(input);
  const response =
    subcommand === "run"
      ? await request(
          "POST",
          `/projects/${slug}/migrations/run`,
          target ? { to: target } : {},
        )
      : await request("GET", `/projects/${slug}/migrations/${subcommand}`);
  if (output.quiet) return;
  if (output.json) return emit(parseJson(response), output);
  printMigrationResult(
    subcommand!,
    parseJson<Record<string, unknown>>(response),
  );
}

function printMigrationResult(
  command: string,
  result: Record<string, unknown>,
) {
  const status =
    command === "run" && result.status && typeof result.status === "object"
      ? (result.status as Record<string, unknown>)
      : result;
  console.log(`Project: ${String(status.project_slug ?? "")}`);
  if ("current_version" in status) {
    console.log(`Current schema: ${String(status.current_version)}`);
    console.log(`Latest schema: ${String(status.latest_version)}`);
  }
  const applied = Array.isArray(status.applied) ? status.applied : [];
  const pending = Array.isArray(status.pending) ? status.pending : [];
  if (command === "pending") {
    const entries = Array.isArray(result.pending) ? result.pending : [];
    console.log(`Pending migrations: ${entries.length}`);
    for (const entry of entries as Array<Record<string, unknown>>) {
      console.log(`- ${String(entry.version)} ${String(entry.name)}`);
    }
    return;
  }
  if (command === "list") {
    const entries = Array.isArray(result.migrations) ? result.migrations : [];
    for (const entry of entries as Array<Record<string, unknown>>) {
      console.log(
        `- [${String(entry.state)}] ${String(entry.version)} ${String(entry.name)}`,
      );
    }
    return;
  }
  console.log(`Applied migrations: ${applied.length}`);
  console.log(`Pending migrations: ${pending.length}`);
  console.log(`Checksum state: ${String(status.checksum_state ?? "valid")}`);
  const incomplete = Array.isArray(status.incomplete_post_migrations)
    ? status.incomplete_post_migrations
    : [];
  console.log(`Incomplete post-migrations: ${incomplete.length}`);
  const backups = Array.isArray(status.backup_paths) ? status.backup_paths : [];
  for (const backup of backups) console.log(`Backup: ${String(backup)}`);
}

async function resolveProjectSlug(input: string[]) {
  const explicit =
    takeOption(input, "--project") ?? takeOption(input, "--slug");

  if (explicit) {
    return explicit;
  }

  if (input[0] && !input[0]!.startsWith("--")) {
    return input.shift()!;
  }

  const marker = findProjectMarker();

  if (marker) {
    return marker.marker.slug;
  }

  const currentProject = await resolveProjectByCurrentPath();

  if (currentProject) {
    return currentProject.slug;
  }

  throw new DaemonClientError(
    "Could not resolve project. Run inside a vcontext project or pass --project <slug>.",
  );
}

async function resolveProjectByCurrentPath() {
  let current = process.cwd();

  while (true) {
    try {
      const response = await request(
        "GET",
        `/projects/by-path?type=local&path=${encodeURIComponent(current)}`,
      );

      return parseJson<{ slug: string }>(response);
    } catch {
      // Keep walking parents until a registered path matches.
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

function parseJson<T = unknown>(response: CliResponse) {
  return JSON.parse(response.body) as T;
}

function collectName(input: string[]) {
  const parts: string[] = [];

  while (input.length > 0 && !input[0]!.startsWith("--")) {
    parts.push(input.shift()!);
  }

  return parts.join(" ").trim();
}

function takeOption(input: string[], name: string) {
  const index = input.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const value = input[index + 1];
  input.splice(index, 2);

  return value;
}

function requiredOption(input: string[], name: string) {
  const value = takeOption(input, name);

  if (!value) {
    throw new DaemonClientError(`Missing required option ${name}`);
  }

  return value;
}

function takeFlag(input: string[], name: string) {
  const index = input.indexOf(name);

  if (index === -1) {
    return false;
  }

  input.splice(index, 1);
  return true;
}

async function mcpBridge() {
  await ensureDaemon();
  const leaseId = await acquireLease();
  const heartbeat = startHeartbeat(leaseId);

  const cleanup = async () => {
    clearInterval(heartbeat);
    await releaseLease(leaseId);
  };

  process.once("SIGINT", () => {
    cleanup().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    cleanup().then(() => process.exit(0));
  });

  const api = new CLIVContextAPI();
  await serveStdio(() => buildMcp(api));

  await cleanup();
  process.exit(0);
}

async function serveStdio(createServer: () => ReturnType<typeof buildMcp>) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => process.stdin.once("end", resolve));
  await server.close();
}

async function mcpServe() {
  await ensureDaemon();
  const leaseId = await acquireLease();
  const heartbeat = startHeartbeat(leaseId);

  const cleanup = async () => {
    clearInterval(heartbeat);
    await releaseLease(leaseId);
  };

  process.once("SIGINT", () => {
    cleanup().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    cleanup().then(() => process.exit(0));
  });

  const port = readPort();
  if (!port) {
    console.error("vcontext: daemon port not found");
    process.exit(1);
  }

  console.log(`MCP endpoint: http://127.0.0.1:${port}/mcp`);
  console.log("Stop with: vcontext daemon stop");

  await new Promise(() => {});
}

function usage() {
  console.log(`vcontext

Usage:
  vcontext daemon <start|status|stop>
  vcontext init <project name> [--description text] [--path path]
  vcontext projects
  vcontext status [project-slug] [--json|--quiet]
  vcontext doc <list|show|add|update|delete|history>
  vcontext prompt <list|show|add|update|delete|history>
  vcontext task <list|show|add|update|delete|history>
  vcontext change <list|show|add|update|delete|history>
  vcontext file-context <list|show|add|update|delete|history|get-by-path|upsert>
  vcontext branch <list|current|show|create|checkout|rename|delete>
  vcontext snapshot <list|show|diff|checkout>
  vcontext log [project-slug] [--branch name|--snapshot id] [--limit 50]
  vcontext diff [project-slug] [--from ref] [--to ref]
  vcontext merge <preview|apply> [project-slug] <source-branch> [--target branch]
  vcontext migration <status|list|pending|run>
  vcontext give-context [project-slug] [--json]
  vcontext mcp [serve]

Flow:
  init → create/update → branch → log/diff → merge

Common selectors:
  reads:  --branch name | --snapshot snapshot-id
  writes: --branch name [--message text]
  output: --json | --quiet`);
}
