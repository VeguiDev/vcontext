import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VContextSyncError } from "@vcontext/versioning-contract";
import { RemoteRepositoryClient } from "../src/sync/remote-client.js";

const credentials = {
  async get() {
    return null;
  },
  async set() {},
};

describe("RemoteRepositoryClient", () => {
  it("normalizes canonical, repository API, and full sync URLs", () => {
    const urls = [
      "http://localhost:4000/veguidev/vcontext",
      "http://localhost:4000/api/v1/repos/veguidev/vcontext",
      "http://localhost:4000/api/v1/repos/veguidev/vcontext/",
      "http://localhost:4000/api/v1/repos/veguidev/vcontext/sync/v1",
      "http://localhost:4000/api/v1/repos/veguidev/vcontext/sync/v1/",
    ];

    for (const url of urls) {
      assert.equal(
        new RemoteRepositoryClient(url, { credentials }).endpoint,
        "http://localhost:4000/api/v1/repos/veguidev/vcontext/sync/v1",
      );
    }
  });

  it("requests refs from a repository API clone URL", async () => {
    let requestedUrl = "";
    const client = new RemoteRepositoryClient(
      "http://localhost:4000/api/v1/repos/veguidev/vcontext",
      {
        credentials,
        fetch: async (input) => {
          requestedUrl = input.toString();
          return Response.json({
            protocol_version: 1,
            project_id: "00000000-0000-4000-8000-000000000001",
            refs: [],
          });
        },
      },
    );

    await client.refs();
    assert.equal(
      requestedUrl,
      "http://localhost:4000/api/v1/repos/veguidev/vcontext/sync/v1",
    );
  });

  it("returns a stable contract error for unsupported remote URLs", () => {
    assert.throws(
      () =>
        new RemoteRepositoryClient("http://localhost:4000/too/many/path", {
          credentials,
        }),
      (error: unknown) =>
        error instanceof VContextSyncError && error.code === "INVALID_REQUEST",
    );
  });

  it("returns a stable retryable error when the remote is unavailable", async () => {
    const client = new RemoteRepositoryClient(
      "http://localhost:4000/api/v1/repos/veguidev/vcontext",
      {
        credentials,
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      },
    );

    await assert.rejects(
      () => client.refs(),
      (error: unknown) =>
        error instanceof VContextSyncError &&
        error.code === "INTERNAL_ERROR" &&
        error.retryable &&
        error.message === "Could not connect to remote http://localhost:4000",
    );
  });
});
