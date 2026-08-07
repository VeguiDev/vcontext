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

## Maintainer: First npm Publication

The npm package uses trusted publishing (provenance) for subsequent releases,
but the very first version must be published manually by an owner:

1. Build the tarball locally:
   ```bash
   pnpm install --frozen-lockfile
   cd apps/cli
   pnpm run build:npm
   npm pack
   ```

2. Publish the tarball with 2FA:
   ```bash
   npm publish vcontext-<version>.tgz --access public --otp <code>
   ```

3. After the package exists at `https://www.npmjs.com/package/vcontext`,
   configure trusted publishing in the npm package settings:
   - **Publisher**: `VeguiDev/vcontext`
   - **Workflow**: `release.yml`
   - **Environment**: (optional, for deployment protection rules)

   Once configured, CI can publish via `npm publish <tgz> --access public
   --provenance` without a token. The release workflow automatically skips
   already-published versions.
