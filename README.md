# vcontext

Durable context storage for AI coding agents. Store documents, tasks, change notes, and file-path descriptions that persist across agent sessions. Works with any AI agent via CLI or MCP.

## Quick start

```bash
# Start the daemon
vcontext daemon start

# Create a project
vcontext init my-project --description "My project" --path .

# Give context to your AI agent
vcontext give-context my-project

# View as JSON (for programmatic use)
vcontext give-context my-project --json

# Manage documents
vcontext doc list my-project
vcontext doc add my-project --title "Architecture" --content "Stack: Node.js, SQLite, Hono"

# Manage tasks
vcontext task list my-project
vcontext task add my-project --title "Add auth" --description "Implement JWT login"

# Track changes
vcontext change add my-project --note "Added rate limiting"

# Describe files/directories
vcontext file-context upsert my-project --path src/ --kind directory --description "Source code"
```

## MCP (Model Context Protocol)

Use vcontext with any MCP-compatible AI agent (Claude Desktop, OpenCode, Codex, etc.).

### Setup

Build the daemon and MCP server:
```bash
pnpm install
pnpm build
```

### Claude Desktop

Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "vcontext": {
      "command": "node",
      "args": ["path/to/vcontext/apps/mcp/dist/src/index.js"]
    }
  }
}
```

### OpenCode

Add to your `.opencode/mcp.json`:
```json
{
  "servers": {
    "vcontext": {
      "command": "node",
      "args": ["path/to/vcontext/apps/mcp/dist/src/index.js"]
    }
  }
}
```

### Codex

Add to your `.codex/config.toml`:
```toml
[mcpServers.vcontext]
command = "node"
args = ["path/to/vcontext/apps/mcp/dist/src/index.js"]
```

> **Note:** The MCP server auto-starts the vcontext daemon if it's not running. For best performance, start the daemon explicitly with `vcontext daemon start` before connecting.

### Available MCP tools

All 20 tools are prefixed with `vcontext_`:

| Tool | Description |
|------|-------------|
| `vcontext_context` | Get compact project context (omits instructions, truncates docs) |
| `vcontext_projects` | List all projects |
| `vcontext_tasks_list` | List tasks |
| `vcontext_tasks_add` | Add a task |
| `vcontext_tasks_update` | Update a task |
| `vcontext_tasks_delete` | Delete a task |
| `vcontext_documents_list` | List documents |
| `vcontext_documents_get` | Get a document by ID |
| `vcontext_documents_add` | Add a document |
| `vcontext_documents_update` | Update a document |
| `vcontext_documents_delete` | Delete a document |
| `vcontext_changes_list` | List changes |
| `vcontext_changes_add` | Record a change |
| `vcontext_file_context_list` | List file context entries |
| `vcontext_file_context_upsert` | Create or update file context |
| `vcontext_file_context_delete` | Delete file context |
| `vcontext_prompts_list` | List prompts |
| `vcontext_prompts_add` | Add a prompt |
| `vcontext_prompts_update` | Update a prompt |
| `vcontext_prompts_delete` | Delete a prompt |

## Daemon

The vcontext daemon runs in the background and stores all data in SQLite databases under `~/.vcontext/`.

```bash
vcontext daemon start
vcontext daemon status
vcontext daemon stop
```

The daemon auto-starts when needed by the CLI or MCP server.

## Development

```bash
pnpm install
pnpm build
```

## Project structure

- `apps/cli/` — CLI client (`vcontext` command)
- `apps/deamon/` — Background daemon with HTTP API over Unix socket
- `apps/mcp/` — MCP server for agent integration
- `packages/daemon-client/` — Shared HTTP client used by CLI and MCP
