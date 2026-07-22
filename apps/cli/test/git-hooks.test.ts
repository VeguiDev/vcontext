import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { GitHooksManager } from "../src/runtime/git-hooks.js";

it("installs and uninstalls hooks reversibly without touching the previous path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vcontext-hooks-"));
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    const previous = path.join(root, "existing-hooks");
    fs.mkdirSync(previous);
    fs.writeFileSync(path.join(previous, "pre-push"), "#!/bin/sh\nexit 17\n");
    execFileSync("git", ["config", "--local", "core.hooksPath", previous], { cwd: root });
    const manager = new GitHooksManager(root);
    const installed = manager.install() as { healthy: boolean };
    assert.equal(installed.healthy, true);
    assert.equal(fs.readFileSync(path.join(previous, "pre-push"), "utf8"), "#!/bin/sh\nexit 17\n");
    assert.throws(() => {
      fs.appendFileSync(path.join(manager.hooksDir, "post-commit"), "# external\n");
      manager.repair();
    }, /refuses to overwrite/);
    // Restore the owned byte content so uninstall can prove exact hooksPath restoration.
    fs.writeFileSync(path.join(manager.hooksDir, "post-commit"), "#!/bin/sh\nexec node \"$(dirname \"$0\")/dispatcher.cjs\" post-commit \"$@\"\n", { mode: 0o755 });
    manager.uninstall();
    assert.equal(execFileSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" }).trim(), previous);
    assert.equal(fs.existsSync(path.join(previous, "pre-push")), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
