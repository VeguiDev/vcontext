import path from "node:path";
import { DaemonClientError } from "@repo/daemon-client";
import {
  configureMcp,
  MCP_AGENTS,
  MCP_SCOPES,
  type McpAgent,
  type McpScope,
  type McpSetupResult,
} from "../runtime/mcp-config.js";
import { getUi } from "../ui/index.js";

export interface SetupCommandOptions {
  cwd?: string;
  defaultScope?: McpScope;
  allowNonInteractiveSkip?: boolean;
}

export async function setupCommand(
  input: string[],
  options: SetupCommandOptions = {},
): Promise<McpSetupResult | null> {
  const agentValue = takeOption(input, "--agent");
  const scopeValue = takeOption(input, "--scope");
  if (input.length)
    throw new DaemonClientError(
      "Usage: vcontext setup [--agent codex|claude|opencode] [--scope local|global]",
      2,
    );

  let agent = parseAgent(agentValue);
  let scope = parseScope(scopeValue);
  const ui = getUi();

  if (!agent && ui.isTTY) {
    agent = await ui.select<McpAgent>("Which agent do you use?", [
      { value: "codex", label: "Codex" },
      { value: "claude", label: "Claude Code" },
      { value: "opencode", label: "OpenCode" },
    ]);
  }
  if (!agent && options.allowNonInteractiveSkip) {
    ui.warn(
      "MCP setup skipped because no agent was specified. Run `vcontext setup --agent <codex|claude|opencode> --scope <local|global>`.",
    );
    return null;
  }
  if (!agent)
    throw new DaemonClientError(
      "Non-interactive setup requires --agent and --scope.",
      2,
    );

  if (!scope && ui.isTTY) {
    scope = await ui.select<McpScope>("Where should VContext be configured?", [
      { value: "local", label: "This project (shared)" },
      { value: "global", label: "All projects for this user" },
    ]);
  }
  scope ??= options.defaultScope;
  if (!scope)
    throw new DaemonClientError(
      "Non-interactive setup requires --agent and --scope.",
      2,
    );

  const result = configureMcp(agent, scope, {
    cwd: path.resolve(options.cwd ?? process.cwd()),
    command: ui.commandName,
  });
  return result;
}

function parseAgent(value: string | undefined): McpAgent | undefined {
  if (value === undefined) return undefined;
  if ((MCP_AGENTS as readonly string[]).includes(value))
    return value as McpAgent;
  throw new DaemonClientError("--agent must be codex, claude, or opencode.", 2);
}

function parseScope(value: string | undefined): McpScope | undefined {
  if (value === undefined) return undefined;
  if ((MCP_SCOPES as readonly string[]).includes(value))
    return value as McpScope;
  throw new DaemonClientError("--scope must be local or global.", 2);
}

function takeOption(input: string[], name: string) {
  const index = input.indexOf(name);
  if (index < 0) return undefined;
  const value = input[index + 1];
  if (!value || value.startsWith("--"))
    throw new DaemonClientError(`Missing value for ${name}`, 2);
  input.splice(index, 2);
  return value;
}
