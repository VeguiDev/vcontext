import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("daemon startup diagnostics round-trip and clear safely", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vcontext-core-"));
  process.env.VCONTEXT_HOME = home;
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true });
    delete process.env.VCONTEXT_HOME;
  });

  const {
    DAEMON_START_ERROR_FILE,
    clearDaemonStartError,
    readDaemonStartError,
    writeDaemonStartError,
  } = await import("../dist/src/index.js");
  const failure = new Error("registry could not be opened");

  writeDaemonStartError(failure);

  const stored = readDaemonStartError();
  assert.equal(stored?.name, "Error");
  assert.equal(stored?.message, failure.message);
  assert.match(stored?.stack ?? "", /registry could not be opened/);
  assert.ok(fs.existsSync(DAEMON_START_ERROR_FILE));

  clearDaemonStartError();
  clearDaemonStartError();
  assert.equal(readDaemonStartError(), null);
});
