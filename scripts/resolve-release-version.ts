#!/usr/bin/env bun
import { appendFileSync } from "node:fs";

const BASE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

export interface ReleaseVersion {
  baseVersion: string;
  buildNumber: string;
  version: string;
  tag: string;
  prerelease: boolean;
}

export function resolveReleaseVersion(baseVersion: string, buildNumber: string): ReleaseVersion {
  if (!BASE_SEMVER.test(baseVersion)) {
    throw new Error(`CLI package version "${baseVersion}" must be semantic versioning without build metadata.`);
  }
  if (!/^(0|[1-9]\d*)$/.test(buildNumber)) {
    throw new Error(`Build number "${buildNumber}" must be a non-negative integer.`);
  }
  const version = `${baseVersion}+${buildNumber}`;
  return { baseVersion, buildNumber, version, tag: `v${version}`, prerelease: baseVersion.includes("-") };
}

if (import.meta.main) {
  const buildNumber = process.argv[2] ?? process.env.VCONTEXT_BUILD_NUMBER;
  if (!buildNumber) throw new Error("A build number is required.");
  const pkg = (await Bun.file("apps/cli/package.json").json()) as { version: string };
  const resolved = resolveReleaseVersion(pkg.version, buildNumber);
  console.log(`Resolved release ${resolved.tag}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `base-version=${resolved.baseVersion}\nbuild-number=${resolved.buildNumber}\nversion=${resolved.version}\ntag=${resolved.tag}\nprerelease=${resolved.prerelease}\n`);
  }
}