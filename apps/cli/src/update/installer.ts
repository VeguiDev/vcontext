import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { VCONTEXT_HOME } from "@repo/vcontext-core";
import type { ReleaseAsset, ReleaseInfo } from "./checker.js";
import { normalizeReleaseVersion } from "./version.js";

const execFileAsync = promisify(execFile);
export const WINDOWS_EXPAND_ARCHIVE_COMMAND =
  "& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }";
export const WINDOWS_START_HELPER_COMMAND =
  "& { param($helper, $job) $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('\"' + $helper + '\"'), ('\"' + $job + '\"')); Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden }";

export type UpdateTarget =
  | "linux-x64"
  | "linux-arm64"
  | "darwin-x64"
  | "darwin-arm64"
  | "windows-x64";

export interface InstallUpdateOptions {
  release: ReleaseInfo;
  currentVersion: string;
  targetPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  home?: string;
  fetch?: typeof fetch;
  beforeReplace?: () => Promise<void>;
}

export interface InstallUpdateResult {
  updated: boolean;
  scheduled: boolean;
  previousVersion: string;
  currentVersion: string;
  targetPath: string;
}

export interface PendingUpdateResult {
  success: boolean;
  previousVersion: string;
  currentVersion: string;
  targetPath: string;
  error?: string;
}

export function resolveUpdateTarget(
  platform: NodeJS.Platform,
  arch: string,
): UpdateTarget | null {
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "win32" && arch === "x64") return "windows-x64";
  return null;
}

export async function installUpdate(
  options: InstallUpdateOptions,
): Promise<InstallUpdateResult> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = resolveUpdateTarget(platform, arch);
  if (!target)
    throw new Error(`Unsupported update platform: ${platform} ${arch}`);
  const targetPath = path.resolve(options.targetPath ?? process.execPath);
  const home = options.home ?? VCONTEXT_HOME;
  const archiveName =
    target === "windows-x64"
      ? `vcontext-${target}.zip`
      : `vcontext-${target}.tar.gz`;
  const archiveAsset = requiredAsset(options.release, archiveName);
  const checksumAsset = requiredAsset(
    options.release,
    "vcontext-checksums.txt",
  );
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "vcontext-update-"),
  );
  let candidatePath: string | undefined;
  try {
    const [archive, checksumFile] = await Promise.all([
      download(archiveAsset, options.fetch ?? fetch),
      download(checksumAsset, options.fetch ?? fetch),
    ]);
    verifyUpdateArchive(
      archive,
      archiveName,
      checksumFile,
      archiveAsset.digest,
    );

    const archivePath = path.join(temporary, archiveName);
    const extractPath = path.join(temporary, "extract");
    await fs.mkdir(extractPath);
    await fs.writeFile(archivePath, archive);
    await extractArchive(platform, archivePath, extractPath);
    const extractedPath = path.join(
      extractPath,
      platform === "win32" ? "vcontext.exe" : "vcontext",
    );
    await fs.access(extractedPath);

    const suffix = `${process.pid}-${randomUUID()}`;
    const targetExtension = path.extname(targetPath);
    const targetBasename = path.basename(targetPath, targetExtension);
    candidatePath = path.join(
      path.dirname(targetPath),
      `.${targetBasename}.update-${suffix}${targetExtension}`,
    );
    await fs.copyFile(extractedPath, candidatePath);
    if (platform !== "win32") {
      const currentMode = (await fs.stat(targetPath)).mode & 0o777;
      await fs.chmod(candidatePath, currentMode || 0o755);
    }
    await assertExecutableVersion(candidatePath, options.release.version);
    await options.beforeReplace?.();

    if (platform === "win32") {
      await scheduleWindowsReplacement({
        targetPath,
        candidatePath,
        previousVersion: options.currentVersion,
        currentVersion: options.release.version,
        home,
      });
      candidatePath = undefined;
      return {
        updated: false,
        scheduled: true,
        previousVersion: options.currentVersion,
        currentVersion: options.release.version,
        targetPath,
      };
    }

    await replaceUnixExecutable(
      targetPath,
      candidatePath,
      options.release.version,
    );
    candidatePath = undefined;
    return {
      updated: true,
      scheduled: false,
      previousVersion: options.currentVersion,
      currentVersion: options.release.version,
      targetPath,
    };
  } finally {
    if (candidatePath) await fs.unlink(candidatePath).catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

export async function consumePendingUpdateResult(
  home = VCONTEXT_HOME,
): Promise<PendingUpdateResult | null> {
  const resultPath = path.join(home, "update-result.json");
  try {
    const serialized = (await fs.readFile(resultPath, "utf8")).replace(
      /^\uFEFF/,
      "",
    );
    await fs.unlink(resultPath).catch(() => {});
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== "object" ||
      value === null ||
      !("success" in value) ||
      typeof value.success !== "boolean" ||
      !("previousVersion" in value) ||
      typeof value.previousVersion !== "string" ||
      !("currentVersion" in value) ||
      typeof value.currentVersion !== "string" ||
      !("targetPath" in value) ||
      typeof value.targetPath !== "string"
    )
      return null;
    return {
      success: value.success,
      previousVersion: value.previousVersion,
      currentVersion: value.currentVersion,
      targetPath: value.targetPath,
      ...("error" in value && typeof value.error === "string"
        ? { error: value.error }
        : {}),
    };
  } catch {
    await fs.unlink(resultPath).catch(() => {});
    return null;
  }
}

export function windowsUpdateHelperSource(): string {
  return String.raw`param(
  [string]$JobPath
)
$ErrorActionPreference = 'Stop'
$job = Get-Content -LiteralPath $JobPath -Raw | ConvertFrom-Json
$ParentPid = [int]$job.parentPid
$Target = [string]$job.target
$Candidate = [string]$job.candidate
$Backup = [string]$job.backup
$ExpectedVersion = [string]$job.expectedVersion
$PreviousVersion = [string]$job.previousVersion
$ResultPath = [string]$job.resultPath
$result = $null
try {
  Wait-Process -Id $ParentPid -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $Target -Destination $Backup -Force
  Remove-Item -LiteralPath $Target -Force
  Move-Item -LiteralPath $Candidate -Destination $Target -Force
  $actual = (& $Target --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $actual -ne $ExpectedVersion) {
    throw "updated executable reported '$actual' instead of '$ExpectedVersion'"
  }
  Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue
  $result = @{
    success = $true
    previousVersion = $PreviousVersion
    currentVersion = $ExpectedVersion
    targetPath = $Target
  }
} catch {
  if (Test-Path -LiteralPath $Backup) {
    Copy-Item -LiteralPath $Backup -Destination $Target -Force
  }
  $result = @{
    success = $false
    previousVersion = $PreviousVersion
    currentVersion = $ExpectedVersion
    targetPath = $Target
    error = $_.Exception.Message
  }
} finally {
  $result | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultPath -Encoding UTF8
  Remove-Item -LiteralPath $Candidate -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $JobPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
}`;
}

async function download(asset: ReleaseAsset, fetcher: typeof fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetcher(asset.url, {
      headers: { "user-agent": "vcontext-updater" },
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `Could not download ${asset.name}: HTTP ${response.status}.`,
      );
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function requiredAsset(release: ReleaseInfo, name: string): ReleaseAsset {
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset) throw new Error(`Release ${release.tag} is missing ${name}.`);
  return asset;
}

export function verifyUpdateArchive(
  archive: Buffer,
  archiveName: string,
  checksumFile: Buffer,
  digest: string | undefined,
): void {
  const actual = createHash("sha256").update(archive).digest("hex");
  const expected = checksumFile
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/))
    .find((match) => match?.[2] === archiveName)?.[1]
    ?.toLowerCase();
  if (!expected) throw new Error(`Checksum entry missing for ${archiveName}.`);
  if (actual !== expected)
    throw new Error(`Checksum verification failed for ${archiveName}.`);
  if (digest) {
    const githubDigest = digest.match(/^sha256:([a-fA-F0-9]{64})$/)?.[1];
    if (!githubDigest)
      throw new Error(`Unsupported GitHub digest for ${archiveName}.`);
    if (githubDigest.toLowerCase() !== actual)
      throw new Error(`GitHub digest verification failed for ${archiveName}.`);
  }
}

async function extractArchive(
  platform: NodeJS.Platform,
  archivePath: string,
  extractPath: string,
): Promise<void> {
  if (platform === "win32") {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        WINDOWS_EXPAND_ARCHIVE_COMMAND,
        archivePath,
        extractPath,
      ],
      { windowsHide: true },
    );
    return;
  }
  await execFileAsync("tar", [
    "-xzf",
    archivePath,
    "-C",
    extractPath,
    "vcontext",
  ]);
}

async function assertExecutableVersion(
  executable: string,
  expectedVersion: string,
): Promise<void> {
  const { stdout } = await execFileAsync(executable, ["--version"], {
    timeout: 15_000,
    windowsHide: true,
  });
  const actual = normalizeReleaseVersion(stdout.trim());
  if (actual !== normalizeReleaseVersion(expectedVersion))
    throw new Error(
      `Staged executable reported ${stdout.trim() || "no version"} instead of ${expectedVersion}.`,
    );
}

async function replaceUnixExecutable(
  targetPath: string,
  candidatePath: string,
  expectedVersion: string,
): Promise<void> {
  const backupPath = `${targetPath}.backup-${process.pid}-${randomUUID()}`;
  await fs.copyFile(targetPath, backupPath);
  try {
    await fs.rename(candidatePath, targetPath);
    await assertExecutableVersion(targetPath, expectedVersion);
    await fs.unlink(backupPath);
  } catch (error) {
    await fs.rename(backupPath, targetPath).catch(async () => {
      await fs.copyFile(backupPath, targetPath);
      await fs.unlink(backupPath).catch(() => {});
    });
    throw error;
  }
}

async function scheduleWindowsReplacement(input: {
  targetPath: string;
  candidatePath: string;
  previousVersion: string;
  currentVersion: string;
  home: string;
}): Promise<void> {
  await fs.mkdir(input.home, { recursive: true });
  const helperPath = path.join(
    input.home,
    `update-helper-${process.pid}-${randomUUID()}.ps1`,
  );
  const backupPath = `${input.targetPath}.backup-${process.pid}-${randomUUID()}`;
  const resultPath = path.join(input.home, "update-result.json");
  const jobPath = path.join(
    input.home,
    `update-job-${process.pid}-${randomUUID()}.json`,
  );
  await fs.unlink(resultPath).catch(() => {});
  await fs.writeFile(helperPath, windowsUpdateHelperSource(), "utf8");
  await fs.writeFile(
    jobPath,
    JSON.stringify({
      parentPid: process.pid,
      target: input.targetPath,
      candidate: input.candidatePath,
      backup: backupPath,
      expectedVersion: input.currentVersion,
      previousVersion: input.previousVersion,
      resultPath,
    }),
    "utf8",
  );
  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        WINDOWS_START_HELPER_COMMAND,
        helperPath,
        jobPath,
      ],
      { windowsHide: true },
    );
  } catch (error) {
    await Promise.all([
      fs.unlink(helperPath).catch(() => {}),
      fs.unlink(jobPath).catch(() => {}),
    ]);
    throw error;
  }
}
