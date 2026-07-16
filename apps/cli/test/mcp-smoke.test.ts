import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import {
  CLI_ENTRY,
  type DaemonFixture,
  startDaemonFixture,
} from "./integration-harness.js";

const TOOLS_LIST_REQUEST = `${JSON.stringify({
  jsonrpc: "2.0",
  method: "tools/list",
  id: 1,
})}\n`;

let fixture: DaemonFixture | undefined;

before(async () => {
  fixture = await startDaemonFixture();
});

after(async () => {
  await fixture?.stop();
});

describe("vcontext mcp stdio smoke test", () => {
  it("returns all 20 tools from the compiled CLI", () => {
    assert.ok(fixture);

    const stdout = execFileSync(process.execPath, [CLI_ENTRY, "mcp"], {
      env: fixture.env,
      input: TOOLS_LIST_REQUEST,
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "ignore"],
    });

    const response: unknown = JSON.parse(stdout.trim());
    assert.ok(typeof response === "object" && response !== null);
    const result = "result" in response ? response.result : undefined;
    assert.ok(typeof result === "object" && result !== null);
    const tools = "tools" in result ? result.tools : undefined;
    assert.ok(Array.isArray(tools));
    assert.equal(tools.length, 20);
  });
});
