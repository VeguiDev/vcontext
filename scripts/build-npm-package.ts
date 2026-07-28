import { readFile, mkdir } from "node:fs/promises";

const pkg = JSON.parse(await readFile("apps/cli/package.json", "utf-8"));
const version: string = pkg.version;
const outdir = "apps/cli/dist/npm";

await mkdir(outdir, { recursive: true });

const EXTERNAL = [
  "better-sqlite3", "@napi-rs/keyring", "@modelcontextprotocol/sdk",
  "@hono/node-server", "hono", "fast-glob", "slugify", "zod",
  "semver", "@clack/prompts", "boxen", "jsonc-parser", "ora", "picocolors",
];

const DEFINES = {
  VCONTEXT_VERSION_BUILD: JSON.stringify(version),
  VCONTEXT_DISTRIBUTION_BUILD: JSON.stringify("npm"),
};

// CLI bundle
const cliResult = await Bun.build({
  entrypoints: ["apps/cli/src/index.ts"],
  outdir,
  naming: "vcontext.mjs",
  target: "node",
  format: "esm",
  external: EXTERNAL,
  define: DEFINES,
});
if (!cliResult.success) { console.error("CLI build FAILED", cliResult.logs); process.exit(1); }

// Daemon bundle
const daemonResult = await Bun.build({
  entrypoints: ["apps/deamon/src/entrypoint.ts"],
  outdir,
  naming: "vcontext-daemon.mjs",
  target: "node",
  format: "esm",
  external: EXTERNAL,
  define: DEFINES,
});
if (!daemonResult.success) { console.error("Daemon build FAILED", daemonResult.logs); process.exit(1); }

console.log(`vcontext.mjs (${cliResult.outputs[0].size} bytes)`);
console.log(`vcontext-daemon.mjs (${daemonResult.outputs[0].size} bytes)`);
console.log("npm bundles OK");
