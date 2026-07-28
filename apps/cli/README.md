# vcontext

VContext CLI — sync, branch, and manage your VContext projects.

## Installation

```bash
npm install -g vcontext
```

## Quick Start

```bash
# Authenticate with VContext Cloud
vcontext login

# Clone a project
vcontext clone botanical/notes

# Create a new branch
vcontext branch create my-feature

# Push changes
vcontext push
```

## Commands

- `login` / `logout` — Authenticate with VContext Cloud
- `clone <remote>` — Clone a project (supports `namespace/repo`, `vcontext.dev/c/ns/repo`, or any HTTPS URL)
- `branch [current|create|list|checkout]` — Manage branches
- `status` — Show current project state
- `push` / `fetch` — Sync changes
- `daemon [start|stop|status]` — Manage the background daemon
- `update` — Check for updates
- `help` — Show help

## Requirements

- **Node.js 18+** (required by the daemon runtime)

## Documentation

- [Website](https://vcontext.dev)
- [GitHub](https://github.com/VeguiDev/vcontext)
- [Issues](https://github.com/VeguiDev/vcontext/issues)

## Updates

Check for the latest version:

```bash
npm install -g vcontext@latest
```

## Installation Channels

- **npm** (`npm install -g vcontext`): Node-based CLI with automatic daemon lifecycle.
- **Standalone binary** (install.sh/install.ps1): Self-contained native executable.

Choose one installation channel and stick with it. Mixing channels may cause unexpected behavior.
