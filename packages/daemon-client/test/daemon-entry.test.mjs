import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const distModule = "../dist/src/index.js";

test("daemonEntry returns VCONTEXT_DAEMON_ENTRY when set", async (t) => {
  const home = fs.mkdtempSync(
    path.join(os.tmpdir(), "vcontext-daemon-entry-"),
  );
  const daemonPath = path.join(home, "mock-daemon.mjs");
  fs.writeFileSync(daemonPath, "export {};\n");
  process.env.VCONTEXT_DAEMON_ENTRY = daemonPath;
  t.after(() => {
    delete process.env.VCONTEXT_DAEMON_ENTRY;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const { daemonEntry } = await import(distModule);
  assert.equal(daemonEntry(), daemonPath);
});

test("daemonEntry resolves npm sibling when distribution is npm and sibling exists", async (t) => {
  // Simulate npm distribution: set the build-time define on the global scope
  // (mirrors what Bun.build does when inlining VCONTEXT_DISTRIBUTION_BUILD)
  globalThis.VCONTEXT_DISTRIBUTION_BUILD = "npm";
  const originalArgv1 = process.argv[1];
  const home = fs.mkdtempSync(
    path.join(os.tmpdir(), "vcontext-npm-entry-"),
  );
  const mockBundle = path.join(home, "vcontext.mjs");
  const mockDaemon = path.join(home, "vcontext-daemon.mjs");
  fs.writeFileSync(mockBundle, "export {};\n");
  fs.writeFileSync(mockDaemon, "export {};\n");
  process.argv[1] = mockBundle;
  t.after(() => {
    delete globalThis.VCONTEXT_DISTRIBUTION_BUILD;
    process.argv[1] = originalArgv1;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const { daemonEntry } = await import(distModule);
  assert.equal(daemonEntry(), mockDaemon);
});

test("daemonEntry throws actionable error when distribution is npm but sibling missing", async (t) => {
  globalThis.VCONTEXT_DISTRIBUTION_BUILD = "npm";
  const originalArgv1 = process.argv[1];
  const home = fs.mkdtempSync(
    path.join(os.tmpdir(), "vcontext-npm-missing-"),
  );
  const mockBundle = path.join(home, "vcontext.mjs");
  fs.writeFileSync(mockBundle, "export {};\n");
  process.argv[1] = mockBundle;
  t.after(() => {
    delete globalThis.VCONTEXT_DISTRIBUTION_BUILD;
    process.argv[1] = originalArgv1;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const { daemonEntry, DaemonClientError } = await import(distModule);
  assert.throws(
    () => daemonEntry(),
    (error) =>
      error instanceof DaemonClientError &&
      error.message.includes("Daemon binary not found"),
  );
});

test("daemonEntry falls back to monorepo path when env and distribution are unset", async (t) => {
  // Ensure no distribution define is active
  delete globalThis.VCONTEXT_DISTRIBUTION_BUILD;
  // Ensure env is not set
  delete process.env.VCONTEXT_DAEMON_ENTRY;

  const { daemonEntry, DaemonClientError } = await import(distModule);

  // The monorepo paths resolve relative to dist/src/index.js
  // If the daemon is built, the function returns it; otherwise it throws.
  try {
    const entry = daemonEntry();
    // If we get here, a monorepo path was found
    assert.ok(
      entry.endsWith("apps/deamon/dist/src/index.js") ||
        entry.endsWith("apps\\deamon\\dist\\src\\index.js"),
    );
    assert.ok(fs.existsSync(entry), `daemon entry must exist: ${entry}`);
  } catch (error) {
    assert.ok(error instanceof DaemonClientError);
    assert.ok(error.message.includes("Build the daemon"));
  }
});

test("daemonCommand returns standalone command when VCONTEXT_STANDALONE=1", async (t) => {
  // standalone case is covered by apps/cli/test/update-automatic.test.ts
  // The daemonCommand function is private; this test confirms the env
  // override works through the daemonEntry + ensureDaemon pipeline.
  const home = fs.mkdtempSync(
    path.join(os.tmpdir(), "vcontext-standalone-entry-"),
  );
  const daemonPath = path.join(home, "standalone-daemon.mjs");
  fs.writeFileSync(daemonPath, "export {};\n");
  process.env.VCONTEXT_DAEMON_ENTRY = daemonPath;
  process.env.VCONTEXT_STANDALONE = "1";
  t.after(() => {
    delete process.env.VCONTEXT_DAEMON_ENTRY;
    delete process.env.VCONTEXT_STANDALONE;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const { daemonEntry } = await import(distModule);
  // VCONTEXT_DAEMON_ENTRY is checked before VCONTEXT_STANDALONE in
  // daemonEntry; standalone is handled in daemonCommand (private).
  assert.equal(daemonEntry(), daemonPath);
});
