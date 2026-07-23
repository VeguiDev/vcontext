import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  consumePendingUpdateResult,
  resolveUpdateTarget,
  verifyUpdateArchive,
  WINDOWS_EXPAND_ARCHIVE_COMMAND,
  WINDOWS_START_HELPER_COMMAND,
  windowsUpdateHelperSource,
} from "../src/update/installer.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryHome() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "vcontext-update-install-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

test("supported runtime targets map to release asset names", () => {
  assert.equal(resolveUpdateTarget("linux", "x64"), "linux-x64");
  assert.equal(resolveUpdateTarget("linux", "arm64"), "linux-arm64");
  assert.equal(resolveUpdateTarget("darwin", "x64"), "darwin-x64");
  assert.equal(resolveUpdateTarget("darwin", "arm64"), "darwin-arm64");
  assert.equal(resolveUpdateTarget("win32", "x64"), "windows-x64");
  assert.equal(resolveUpdateTarget("win32", "arm64"), null);
  assert.equal(resolveUpdateTarget("freebsd", "x64"), null);
});

test("downloaded archives require matching release checksums and digests", () => {
  const archive = Buffer.from("trusted update");
  const hash = createHash("sha256").update(archive).digest("hex");
  const checksums = Buffer.from(`${hash}  vcontext-linux-x64.tar.gz\n`);

  assert.doesNotThrow(() =>
    verifyUpdateArchive(
      archive,
      "vcontext-linux-x64.tar.gz",
      checksums,
      `sha256:${hash}`,
    ),
  );
  assert.throws(
    () =>
      verifyUpdateArchive(
        Buffer.from("tampered update"),
        "vcontext-linux-x64.tar.gz",
        checksums,
        `sha256:${hash}`,
      ),
    /Checksum verification failed/,
  );
  assert.throws(
    () =>
      verifyUpdateArchive(
        archive,
        "vcontext-linux-x64.tar.gz",
        checksums,
        `sha256:${"0".repeat(64)}`,
      ),
    /GitHub digest verification failed/,
  );
  assert.throws(
    () =>
      verifyUpdateArchive(
        archive,
        "vcontext-linux-x64.tar.gz",
        checksums,
        "md5:unsupported",
      ),
    /Unsupported GitHub digest/,
  );
});

test("Windows replacement helper waits, validates, and rolls back", () => {
  assert.match(
    WINDOWS_EXPAND_ARCHIVE_COMMAND,
    /param\(\$archive, \$destination\)/,
  );
  assert.match(WINDOWS_START_HELPER_COMMAND, /Start-Process/);
  const helper = windowsUpdateHelperSource();
  assert.match(helper, /ConvertFrom-Json/);
  assert.match(helper, /Wait-Process -Id \$ParentPid/);
  assert.match(helper, /& \$Target --version/);
  assert.match(helper, /Copy-Item -LiteralPath \$Backup -Destination \$Target/);
  assert.match(helper, /success = \$false/);
  assert.match(helper, /update-result\.json|ResultPath/);
});

test("pending Windows results accept a UTF-8 BOM and are consumed once", async () => {
  const home = await temporaryHome();
  await fs.writeFile(
    path.join(home, "update-result.json"),
    `\uFEFF${JSON.stringify({
      success: true,
      previousVersion: "0.1.1+12",
      currentVersion: "0.1.1+13",
      targetPath: "C:\\bin\\vcontext.exe",
    })}`,
    "utf8",
  );

  assert.deepEqual(await consumePendingUpdateResult(home), {
    success: true,
    previousVersion: "0.1.1+12",
    currentVersion: "0.1.1+13",
    targetPath: "C:\\bin\\vcontext.exe",
  });
  assert.equal(await consumePendingUpdateResult(home), null);
});

test("invalid pending results are discarded", async () => {
  const home = await temporaryHome();
  const resultPath = path.join(home, "update-result.json");
  await fs.writeFile(resultPath, "{not json", "utf8");
  assert.equal(await consumePendingUpdateResult(home), null);
  await assert.rejects(fs.access(resultPath));
});
