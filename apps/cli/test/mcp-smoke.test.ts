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
const INITIALIZE_REQUEST = `${JSON.stringify({
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "version-smoke-test", version: "1.0.0" },
  },
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
  it("reports the current VContext version", () => {
    assert.ok(fixture);

    const stdout = execFileSync(process.execPath, [CLI_ENTRY, "mcp"], {
      env: fixture.env,
      input: INITIALIZE_REQUEST,
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "ignore"],
    });

    const response = JSON.parse(stdout.trim()) as {
      result?: { serverInfo?: { name?: string; version?: string } };
    };
    assert.deepEqual(response.result?.serverInfo, {
      name: "vcontext",
      version: "0.1.1",
    });
  });

  it("returns all 56 tools from the compiled CLI", () => {
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
    assert.equal(tools.length, 56);
  });
});
