#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getSocketPath } from "./util/pipe.js";
import { gitRemoteUrl } from "./runtime/git.js";
import {
  findProjectMarker,
  writeProjectMarker,
} from "./runtime/project-marker.js";
import {
  PID_FILE,
  isProcessRunning,
  readPid,
  removeStalePid,
  runningPid,
} from "./runtime/pid.js";

interface CliResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

const args = process.argv.slice(2);

try {
  await main(args);
} catch (error) {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }

  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function main(input: string[]) {
  const command = input.shift();

  switch (command) {
    case "daemon":
      return daemon(input);
    case "init":
      return init(input);
    case "projects":
      return printJson(await request("GET", "/projects"));
    case "give-context":
      return giveContext(input);
    case "doc":
    case "document":
      return document(input);
    case "task":
      return task(input);
    case "change":
      return change(input);
    case "path-context":
    case "path":
    case "file-context":
    case "file":
      return fileContext(input);
    case "-h":
    case "--help":
    case undefined:
      return usage();
    default:
      throw new CliError(`Unknown command: ${command}`);
  }
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
      throw new CliError("Usage: vcontext daemon <start|status|stop>");
  }
}

function daemonStart() {
  const pid = runningPid();

  if (pid) {
    console.log(`vcontext daemon is already running with PID ${pid}`);
    return;
  }

  const entry = daemonEntry();
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });

  child.unref();

  console.log(`vcontext daemon starting with PID ${child.pid}`);
  console.log(`PID file: ${PID_FILE}`);
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
    const response = await request("GET", "/daemon/status");
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
    await request("POST", "/daemon/stop");
    console.log(`vcontext daemon stopping with PID ${pid}`);
    return;
  } catch {
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to vcontext daemon PID ${pid}`);
  }
}

async function init(input: string[]) {
  const name = collectName(input);
  const description = takeOption(input, "--description");
  const localPath = path.resolve(takeOption(input, "--path") ?? process.cwd());

  if (!name) {
    throw new CliError("Usage: vcontext init <project name> [--description text] [--path path]");
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

  printJson(response);
}

async function giveContext(input: string[]) {
  const slug = await resolveProjectSlug(input);
  const json = takeFlag(input, "--json");
  const response = await request("GET", `/projects/${slug}/context`, undefined, {
    accept: json ? "application/json" : "text/plain",
  });

  if (json) {
    printJson(response);
    return;
  }

  console.log(response.body);
}

async function document(input: string[]) {
  const subcommand = input.shift();
  const slug = await resolveProjectSlug(input);

  switch (subcommand) {
    case "list":
      return printJson(await request("GET", `/projects/${slug}/documents`));
    case "add": {
      const title = requiredOption(input, "--title");
      const content = requiredOption(input, "--content");

      return printJson(
        await request("POST", `/projects/${slug}/documents`, {
          title,
          content,
        }),
      );
    }
    default:
      throw new CliError("Usage: vcontext doc <list|add> [project-slug]");
  }
}

async function task(input: string[]) {
  const subcommand = input.shift();
  const slug = await resolveProjectSlug(input);

  switch (subcommand) {
    case "list":
      return printJson(await request("GET", `/projects/${slug}/tasks`));
    case "add": {
      const title = requiredOption(input, "--title");
      const description = takeOption(input, "--description");
      const status = takeOption(input, "--status");

      return printJson(
        await request("POST", `/projects/${slug}/tasks`, {
          title,
          description,
          status,
        }),
      );
    }
    default:
      throw new CliError("Usage: vcontext task <list|add> [project-slug]");
  }
}

async function change(input: string[]) {
  const subcommand = input.shift();
  const slug = await resolveProjectSlug(input);

  switch (subcommand) {
    case "list":
      return printJson(await request("GET", `/projects/${slug}/changes`));
    case "add": {
      const note = requiredOption(input, "--note");
      const documentId = takeOption(input, "--document-id");

      return printJson(
        await request("POST", `/projects/${slug}/changes`, {
          note,
          document_id: documentId ? parseCliId(documentId, "document id") : undefined,
        }),
      );
    }
    default:
      throw new CliError("Usage: vcontext change <list|add> [project-slug]");
  }
}

async function fileContext(input: string[]) {
  const subcommand = input.shift();
  const slug = await resolveProjectSlug(input);

  switch (subcommand) {
    case "list":
      return printJson(await request("GET", `/projects/${slug}/file-context`));
    case "upsert": {
      const filePath = requiredOption(input, "--path");
      const kind = takeOption(input, "--kind");
      const filename = takeOption(input, "--filename");
      const hash = takeOption(input, "--hash");
      const description = requiredOption(input, "--description");

      return printJson(
        await request("POST", `/projects/${slug}/file-context`, {
          kind,
          filename,
          path: filePath,
          hash,
          description,
        }),
      );
    }
    default:
      throw new CliError("Usage: vcontext file-context <list|upsert> [project-slug]");
  }
}

async function resolveProjectSlug(input: string[]) {
  const explicit = takeOption(input, "--project") ?? takeOption(input, "--slug");

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

  throw new CliError(
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

function request(
  method: string,
  requestPath: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Promise<CliResponse>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: getSocketPath(),
        path: requestPath,
        method,
        headers: {
          ...headers,
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload).toString(),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          const response = {
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          };

          if (response.status >= 400) {
            reject(new CliError(formatApiError(response), 1));
            return;
          }

          resolve(response);
        });
      },
    );

    req.on("error", () => {
      reject(
        new CliError(
          "Could not connect to vcontext daemon. Run `vcontext daemon start` first.",
          1,
        ),
      );
    });

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

function printJson(response: CliResponse) {
  console.log(JSON.stringify(parseJson(response), null, 2));
}

function parseJson<T = unknown>(response: CliResponse) {
  return JSON.parse(response.body) as T;
}

function formatApiError(response: CliResponse) {
  try {
    const parsed = JSON.parse(response.body) as { error?: string };
    return parsed.error
      ? `API error ${response.status}: ${parsed.error}`
      : `API error ${response.status}`;
  } catch {
    return `API error ${response.status}: ${response.body}`;
  }
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
    throw new CliError(`Missing required option ${name}`);
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

function parseCliId(value: string | undefined, label: string) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new CliError(`Invalid ${label}`);
  }

  return id;
}

function daemonEntry() {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const candidates = [
    process.env.VCONTEXT_DAEMON_ENTRY,
    path.resolve(currentDir, "..", "..", "..", "deamon", "dist", "src", "index.js"),
    path.resolve(currentDir, "..", "..", "deamon", "dist", "src", "index.js"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new CliError("Build the daemon before starting it: pnpm --filter @app/deamon build");
}

function usage() {
  console.log(`vcontext

Usage:
  vcontext daemon start
  vcontext daemon status
  vcontext daemon stop
  vcontext init <project name> [--description text] [--path path]
  vcontext projects
  vcontext give-context [project-slug] [--json]
  vcontext doc list [project-slug]
  vcontext doc add [project-slug] --title title --content content
  vcontext task list [project-slug]
  vcontext task add [project-slug] --title title [--description text] [--status BACKLOG]
  vcontext change list [project-slug]
  vcontext change add [project-slug] --note note [--document-id id]
  vcontext file-context list [project-slug]
  vcontext file-context upsert [project-slug] --path path --description text [--kind file|directory|path] [--hash hash]`);
}
