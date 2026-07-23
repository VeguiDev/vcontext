import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("ensureDaemon surfaces structured child startup diagnostics", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vcontext-client-start-"));
  const daemonEntry = path.join(home, "failing-daemon.mjs");
  fs.writeFileSync(
    daemonEntry,
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      "fs.writeFileSync(",
      '  path.join(process.env.VCONTEXT_HOME, "daemon-start-error.json"),',
      '  JSON.stringify({ name: "MigrationError", message: "legacy checksum rejected", stack: "MigrationError: legacy checksum rejected\\n  at daemon", timestamp: new Date().toISOString() }),',
      ");",
      "process.exit(1);",
    ].join("\n"),
  );
  process.env.VCONTEXT_HOME = home;
  process.env.VCONTEXT_DAEMON_ENTRY = daemonEntry;
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true });
    delete process.env.VCONTEXT_HOME;
    delete process.env.VCONTEXT_DAEMON_ENTRY;
  });

  const { DaemonClientError, ensureDaemon } =
    await import("../dist/src/index.js");

  await assert.rejects(
    ensureDaemon(),
    (error) =>
      error instanceof DaemonClientError &&
      error.code === "DAEMON_START_FAILED" &&
      error.message === "legacy checksum rejected" &&
      error.details?.note.includes("daemon-start-error.json") &&
      error.stack.includes("at daemon"),
  );
});
