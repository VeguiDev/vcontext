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

The 22 original compatibility tools below remain available. The complete
48-tool versioned surface is summarized in the reference section below; every
tool is prefixed with `vcontext_`:

| Tool                           | Description                                                      |
| ------------------------------ | ---------------------------------------------------------------- |
| `vcontext_context`             | Get compact project context (omits instructions, truncates docs) |
| `vcontext_projects`            | List all projects                                                |
| `vcontext_migration_status`    | Inspect project schema migration state                           |
| `vcontext_migration_list`      | List applied and pending project migrations                      |
| `vcontext_tasks_list`          | List tasks                                                       |
| `vcontext_tasks_add`           | Add a task                                                       |
| `vcontext_tasks_update`        | Update a task                                                    |
| `vcontext_tasks_delete`        | Delete a task                                                    |
| `vcontext_documents_list`      | List documents                                                   |
| `vcontext_documents_get`       | Get a document by ID                                             |
| `vcontext_documents_add`       | Add a document                                                   |
| `vcontext_documents_update`    | Update a document                                                |
| `vcontext_documents_delete`    | Delete a document                                                |
| `vcontext_changes_list`        | List changes                                                     |
| `vcontext_changes_add`         | Record a change                                                  |
| `vcontext_file_context_list`   | List file context entries                                        |
| `vcontext_file_context_upsert` | Create or update file context                                    |
| `vcontext_file_context_delete` | Delete file context                                              |
| `vcontext_prompts_list`        | List prompts                                                     |
| `vcontext_prompts_add`         | Add a prompt                                                     |
| `vcontext_prompts_update`      | Update a prompt                                                  |
| `vcontext_prompts_delete`      | Delete a prompt                                                  |

## Daemon

The vcontext daemon runs in the background and stores all data in SQLite databases under `~/.vcontext/`.

```bash
vcontext daemon start
vcontext daemon status
vcontext daemon stop
```

The daemon auto-starts when needed by the CLI or MCP server.

## Local history, branches, and snapshots

Each project's SQLite database stores immutable entity revisions. An entity's
`record_id` is its stable logical ID; `id` identifies one immutable revision.
Update and delete operations therefore accept `record_id`, and references such
as `task.document_id` also contain a document `record_id`.

The daemon storage API is branch- or snapshot-scoped:

```ts
const handle = await projectService.open(project.slug);
const store = handle.store;
const main = store.branch("main");
const document = main.document.create({
  title: "Architecture",
  content: "...",
});

main.document.update(document.record_id, { content: "Revised" });
main.document.history(document.record_id);

store.snapshot(document.snapshot_id).document.find();
store.branches.create("feature/history");
store.merge.preview("feature/history", "main");
```

Existing per-project databases are migrated automatically into a single
versioned snapshot on first open. The locally selected branch is stored in the
per-project storage file `project.json`; workspace marker files under
`.vcontext/project.json` continue to identify a project by slug and UUID.

## Project migrations

Every scoped project database is opened through a shared migration gate.
Migrations are discovered from
`apps/deamon/src/project/migrations/`, validated and ordered with semantic
version rules, checksum-tracked in `schema_migrations`, and applied under a
project-scoped process lock. Normal daemon, CLI, MCP, and internal store access
is refused until all pending migrations succeed.

```bash
vcontext migration status [project-slug]
vcontext migration list [project-slug]
vcontext migration pending [project-slug]
vcontext migration run [project-slug] [--to version]
```

Each command supports `--json`. Migration status and list are also available
as read-only MCP tools; agents cannot execute migrations.

Backup-required migrations use SQLite's backup API and retain backups under the
project's `migration-backups/` directory. Critical scoped-database changes and
migration tracking commit in one SQLite transaction. A migration that also
changes the global registry database cannot be atomic across both independent
SQLite connections; global changes must therefore be idempotent and
recoverable, with the scoped database remaining authoritative.

## Versioned CLI and MCP reference

The CLI exposes project status, full CRUD/history for documents, prompts,
tasks, changes and file context, plus branches, snapshots, log, diff and
three-way merge:

```bash
vcontext status
vcontext doc add --title Architecture --content "Initial"
vcontext branch create feature --from main
vcontext branch checkout feature
vcontext doc update <record-id> --content "Feature version" --message "Revise architecture"
vcontext log --limit 20
vcontext diff --from branch:main --to branch:feature
vcontext merge preview feature --target main
vcontext merge apply feature --target main --strategy source
```

Human-readable output is the default. Scripts must pass `--json`;
`--quiet` suppresses successful stdout and is mutually exclusive
with `--json`. Public entity IDs are stable `record_id`
UUIDs; immutable revision `id` values are not accepted as record IDs.

MCP exposes exactly 48 backwards-compatible plural tools. Canonical inputs are
`project_slug`, `record_id` and
`snapshot_id`; legacy `slug`, `documentId`,
`taskId` and related fields remain accepted when they do not
contradict canonical values. Reads accept either `branch` or
`snapshot_id`. Writes accept `branch` and
`message` and reject detached snapshots.

The read-only MCP resources are:

- `vcontext://projects`
- `vcontext://project/{slug}/status`
- `vcontext://project/{slug}/branch/{branch}/context`
- `vcontext://project/{slug}/snapshot/{snapshotId}`
- `vcontext://project/{slug}/document/{recordId}`

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

## CLI output and automation

The CLI uses human-readable output by default. Use `--json` for machine-readable success output and `--quiet` to suppress successful output. Errors are written to stderr; with `--json`, errors use an `{ "error": { "code", "message", "hint" } }` envelope.

Global options include `--help`, `--version`, `--verbose`, `--quiet`, `--no-color`, `--yes`, and `--json`. Colors are automatically disabled for redirected output and whenever `NO_COLOR` is set. `VCONTEXT_DEBUG=1` is equivalent to verbose diagnostics.

Commands that require confirmation can run non-interactively with `--yes`. Without a TTY, required confirmations fail with an actionable error instead of waiting for input.

## Standalone installation

Released binaries include their runtime; Node.js, npm, pnpm, and Bun are not required.

```sh
curl -fsSL https://vcontext.dev/install.sh | bash
curl -fsSL https://vcontext.dev/install.sh | bash -s -- --version v1.2.3
```

Windows PowerShell:

```powershell
irm https://vcontext.dev/install.ps1 | iex
# Piped scripts accept VCONTEXT_VERSION, VCONTEXT_INSTALL_DIR and VCONTEXT_FORCE=1.
```

Unix installs to a writable PATH directory when possible, otherwise `~/.local/bin`; it never changes shell configuration or invokes sudo. Windows installs to `%LOCALAPPDATA%\Programs\vcontext\bin` and adds it to the user PATH. Use `--install-dir` / `-InstallDir` and `--force` / `-Force` to override those defaults.

Supported releases: Linux x64 and ARM64, macOS Intel and Apple Silicon, and Windows x64. To verify an archive manually, download its matching `vcontext-checksums.txt` from the same GitHub Release and run `sha256sum`, `shasum -a 256`, or `Get-FileHash -Algorithm SHA256`.

To update, re-run the installer. To uninstall, remove `~/.local/bin/vcontext` (or the selected Unix install path), or `%LOCALAPPDATA%\Programs\vcontext\bin\vcontext.exe`; user configuration in `~/.vcontext` is intentionally retained.

### Creating a release

Set `apps/cli/package.json` to the intended semantic version, then push a matching tag such as `v1.2.3`. The release workflow validates lint, types, tests, the tag/version match, builds all five native artifacts, writes checksums, and publishes the GitHub Release. macOS binaries are unsigned until the optional Apple signing and notarization secrets are configured, so Gatekeeper may show a warning.
