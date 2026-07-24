#!/usr/bin/env node
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type CliResponse,
  DaemonClientError,
  ensureDaemon,
  rawRequest,
  request,
  findProjectMarker,
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
import { writeProjectMarker } from "./runtime/project-marker.js";
import { CLIVContextAPI } from "./vcontext-api.js";
import { authCommand } from "./commands/auth.js";
import { identityCommand } from "./commands/identity.js";
import { GitHooksManager } from "./runtime/git-hooks.js";
import { remoteCommand } from "./commands/remote.js";
import {
  emit,
  outputOptions as sharedOutputOptions,
  type OutputOptions,
} from "./commands/common.js";
import {
  cloneCommand,
  fetchCommand,
  pullCommand,
  pushCommand,
} from "./commands/sync.js";
import { updateCommand } from "./commands/update.js";
import { setupCommand } from "./commands/setup.js";
import { configureUi, getUi, parseGlobalOptions } from "./ui/index.js";
import { errorData } from "./ui/errors.js";
import {
  finishAutomaticUpdateCheck,
  reportPendingUpdateResult,
  startAutomaticUpdateCheck,
} from "./update/automatic.js";
import { VCONTEXT_VERSION } from "./version.js";
import {
  renderBranch,
  renderBranches,
  renderDeleted,
  renderDiff,
  renderEntity,
  renderEntityList,
  renderEntityMutation,
  renderHistory,
  renderMigration,
  renderObject,
  renderContext,
  renderPairs,
  renderProjectInit,
  renderProjects,
  renderResult,
  renderSnapshot,
  renderSnapshots,
  renderStatus,
} from "./ui/renderers.js";

/** Run the CLI without assuming how the JavaScript runtime was started. */
export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const globalOptions = parseGlobalOptions(args);
  const ui = configureUi(globalOptions);
  const command = args[0];
  await reportPendingUpdateResult(ui);
  const updateCheck = startAutomaticUpdateCheck(command, ui);

  try {
    await main(args);
    await finishAutomaticUpdateCheck(updateCheck, ui);
  } catch (error) {
    getUi().error(errorData(error));
    process.exitCode = error instanceof DaemonClientError ? error.exitCode : 1;
  }
}

if (process.env.VCONTEXT_EMBEDDED_ENTRY !== "1") {
  await runCli();
}
async function main(input: string[]) {
  const command = input.shift();
  if (getUi().options.version) return version();
  if (command === undefined || command === "-h" || command === "--help") {
    return usage(command);
  }
  if (getUi().options.help) return usage(command);
  const commands: Record<string, (args: string[]) => unknown> = {
    auth: (args) =>
      authCommand(args, {
        resolveCurrentOrigin: resolveCurrentRemoteOrigin,
      }),
    identity: (args) => identityCommand(args, resolveCurrentRemoteOrigin),
    git: gitCommand,
    sync: syncQueueCommand,
    remote: (args) => remoteCommand(args, { requestValue, resolveProjectSlug }),
    clone: (args) => cloneCommand(args, { requestValue, resolveProjectSlug }),
    fetch: (args) => fetchCommand(args, { requestValue, resolveProjectSlug }),
    pull: (args) => pullCommand(args, { requestValue, resolveProjectSlug }),
    push: (args) => pushCommand(args, { requestValue, resolveProjectSlug }),
    daemon,
    setup: setup,
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
    update: updateCommand,
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
      (value) => renderEntityList(entity, value, getUi()),
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
      (value) => renderEntity(entity, value, getUi()),
    );
  }

  if (["show", "history", "update", "delete"].includes(subcommand ?? "")) {
    const updateBody =
      subcommand === "update" ? entityInput(entity, input, true) : undefined;
    const target = await resolveRightTarget(input);
    if (subcommand === "delete")
      await confirmDestructive("Delete selected record", getUi().options.yes);
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
      (value) =>
        subcommand === "history"
          ? renderHistory(entity, value, getUi())
          : subcommand === "delete"
            ? renderDeleted(value, getUi(), entity)
            : subcommand === "update"
              ? renderEntityMutation(entity, value, getUi(), "update")
              : renderEntity(entity, value, getUi()),
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
      (value) =>
        renderEntityMutation(
          entity,
          value,
          getUi(),
          subcommand === "upsert" ? "upsert" : "create",
        ),
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
  return emit(
    await requestValue("GET", `/projects/${slug}/status`),
    output,
    (value) => renderStatus(value, getUi()),
  );
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
    (value) => renderSnapshots(value, getUi()),
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
    (value) => renderDiff(value, getUi()),
  );
}

async function branchCommand(input: string[]) {
  const subcommand = input.shift();
  const output = outputOptions(input);
  if (subcommand === "list" || subcommand === "current") {
    const slug = await resolveProjectSlug(input);
    const value = await requestValue(
      "GET",
      `/projects/${slug}/branches${subcommand === "current" ? "/current" : ""}`,
    );
    if (subcommand === "current")
      return emit(value, output, (entry) => renderBranch(entry, getUi()));
    const current = (await requestValue(
      "GET",
      `/projects/${slug}/branches/current`,
    )) as { name?: unknown };
    return emit(value, output, (entry) =>
      renderBranches(
        entry,
        getUi(),
        typeof current.name === "string" ? current.name : undefined,
      ),
    );
  }
  if (
    !["show", "create", "checkout", "rename", "delete"].includes(
      subcommand ?? "",
    )
  )
    throw new DaemonClientError(
      "Usage: vcontext branch <list|current|show|create|checkout|rename|delete>",
      2,
    );
  const newName = takeOption(input, "--new-name");
  const from = takeOption(input, "--from");
  const target = await resolveRightTarget(input);
  if (subcommand === "delete")
    await confirmDestructive("Delete branch", getUi().options.yes);
  if (subcommand === "create")
    return emit(
      await requestValue("POST", `/projects/${target.slug}/branches`, {
        name: target.value,
        from,
      }),
      output,
      (value) => renderBranch(value, getUi(), "create"),
    );
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
  return emit(response, output, (value) =>
    subcommand === "delete"
      ? renderDeleted(value, getUi(), "branch")
      : renderBranch(value, getUi(), subcommand),
  );
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
      (value) => renderSnapshots(value, getUi()),
    );
  }
  if (!["show", "diff", "checkout"].includes(subcommand ?? ""))
    throw new DaemonClientError(
      "Usage: vcontext snapshot <list|show|diff|checkout>",
      2,
    );
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
  return emit(response, output, (value) =>
    subcommand === "diff"
      ? renderDiff(value, getUi())
      : subcommand === "checkout"
        ? renderBranch(value, getUi(), "checkout")
        : renderSnapshot(value, getUi()),
  );
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
  if (subcommand === "apply")
    await confirmDestructive("Apply merge", getUi().options.yes);
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
    (value) => renderSnapshots(value, getUi()),
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
  if (marker) {
    const resolved = (await requestValue("POST", "/projects/resolve", {
      cwd: marker.root,
    })) as { slug?: unknown };
    if (typeof resolved.slug === "string") return resolved.slug;
    throw new DaemonClientError(
      "Daemon returned an invalid project resolution",
      1,
    );
  }
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
  return sharedOutputOptions(input);
}

async function requestValue(method: string, route: string, body?: unknown) {
  return parseJson(await request(method, route, body));
}

async function daemon(input: string[]) {
  const subcommand = input.shift();
  const output = outputOptions(input);
  switch (subcommand) {
    case "start":
      return daemonStart(output);
    case "status":
      return daemonStatus(output);
    case "stop":
      return daemonStop(output);
    default:
      throw new DaemonClientError("Usage: vcontext daemon <start|status|stop>");
  }
}

async function daemonStart(output: OutputOptions) {
  await ensureDaemon();
  const value = { running: true };
  emit(value, output, (_result, ui) => ui.success("Daemon running"));
}

async function daemonStatus(output: OutputOptions) {
  const pid = readPid();

  if (!pid) {
    const value = { running: false };
    emit(value, output, (_result, ui) => ui.info("Daemon is not running"));
    return;
  }

  if (!isProcessRunning(pid)) {
    removeStalePid();
    const value = { running: false, stale_pid_removed: true };
    emit(value, output, (_result, ui) => {
      ui.info("Daemon is not running");
      ui.note("Removed stale PID file");
    });
    return;
  }

  try {
    const response = await rawRequest("GET", "/daemon/status");
    const status = parseJson<{ pid: number }>(response);

    const value = { running: true, pid: status.pid, api: true };
    emit(value, output, (_result, ui) =>
      renderResult(ui, "Daemon is running", [["PID", status.pid]]),
    );
  } catch {
    const value = { running: true, pid, api: false };
    emit(value, output, (_result, ui) => {
      ui.warn(`Daemon process exists with PID ${pid}`);
      ui.note("The local API did not respond");
    });
  }
}

async function daemonStop(output: OutputOptions) {
  const pid = readPid();

  if (!pid || !isProcessRunning(pid)) {
    removeStalePid();
    const value = { running: false };
    emit(value, output, (_result, ui) => ui.info("Daemon is not running"));
    return;
  }

  try {
    await rawRequest("POST", "/daemon/stop");
    const value = { stopping: true, pid, signal: "api" };
    emit(value, output, (_result, ui) =>
      ui.success(ui.qualify("Daemon stopping", `PID ${pid}`)),
    );
    return;
  } catch {
    process.kill(pid, "SIGTERM");
    const value = { stopping: true, pid, signal: "SIGTERM" };
    emit(value, output, (_result, ui) =>
      ui.success(ui.qualify("Sent SIGTERM", `PID ${pid}`)),
    );
  }
}

async function init(input: string[]) {
  const output = outputOptions(input);
  const remoteProject = takeOption(input, "--remote");
  const cloudHost = takeOption(input, "--host") ?? "https://cloud.vcontext.dev";
  const name = collectName(input);
  const description = takeOption(input, "--description");
  const localPath = path.resolve(takeOption(input, "--path") ?? process.cwd());
  const setupInput: string[] = [];
  const agent = takeOption(input, "--agent");
  const scope = takeOption(input, "--scope");
  if (agent) setupInput.push("--agent", agent);
  if (scope) setupInput.push("--scope", scope);
  if (input.length)
    throw new DaemonClientError(
      "Usage: vcontext init <project name> [--remote namespace/slug] [--host url] [--description text] [--path path] [--agent codex|claude|opencode] [--scope local|global]",
      2,
    );

  if (!name) {
    throw new DaemonClientError(
      "Usage: vcontext init <project name> [--remote namespace/slug] [--host url] [--description text] [--path path] [--agent codex|claude|opencode] [--scope local|global]",
    );
  }

  let initialized: Record<string, unknown>;
  if (remoteProject) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(
        remoteProject,
      )
    )
      throw new DaemonClientError("--remote must be <namespace>/<slug>", 2);
    const linked = (await requestValue("POST", "/sync/link", {
      project: remoteProject,
      remote_url: new URL(`/${remoteProject}`, cloudHost).toString(),
      path: localPath,
    })) as Record<string, unknown> & { marker?: unknown };
    writeProjectMarker(
      localPath,
      linked.marker as Parameters<typeof writeProjectMarker>[1],
    );
    initialized = linked;
  } else {
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
    initialized = parseJson<Record<string, unknown>>(response);
  }

  const hooks = ensureProjectHooks(localPath);
  const mcp = await setupCommand(setupInput, {
    cwd: localPath,
    defaultScope: "local",
    allowNonInteractiveSkip: true,
  });
  const result = { ...initialized, setup: mcp, hooks };
  emit(result, output, (value, ui) => {
    renderProjectInit(value, ui, {
      path: localPath,
      ...(remoteProject ? { remote: remoteProject } : {}),
    });
    if (hooks === null)
      ui.warn(
        "Git hooks were skipped because the path is not a Git repository.",
      );
    else
      ui.success(
        hooks.healthy ? "Git hooks ready" : "Git hooks require attention",
      );
    if (mcp)
      ui.success(
        ui.qualify(`${mcp.agent} MCP ready`, `${mcp.scope} · ${mcp.path}`),
      );
  });
}

async function setup(input: string[]) {
  const output = outputOptions(input);
  const result = await setupCommand(input);
  if (!result) return;
  emit(result, output, (value, ui) =>
    renderObject(value, ui, "MCP setup complete"),
  );
}

function ensureProjectHooks(cwd: string) {
  let manager: GitHooksManager;
  try {
    manager = new GitHooksManager(cwd);
  } catch {
    return null;
  }
  const status = manager.status() as {
    installed: boolean;
    healthy: boolean;
    problems?: string[];
  };
  if (!status.installed) return manager.install() as typeof status;
  if (status.healthy) return status;
  try {
    return manager.repair() as typeof status;
  } catch (error) {
    throw new DaemonClientError(
      `Project registered, but Git hooks could not be repaired: ${error instanceof Error ? error.message : String(error)}`,
      1,
      undefined,
      {
        code: "GIT_HOOKS_UNHEALTHY",
        hint: "Inspect with `vcontext git hooks status`; if owned hook files were changed, uninstall and reinstall them explicitly.",
      },
    );
  }
}

async function gitCommand(input: string[]) {
  const action = input.shift();
  if (action === "hooks") {
    const operation = input.shift();
    const output = outputOptions(input);
    if (
      input.length ||
      !operation ||
      !["install", "status", "repair", "uninstall"].includes(operation)
    )
      throw new DaemonClientError(
        "Usage: vcontext git hooks <install|status|repair|uninstall>",
        2,
      );
    if (operation === "uninstall")
      await confirmDestructive("Uninstall Git hooks", getUi().options.yes);
    const manager = new GitHooksManager(process.cwd());
    const result =
      operation === "install"
        ? manager.install()
        : operation === "status"
          ? manager.status()
          : operation === "repair"
            ? manager.repair()
            : manager.uninstall();
    emit(result, output, (value, ui) =>
      renderObject(value, ui, `Git hooks ${operation}`),
    );
    return;
  }
  if (action === "hook-event") {
    const event = input.shift();
    if (!event) return;
    try {
      const slug = await resolveProjectSlug([]);
      const stdin = event === "pre-push" ? await readStdin() : undefined;
      await requestValue(
        "POST",
        `/projects/${encodeURIComponent(slug)}/git/events`,
        { event, args: input, cwd: process.cwd(), stdin },
      );
    } catch {
      /* VContext hooks never block Git. */
    }
    return;
  }
  throw new DaemonClientError(
    "Usage: vcontext git hooks <install|status|repair|uninstall>",
    2,
  );
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8")),
    );
    process.stdin.resume();
  });
}

async function syncQueueCommand(input: string[]) {
  const action = input.shift();
  const output = outputOptions(input);
  if (!action || !["status", "retry"].includes(action) || input.length)
    throw new DaemonClientError("Usage: vcontext sync <status|retry>", 2);
  const slug = await resolveProjectSlug([]);
  const value = await requestValue(
    action === "status" ? "GET" : "POST",
    `/projects/${encodeURIComponent(slug)}/sync/queue${action === "retry" ? "/retry" : ""}`,
  );
  emit(value, output, (result, ui) =>
    renderObject(result, ui, `Sync queue ${action}`),
  );
}

async function projectsCommand(input: string[]) {
  const output = outputOptions(input);
  if (input.length > 0) {
    throw new DaemonClientError("Usage: vcontext projects [--json|--quiet]", 2);
  }
  emit(await requestValue("GET", "/projects"), output, (value) =>
    renderProjects(value, getUi()),
  );
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
  renderContext(response.body, getUi());
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
  if (subcommand === "run")
    await confirmDestructive("Run project migrations", getUi().options.yes);
  const response =
    subcommand === "run"
      ? await request(
          "POST",
          `/projects/${slug}/migrations/run`,
          target ? { to: target } : {},
        )
      : await request("GET", `/projects/${slug}/migrations/${subcommand}`);
  return emit(parseJson<Record<string, unknown>>(response), output, (value) =>
    renderMigration(value, getUi(), subcommand!),
  );
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
    const resolved = (await requestValue("POST", "/projects/resolve", {
      cwd: marker.root,
    })) as { slug?: unknown };
    if (typeof resolved.slug === "string") return resolved.slug;
  }

  const currentProject = await resolveProjectByCurrentPath();

  if (currentProject) {
    return currentProject.slug;
  }

  throw new DaemonClientError(
    "Could not resolve project. Run inside a vcontext project or pass --project <slug>.",
  );
}

async function resolveCurrentRemoteOrigin(): Promise<string | null> {
  try {
    const slug = await resolveProjectSlug([]);
    const remote = await requestValue(
      "GET",
      `/projects/${encodeURIComponent(slug)}/remotes/origin`,
    );
    const value =
      typeof remote === "string"
        ? remote
        : remote && typeof remote === "object" && "url" in remote
          ? remote.url
          : undefined;
    return typeof value === "string" ? new URL(value).origin : null;
  } catch {
    return null;
  }
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

async function confirmDestructive(
  action: string,
  accepted: boolean,
): Promise<void> {
  if (accepted) return;
  if (!getUi().isTTY || getUi().options.json || getUi().options.quiet) {
    throw new DaemonClientError(
      `${action} requires confirmation. Re-run with --yes.`,
      10,
    );
  }
  if (!(await getUi().confirm(`${action}?`)))
    throw new DaemonClientError("Operation cancelled.", 130);
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
    getUi().errorLine("vcontext: daemon port not found");
    process.exit(1);
  }

  const endpoint = `http://127.0.0.1:${port}/mcp`;
  if (getUi().options.json) getUi().json({ endpoint });
  else
    renderResult(getUi(), "MCP server ready", [
      ["Endpoint", getUi().url(endpoint)],
      ["Stop", getUi().command(getUi().cli("daemon stop"))],
    ]);

  await new Promise(() => {});
}

function version() {
  getUi().line(VCONTEXT_VERSION);
}

function usage(command?: string) {
  const ui = getUi();
  const groups: Array<{
    title: string;
    commands: Array<[string, string]>;
  }> = [
    {
      title: "Setup",
      commands: [
        [
          "setup [--agent name] [--scope local|global]",
          "Configure the VContext MCP server",
        ],
        ["init <name> [--path path]", "Register and configure a project"],
        ["projects", "List registered projects"],
        ["status [project]", "Show project status"],
        ["give-context [project]", "Render durable agent context"],
      ],
    },
    {
      title: "Context",
      commands: [
        ["doc <list|show|add|update|delete|history>", "Manage documents"],
        ["prompt <list|show|add|update|delete|history>", "Manage prompts"],
        ["task <list|show|add|update|delete|history>", "Manage tasks"],
        ["change <list|show|add|delete|history>", "Manage change notes"],
        [
          "file-context <list|show|add|update|delete|history|upsert>",
          "Manage path context",
        ],
      ],
    },
    {
      title: "Versioning",
      commands: [
        [
          "branch <list|current|show|create|checkout|rename|delete>",
          "Manage branches",
        ],
        ["snapshot <list|show|diff|checkout>", "Inspect snapshots"],
        ["log [project] [--limit count]", "Show snapshot history"],
        ["diff [project] [--from ref] [--to ref]", "Compare snapshots"],
        ["merge <preview|apply> <source>", "Merge context branches"],
      ],
    },
    {
      title: "Cloud & sync",
      commands: [
        ["auth <login|logout|status>", "Manage Cloud authentication"],
        ["identity <show|set>", "Manage Cloud identity"],
        ["remote <add|list|get-url|set-url|remove>", "Manage remotes"],
        ["clone <url> [path]", "Clone shared context"],
        ["fetch [remote] [branch]", "Fetch remote context"],
        ["pull [remote] [branch]", "Pull and apply remote context"],
        ["push [remote] [branch]", "Push local context"],
        ["sync <status|retry>", "Inspect the sync queue"],
      ],
    },
    {
      title: "System",
      commands: [
        ["daemon <start|status|stop>", "Manage the local daemon"],
        [
          "git hooks <install|status|repair|uninstall>",
          "Manage Git integration",
        ],
        ["migration <status|list|pending|run>", "Manage data migrations"],
        ["mcp [serve]", "Run the MCP bridge or HTTP endpoint"],
        ["update [--check]", "Check for and install CLI updates"],
      ],
    },
  ];
  const visible = command
    ? groups
        .map((group) => ({
          ...group,
          commands: group.commands.filter(([syntax]) =>
            syntax.split(" ", 1)[0]!.split("|").includes(command),
          ),
        }))
        .filter((group) => group.commands.length > 0)
    : groups;
  ui.line(
    ui.rich
      ? `${ui.brand(ui.commandName)} ${ui.dim("— git for AI context")}`
      : `${ui.commandName} — git for AI context`,
  );
  ui.line();
  for (const group of visible) {
    ui.line(ui.rich ? ui.brand(group.title) : `${group.title}:`);
    const width = Math.max(...group.commands.map(([syntax]) => syntax.length));
    for (const [syntax, description] of group.commands)
      ui.line(
        `  ${ui.command(`${ui.commandName} ${syntax}`.padEnd(width + ui.commandName.length + 1))}  ${ui.dim(description)}`,
      );
    ui.line();
  }
  ui.line(ui.rich ? ui.brand("Global options") : "Global options:");
  renderPairs(ui, [
    ["--help", "Show help"],
    ["--version", "Show version"],
    ["--verbose", "Show diagnostic details"],
    ["--quiet", "Suppress successful output"],
    ["--no-color", "Disable colors"],
    ["--yes", "Accept confirmations"],
    ["--json", "Emit parseable JSON"],
  ]);
}
