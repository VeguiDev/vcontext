#!/usr/bin/env bun
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const targets = {
  "linux-x64": "bun-linux-x64-baseline",
  "linux-arm64": "bun-linux-arm64",
  "darwin-x64": "bun-darwin-x64",
  "darwin-arm64": "bun-darwin-arm64",
  "windows-x64": "bun-windows-x64-baseline",
} as const;

const selected = process.argv[2] as keyof typeof targets | undefined;
if (selected && !(selected in targets)) throw new Error(`Unknown target: ${selected}`);
const pkg = await Bun.file("apps/cli/package.json").json() as { version: string };
const releaseVersion = process.env.VCONTEXT_RELEASE_VERSION ?? pkg.version;
const output = resolve(process.env.VCONTEXT_RELEASE_DIR ?? "release/bin");
if (!existsSync(output)) mkdirSync(output, { recursive: true });

for (const [name, target] of Object.entries(selected ? { [selected]: targets[selected] } : targets)) {
  const extension = name === "windows-x64" ? ".exe" : "";
  const outfile = resolve(output, `vcontext-${name}${extension}`);
  if (existsSync(outfile)) rmSync(outfile);
  const result = await Bun.build({
    entrypoints: ["apps/cli/src/standalone.ts"],
    compile: { target, outfile },
    define: { VCONTEXT_VERSION_BUILD: JSON.stringify(releaseVersion) },
    minify: false,
    sourcemap: "none",
  });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join("\n"));
  console.log(`built ${outfile}`);
}