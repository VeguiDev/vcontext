import assert from "node:assert/strict";
import { it } from "node:test";
import { ReadOnlyGitService } from "../src/runtime/git.js";

it("read-only Git service rejects every mutating command before execution", () => {
  const git = new ReadOnlyGitService(process.cwd());
  for (const command of [
    "checkout",
    "merge",
    "pull",
    "push",
    "commit",
    "reset",
    "clone",
  ]) {
    assert.throws(() => git.run([command] as never), /not read-only/);
  }
  assert.throws(() => git.run(["status", "--short"] as never), /porcelain/);
  assert.throws(() => git.run(["log", "-1"] as never), /requires --format/);
});
