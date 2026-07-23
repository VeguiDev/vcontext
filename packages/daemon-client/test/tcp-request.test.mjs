import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("rawRequest uses the daemon TCP port and exposes sync errors", async (t) => {
  // Given: a daemon home containing the port of a loopback HTTP server.
  const daemonHome = fs.mkdtempSync(path.join(os.tmpdir(), "vcontext-client-"));
  process.env.VCONTEXT_HOME = daemonHome;

  const server = http.createServer((request, response) => {
    if (request.url === "/sync/push") {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            code: "INVALID_REQUEST",
            message: "Remote URL is invalid",
            details: {
              hint: "Run `vcontext remote set-url origin <url>`.",
              note: "The remote was not changed.",
            },
          },
        }),
      );
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
    fs.rmSync(daemonHome, { recursive: true, force: true });
    delete process.env.VCONTEXT_HOME;
  });

  const address = server.address();
  assert(address !== null && typeof address === "object");
  fs.writeFileSync(path.join(daemonHome, "vcontext.port"), `${address.port}\n`);

  // When: the client performs a raw daemon request.
  const { DaemonClientError, rawRequest } =
    await import("../dist/src/index.js");
  const response = await rawRequest("GET", "/health");

  // Then: the response came from the TCP server selected by the port file.
  assert.equal(response.status, 200);
  assert.equal(response.body, '{"status":"ok"}');
  await assert.rejects(
    () => rawRequest("POST", "/sync/push", {}),
    (error) =>
      error instanceof DaemonClientError &&
      error.exitCode === 2 &&
      error.message === "Remote URL is invalid" &&
      error.code === "INVALID_REQUEST" &&
      error.status === 400 &&
      error.hint === "Run `vcontext remote set-url origin <url>`." &&
      error.details?.note === "The remote was not changed.",
  );
});
