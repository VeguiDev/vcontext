<div align="center">
  <img src="./apps/landing/public/vcontext-iso.webp" alt="VContext logo" width="144" />

  <h1>VContext</h1>

  <p><strong>Durable, versioned context for AI coding agents.</strong></p>

  <p>
    Keep architecture notes, tasks, prompts, change history, and file knowledge
    available across agent sessions — locally, through a CLI or over MCP.
  </p>

  <p>
    <a href="https://github.com/VeguiDev/vcontext/actions/workflows/ci.yml"><img src="https://github.com/VeguiDev/vcontext/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
    <a href="https://github.com/VeguiDev/vcontext/releases/latest"><img src="https://img.shields.io/github/v/release/VeguiDev/vcontext?display_name=tag" alt="Latest release" /></a>
    <a href="https://vcontext.dev"><img src="https://img.shields.io/badge/website-vcontext.dev-54A0FF" alt="Website" /></a>
  </p>

  <p>
    <a href="#installation">Installation</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#connect-an-ai-agent">Agent setup</a> ·
    <a href="#development">Development</a> ·
    <a href="#contributing">Contributing</a>
  </p>
</div>

---

AI agents are good at working with the code in front of them, but their
project knowledge is usually temporary. VContext gives that knowledge a
durable home.

It runs locally, stores project data in SQLite, tracks immutable revisions,
and exposes the same context through a human-friendly CLI and a
Model Context Protocol (MCP) server.

## Why VContext?

- **Context that survives sessions** — save decisions, documentation, tasks,
  prompts, change notes, and path descriptions once.
- **Built for agents and humans** — use the interactive CLI, structured JSON,
  or one of 48 MCP tools.
- **Versioned by default** — inspect history, create branches and snapshots,
  compare changes, and merge context.
- **Local-first** — the daemon and project databases live on your machine.
- **Agent-agnostic** — configure Codex, Claude Code, or OpenCode with one
  command, or connect any MCP-compatible client.
- **Automation-friendly** — stable exit codes, `--json`, `--quiet`, `--yes`,
  and no prompts when output is redirected.

## Installation

Official releases are self-contained executables. Node.js, Bun, npm, and pnpm
are not required.

### macOS and Linux

```sh
curl -fsSL https://vcontext.dev/install.sh | bash
```

The installer chooses a writable directory on `PATH` or falls back to
`~/.local/bin`. It does not invoke `sudo` or modify shell configuration.

### Windows

Run in PowerShell:

```powershell
irm https://vcontext.dev/install.ps1 | iex
```

VContext is installed under
`%LOCALAPPDATA%\Programs\vcontext\bin` and added to the user `PATH`.

### Install a specific version

```sh
curl -fsSL https://vcontext.dev/install.sh | bash -s -- --version v1.2.3
```

PowerShell scripts executed through a pipe accept `VCONTEXT_VERSION`,
`VCONTEXT_INSTALL_DIR`, and `VCONTEXT_FORCE=1`.

### Supported platforms

| Platform | Architectures        |
| -------- | -------------------- |
| Linux    | x64, ARM64           |
| macOS    | Intel, Apple Silicon |
| Windows  | x64                  |

Every release includes a `vcontext-checksums.txt` file. Download it with the
matching artifact from [GitHub Releases](https://github.com/VeguiDev/vcontext/releases)
to verify an archive manually.

### Update

```sh
vcontext update --check
vcontext update
vcontext update --yes # non-interactive
```

The standalone CLI verifies checksums and the staged binary before replacing
the current installation. Set `VCONTEXT_NO_UPDATE_CHECK=1` to disable the
automatic daily update check.

## Quick start

Move into an existing Git repository and initialize VContext:

```sh
cd my-project
vcontext init my-project --description "My project" --path .
```

The interactive setup will:

1. register the project with the local daemon;
2. connect VContext to Codex, Claude Code, or OpenCode;
3. install reversible Git hooks when the directory is a Git repository.

Then start storing durable context:

```sh
# Render a compact context summary
vcontext give-context

# Record an architectural decision
vcontext doc add \
  --title "Architecture" \
  --content "The API uses TypeScript, Hono, and SQLite."

# Track work
vcontext task add \
  --title "Add authentication" \
  --description "Implement session-based login"

# Describe important paths
vcontext file-context upsert \
  --path src/api \
  --kind directory \
  --description "HTTP routes and request validation"

# Record a meaningful change
vcontext change add --note "Added rate limiting to public endpoints"
```

The daemon starts automatically when the CLI or MCP server needs it.

## Connect an AI agent

Run the interactive setup:

```sh
vcontext setup
```

Or configure an agent explicitly:

```sh
# Shared, project-level configuration
vcontext setup --agent codex --scope local
vcontext setup --agent claude --scope local
vcontext setup --agent opencode --scope local

# Private configuration available to every project
vcontext setup --agent codex --scope global
```

Local setup updates the agent's standard project file:

| Agent       | Project configuration |
| ----------- | --------------------- |
| Codex       | `.codex/config.toml`  |
| Claude Code | `.mcp.json`           |
| OpenCode    | `opencode.json`       |

Existing settings and JSONC comments are preserved. The selected agent must
already be installed and available on `PATH`.

For scripts, `vcontext init --agent <agent>` defaults to local scope. A
non-interactive `init` without `--agent` still registers the project and
installs Git hooks, but skips MCP setup with an actionable warning.

## Core concepts

### Durable project context

VContext stores five kinds of agent knowledge:

| Entity       | Purpose                                                       |
| ------------ | ------------------------------------------------------------- |
| Documents    | Architecture, conventions, decisions, and long-form knowledge |
| Tasks        | Work items with lifecycle status                              |
| Prompts      | Project-specific reusable instructions                        |
| Change notes | A concise record of meaningful changes                        |
| File context | Descriptions attached to files and directories                |

Every update creates an immutable revision. Public `record_id` values identify
the logical entity, while revision IDs identify a specific historical state.

### Branches, snapshots, and merges

Context evolves independently from source code while still following a
Git-like workflow:

```sh
vcontext branch create feature/auth --from main
vcontext branch checkout feature/auth
vcontext doc update <record-id> \
  --content "Authentication design…" \
  --message "Document auth flow"

vcontext log --limit 20
vcontext diff --from branch:main --to branch:feature/auth
vcontext merge preview feature/auth --target main
vcontext merge apply feature/auth --target main --strategy source
```

Use snapshots for immutable reads and branches for writes. Existing databases
are migrated automatically when opened.

### Git hooks

VContext can observe checkout, commit, merge, rewrite, and push events without
blocking Git:

```sh
vcontext git hooks install
vcontext git hooks status
vcontext git hooks repair
vcontext git hooks uninstall
```

Installation is reversible. If a repository already has a custom
`core.hooksPath`, VContext dispatches to it and restores it on uninstall.

## CLI reference

Run `vcontext --help` or `vcontext <command> --help` for the complete,
version-matched reference.

| Area           | Commands                                                               |
| -------------- | ---------------------------------------------------------------------- |
| Setup          | `setup`, `init`, `projects`, `status`, `give-context`                  |
| Context        | `doc`, `prompt`, `task`, `change`, `file-context`                      |
| Versioning     | `branch`, `snapshot`, `log`, `diff`, `merge`, `checkout`               |
| Cloud and sync | `auth`, `identity`, `remote`, `clone`, `fetch`, `pull`, `push`, `sync` |
| System         | `daemon`, `git hooks`, `migration`, `mcp`, `update`                    |

### Output and automation

Human-readable output is the default:

```sh
vcontext status
```

For scripts:

```sh
vcontext status --json
vcontext projects --quiet
vcontext update --yes
```

- `--json` writes machine-readable success output.
- `--quiet` suppresses successful output and cannot be combined with `--json`.
- Errors go to stderr; JSON errors use an `{ "error": { ... } }` envelope.
- `--yes` accepts confirmations in non-interactive environments.
- `--no-color` and `NO_COLOR` disable styling.
- `--verbose` or `VCONTEXT_DEBUG=1` enables diagnostics.

## MCP

The MCP server runs over stdio with:

```sh
vcontext mcp
```

It exposes 48 backwards-compatible tools for project discovery, context,
documents, prompts, tasks, change notes, file context, branches, snapshots,
diffs, merges, and migration inspection. Tool names are prefixed with
`vcontext_`.

Read-only MCP resources include:

- `vcontext://projects`
- `vcontext://project/{slug}/status`
- `vcontext://project/{slug}/branch/{branch}/context`
- `vcontext://project/{slug}/snapshot/{snapshotId}`
- `vcontext://project/{slug}/document/{recordId}`

Canonical MCP inputs use `project_slug`, `record_id`, and `snapshot_id`.
Reads can target a branch or snapshot; writes target branches and may include
a revision message.

## Data and migrations

The daemon stores its registry and project databases under `~/.vcontext/`.
Each project database is protected by a checksum-tracked migration gate before
normal CLI, MCP, or internal access is allowed.

```sh
vcontext migration status
vcontext migration list
vcontext migration pending
vcontext migration run --to <version>
```

Backup-required migrations retain backups inside the project's
`migration-backups/` directory. Migration inspection is available through
read-only MCP tools; agents cannot execute migrations through MCP.

## Development

### Prerequisites

- Node.js 22
- pnpm 9
- Bun 1.3.x for native release builds and standalone smoke tests

Clone and build the monorepo:

```sh
git clone https://github.com/VeguiDev/vcontext.git
cd vcontext
pnpm install
pnpm build
```

Run the development CLI:

```sh
pnpm vcontext-dev --help
```

For a global development command:

```sh
pnpm vcontext-dev:link
vcontext-dev --help
```

Development state is isolated under `~/.vcontext-dev`. Override it with
`VCONTEXT_DEV_HOME`. If daemon source changes while the development daemon is
running, stop it with `vcontext-dev daemon stop`; the next command starts the
rebuilt daemon.

### Verification

```sh
pnpm lint
pnpm check-types
pnpm test
```

### Repository layout

```text
apps/
  cli/                  CLI, MCP entrypoint, and standalone runtime
  deamon/               Local daemon and HTTP API
  landing/              vcontext.dev website
packages/
  daemon-client/        Shared daemon client
  vcontext-core/        Runtime primitives
  vcontext-mcp/         MCP schemas, tools, and API
  versioning-contract/  Shared versioning contracts
tools/
  vcontext-dev/         Incremental development launcher
```

## Contributing

Issues and pull requests are welcome.

1. Search [existing issues](https://github.com/VeguiDev/vcontext/issues)
   before opening a new one.
2. Fork the repository and create a focused branch.
3. Add or update tests for behavior changes.
4. Run `pnpm lint`, `pnpm check-types`, and `pnpm test`.
5. Open a pull request describing the problem, approach, and verification.

For large changes, open an issue first so the design can be discussed before
implementation.

## Releases

Pushes to `master` run CI and the release workflow. Published versions use the
package semantic version plus the GitHub Actions run number, for example
`0.1.1+123`, and include native artifacts for all supported platforms.

Manual release workflows build by default; publishing must be explicitly
enabled. macOS binaries remain unsigned until the optional signing and
notarization secrets are configured.

## Uninstall

Remove the installed executable:

- macOS/Linux: `~/.local/bin/vcontext` or the custom installation path.
- Windows: `%LOCALAPPDATA%\Programs\vcontext\bin\vcontext.exe`.

User data under `~/.vcontext/` is intentionally retained. Remove it separately
only if you also want to delete all local VContext projects and configuration.

---

<div align="center">
  <a href="https://vcontext.dev">Website</a> ·
  <a href="https://github.com/VeguiDev/vcontext/releases">Releases</a> ·
  <a href="https://github.com/VeguiDev/vcontext/issues">Issues</a>
</div>
