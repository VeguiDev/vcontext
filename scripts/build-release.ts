#!/usr/bin/env bun
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const daemonDatabaseImport = resolve("apps/deamon/src/storage/database.js");
const bunDatabaseAdapter = resolve("apps/deamon/src/storage/database.bun.ts");
const standaloneDatabasePlugin = {
  name: "standalone-database",
  setup(builder: any) {
    builder.onResolve({ filter: /database\.js$/ }, (args: any) => {
      if (resolve(args.resolveDir, args.path) === daemonDatabaseImport) {
        return { path: bunDatabaseAdapter };
      }
    });
  },
};

export const releaseTargets = {
  "linux-x64": {
    target: "bun-linux-x64-baseline",
    platform: "linux",
    arch: "x64",
  },
  "linux-arm64": {
    target: "bun-linux-arm64",
    platform: "linux",
    arch: "arm64",
  },
  "darwin-x64": { target: "bun-darwin-x64", platform: "darwin", arch: "x64" },
  "darwin-arm64": {
    target: "bun-darwin-arm64",
    platform: "darwin",
    arch: "arm64",
  },
  "windows-x64": {
    target: "bun-windows-x64-baseline",
    platform: "win32",
    arch: "x64",
  },
} as const;

export type ReleaseTarget = keyof typeof releaseTargets;

export function compileTargetFor(
  name: ReleaseTarget,
  platform: string,
  arch: string,
) {
  const spec = releaseTargets[name];
  return spec.platform === platform && spec.arch === arch
    ? undefined
    : spec.target;
}

async function main() {
  const selected = process.argv[2] as ReleaseTarget | undefined;
  if (selected && !(selected in releaseTargets))
    throw new Error(`Unknown target: ${selected}`);
  const pkg = (await Bun.file("apps/cli/package.json").json()) as {
    version: string;
  };
  const releaseVersion = process.env.VCONTEXT_RELEASE_VERSION ?? pkg.version;
  const output = resolve(process.env.VCONTEXT_RELEASE_DIR ?? "release/bin");
  if (!existsSync(output)) mkdirSync(output, { recursive: true });
  const entries = Object.entries(
    selected ? { [selected]: releaseTargets[selected] } : releaseTargets,
  );

  for (const [name, spec] of entries) {
    const extension = name === "windows-x64" ? ".exe" : "";
    const outfile = resolve(output, `vcontext-${name}${extension}`);
    if (existsSync(outfile)) rmSync(outfile);
    const target = compileTargetFor(
      name as ReleaseTarget,
      process.platform,
      process.arch,
    );
    console.log(
      `building ${name} with Bun ${Bun.version} (${target ? `cross ${target}` : `native ${process.platform}-${process.arch}`})`,
    );
    const result = await Bun.build({
      entrypoints: ["apps/cli/src/standalone.ts"],
      compile: { ...(target ? { target } : {}), outfile },
      define: { VCONTEXT_VERSION_BUILD: JSON.stringify(releaseVersion) },
      plugins: [standaloneDatabasePlugin],
      minify: false,
      sourcemap: "none",
    });
    if (!result.success)
      throw new Error(result.logs.map((log) => log.message).join("\n"));
    console.log(`built ${outfile}`);
  }
}

if (import.meta.main) await main();
