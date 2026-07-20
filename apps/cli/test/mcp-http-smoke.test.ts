import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  type DaemonFixture,
  startDaemonFixture,
} from "./integration-harness.js";

const TOOLS_LIST_REQUEST = JSON.stringify({
  jsonrpc: "2.0",
  method: "tools/list",
  id: 1,
});
const PROTOCOL_VERSION = "2025-03-26";

let fixture: DaemonFixture | undefined;
let sessionId: string | undefined;

before(async () => {
  fixture = await startDaemonFixture();
  const url = `http://127.0.0.1:${fixture.port}/mcp`;
  const headers = {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${fixture.token}`,
    "content-type": "application/json",
    "mcp-protocol-version": PROTOCOL_VERSION,
  };
  const initializeResponse = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "http-smoke-test", version: "1.0.0" },
      },
      id: 0,
    }),
  });
  assert.equal(initializeResponse.status, 200);
  sessionId = initializeResponse.headers.get("mcp-session-id") ?? undefined;
  assert.ok(sessionId);

  const initializedResponse = await fetch(url, {
    method: "POST",
    headers: { ...headers, "mcp-session-id": sessionId },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });
  assert.equal(initializedResponse.status, 202);
});

after(async () => {
  await fixture?.stop();
});

describe("daemon /mcp HTTP smoke test", () => {
  it("returns all 48 tools for an authenticated request", async () => {
    assert.ok(fixture);
    assert.ok(sessionId);

    const response = await fetch(`http://127.0.0.1:${fixture.port}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${fixture.token}`,
        "content-type": "application/json",
        "mcp-protocol-version": PROTOCOL_VERSION,
        "mcp-session-id": sessionId,
      },
      body: TOOLS_LIST_REQUEST,
    });

    assert.equal(response.status, 200);
    const body: unknown = await response.json();
    assert.ok(typeof body === "object" && body !== null);
    const result = "result" in body ? body.result : undefined;
    assert.ok(typeof result === "object" && result !== null);
    const tools = "tools" in result ? result.tools : undefined;
    assert.ok(Array.isArray(tools));
    assert.equal(tools.length, 48);
  });

  it("rejects a request without the bearer token", async () => {
    assert.ok(fixture);

    const response = await fetch(`http://127.0.0.1:${fixture.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: TOOLS_LIST_REQUEST,
    });

    assert.equal(response.status, 401);
  });
});
