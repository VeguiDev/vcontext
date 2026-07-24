import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { DaemonClientError } from "@repo/daemon-client";

export const MCP_AGENTS = ["codex", "claude", "opencode"] as const;
export const MCP_SCOPES = ["local", "global"] as const;

export type McpAgent = (typeof MCP_AGENTS)[number];
export type McpScope = (typeof MCP_SCOPES)[number];

export interface McpSetupResult {
  agent: McpAgent;
  scope: McpScope;
  path: string;
  server: "vcontext";
  command: string;
  updated: boolean;
}

interface ConfigureMcpOptions {
  cwd?: string;
  home?: string;
  command?: string;
  checkAgent?: boolean;
}

export function configureMcp(
  agent: McpAgent,
  scope: McpScope,
  options: ConfigureMcpOptions = {},
): McpSetupResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const home = path.resolve(options.home ?? os.homedir());
  const command = options.command?.trim() || "vcontext";
  if (options.checkAgent !== false) ensureAgentInstalled(agent, cwd);

  const target = configPath(agent, scope, cwd, home);
  const previous = readOptional(target);
  const next =
    agent === "codex"
      ? updateCodexConfig(previous, command, target)
      : updateJsonConfig(previous, agent, command, target);

  if (next !== previous) atomicWrite(target, next);
  return {
    agent,
    scope,
    path: target,
    server: "vcontext",
    command,
    updated: next !== previous,
  };
}

export function configPath(
  agent: McpAgent,
  scope: McpScope,
  cwd: string,
  home: string,
) {
  if (agent === "codex")
    return scope === "local"
      ? path.join(cwd, ".codex", "config.toml")
      : path.join(home, ".codex", "config.toml");
  if (agent === "claude")
    return scope === "local"
      ? path.join(cwd, ".mcp.json")
      : path.join(home, ".claude.json");
  return scope === "local"
    ? path.join(cwd, "opencode.json")
    : path.join(home, ".config", "opencode", "opencode.json");
}

function ensureAgentInstalled(agent: McpAgent, cwd: string) {
  const result = spawnSync(agent, ["--version"], {
    cwd,
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.error && "code" in result.error && result.error.code === "ENOENT")
    throw new DaemonClientError(
      `${displayAgent(agent)} is not installed or is not available on PATH.`,
      2,
      undefined,
      {
        code: "AGENT_NOT_FOUND",
        hint: `Install ${displayAgent(agent)} and re-run \`vcontext setup --agent ${agent} --scope local\`.`,
      },
    );
}

function displayAgent(agent: McpAgent) {
  return agent === "codex"
    ? "Codex"
    : agent === "claude"
      ? "Claude Code"
      : "OpenCode";
}

function updateCodexConfig(source: string, command: string, target: string) {
  const header = "[mcp_servers.vcontext]";
  const block = `${header}\ncommand = ${tomlString(command)}\nargs = ["mcp"]\n`;
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end++;
    lines.splice(start, end - start, ...block.trimEnd().split("\n"));
    return ensureNewline(lines.join("\n"));
  }
  const parent = lines.findIndex((line) => /^\s*\[mcp_servers]\s*$/.test(line));
  let inlineVcontext = false;
  if (parent >= 0) {
    let end = parent + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end++;
    inlineVcontext = lines
      .slice(parent + 1, end)
      .some((line) => /^\s*vcontext\s*=/.test(line));
  }
  if (lines.some((line) => /^\s*mcp_servers\s*=/.test(line)) || inlineVcontext)
    throw invalidConfig(
      target,
      "inline mcp_servers entries cannot be updated safely",
    );
  const prefix = source.trimEnd();
  return `${prefix}${prefix ? "\n\n" : ""}${block}`;
}

function updateJsonConfig(
  source: string,
  agent: Exclude<McpAgent, "codex">,
  command: string,
  target: string,
) {
  const initial = source.trim() ? source : "{}\n";
  const errors: ParseError[] = [];
  const root = parse(initial, errors, { allowTrailingComma: true });
  if (errors.length || typeof root !== "object" || root === null)
    throw invalidConfig(target, "the file is not valid JSON or JSONC");
  const propertyPath =
    agent === "claude" ? ["mcpServers", "vcontext"] : ["mcp", "vcontext"];
  const value =
    agent === "claude"
      ? { type: "stdio", command, args: ["mcp"], env: {} }
      : { type: "local", command: [command, "mcp"], enabled: true };
  const edits = modify(initial, propertyPath, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  });
  return ensureNewline(applyEdits(initial, edits));
}

function invalidConfig(target: string, reason: string) {
  return new DaemonClientError(
    `Cannot update ${target}: ${reason}.`,
    2,
    undefined,
    {
      code: "INVALID_AGENT_CONFIG",
      hint: "Fix the existing configuration and run `vcontext setup` again.",
    },
  );
}

function readOptional(target: string) {
  try {
    return fs.readFileSync(target, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return "";
    throw error;
  }
}

function atomicWrite(target: string, content: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.vcontext-${process.pid}.tmp`;
  const backup = `${target}.vcontext-${process.pid}.bak`;
  let movedPrevious = false;
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      movedPrevious = true;
    }
    fs.renameSync(temporary, target);
    if (movedPrevious) fs.unlinkSync(backup);
  } catch (error) {
    if (movedPrevious && !fs.existsSync(target)) fs.renameSync(backup, target);
    throw error;
  } finally {
    for (const leftover of [temporary, backup])
      try {
        fs.unlinkSync(leftover);
      } catch {
        // Successful renames normally consume the temporary paths.
      }
  }
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

function ensureNewline(value: string) {
  return value.endsWith("\n") ? value : `${value}\n`;
}
