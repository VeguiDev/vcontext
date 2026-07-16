import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("rawRequest uses the daemon TCP port when the port file exists", async (t) => {
  // Given: a daemon home containing the port of a loopback HTTP server.
  const daemonHome = fs.mkdtempSync(path.join(os.tmpdir(), "vcontext-client-"));
  process.env.VCONTEXT_HOME = daemonHome;

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    fs.rmSync(daemonHome, { recursive: true, force: true });
    delete process.env.VCONTEXT_HOME;
  });

  const address = server.address();
  assert(address !== null && typeof address === "object");
  fs.writeFileSync(path.join(daemonHome, "vcontext.port"), `${address.port}\n`);

  // When: the client performs a raw daemon request.
  const { rawRequest } = await import("../dist/src/index.js");
  const response = await rawRequest("GET", "/health");

  // Then: the response came from the TCP server selected by the port file.
  assert.equal(response.status, 200);
  assert.equal(response.body, '{"status":"ok"}');
});
