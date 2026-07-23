import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { CLI_ENTRY } from "./integration-harness.js";

test("vcontext --version reports the release base version", () => {
  const version = execFileSync(process.execPath, [CLI_ENTRY, "--version"], {
    encoding: "utf8",
  }).trim();

  assert.equal(version, "0.1.1");
});
