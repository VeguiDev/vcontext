import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { describe, it } from "node:test";
import { DaemonClientError } from "@repo/daemon-client";
import {
  authCommand,
  createPkcePair,
  type AuthorizationInput,
} from "../src/commands/auth.js";
import { remoteCommand } from "../src/commands/remote.js";
import {
  cloneCommand,
  fetchCommand,
  pushCommand,
} from "../src/commands/sync.js";
import type {
  CredentialStore,
  StoredCredential,
} from "../src/auth/credentials.js";

class MemoryCredentials implements CredentialStore {
  value: StoredCredential | null = null;
  writes = 0;

  async get(): Promise<StoredCredential | null> {
    return this.value;
  }

  async set(_origin: string, credential: StoredCredential): Promise<void> {
    this.value = credential;
    this.writes += 1;
  }

  async delete(): Promise<void> {
    this.value = null;
  }
}

describe("OAuth CLI", () => {
  it("creates an RFC 7636 S256 PKCE pair", () => {
    const pair = createPkcePair();
    assert.match(pair.verifier, /^[A-Za-z0-9_-]{43,128}$/);
    assert.equal(
      pair.challenge,
      crypto.createHash("sha256").update(pair.verifier).digest("base64url"),
    );
  });

  it("discovers endpoints, exchanges the code, and stores only in the injected keyring", async () => {
    const credentials = new MemoryCredentials();
    let authorization: AuthorizationInput | undefined;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/.well-known/vcontext")) {
        return Response.json({
          service: "vcontext",
          api_endpoint: "https://cloud.example/api/v1",
          authorization_endpoint: "https://account.example/authorize",
          token_endpoint: "https://cloud.example/oauth/token",
          revocation_endpoint: "https://cloud.example/oauth/revoke",
          supported_sync_versions: [1],
        });
      }
      return Response.json({
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token_expires_in: 2_592_000,
      });
    }) as typeof fetch;

    await authCommand(["login", "--host", "https://cloud.example", "--quiet"], {
      credentials,
      fetch: fakeFetch,
      now: () => Date.parse("2026-01-01T00:00:00.000Z"),
      resolveCurrentOrigin: async () => null,
      authorizer: {
        authorize: async (input) => {
          authorization = input;
          return {
            code: "authorization-code",
            redirectUri: "http://127.0.0.1:32123/callback",
          };
        },
      },
    });

    assert.ok(authorization);
    assert.equal(credentials.value?.access_token, "access-secret");
    assert.equal(credentials.value?.origin, "https://cloud.example");
    assert.equal(
      requests.every((item) => item.init?.redirect === "manual"),
      true,
    );
    const tokenBody = requests[1]?.init?.body;
    assert.ok(tokenBody instanceof URLSearchParams);
    const verifier = tokenBody.get("code_verifier")!;
    assert.equal(
      crypto.createHash("sha256").update(verifier).digest("base64url"),
      authorization.codeChallenge,
    );
  });

  it("refuses OAuth redirects and does not persist credentials", async () => {
    const credentials = new MemoryCredentials();
    const fakeFetch = (async (url: string | URL | Request) => {
      if (String(url).endsWith("/.well-known/vcontext")) {
        return Response.json({
          service: "vcontext",
          api_endpoint: "https://cloud.example/api/v1",
          authorization_endpoint: "https://cloud.example/authorize",
          token_endpoint: "https://cloud.example/oauth/token",
          revocation_endpoint: "https://cloud.example/oauth/revoke",
          supported_sync_versions: [1],
        });
      }
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/token" },
      });
    }) as typeof fetch;

    await assert.rejects(
      authCommand(["login", "--host", "cloud.example", "--quiet"], {
        credentials,
        fetch: fakeFetch,
        resolveCurrentOrigin: async () => null,
        authorizer: {
          authorize: async () => ({
            code: "code",
            redirectUri: "http://127.0.0.1/callback",
          }),
        },
      }),
      /Refused redirect/,
    );
    assert.equal(credentials.value, null);
  });

  it("rotates an expired access and refresh token during status", async () => {
    const credentials = new MemoryCredentials();
    credentials.value = credential({
      expires_at: "2025-12-31T23:00:00.000Z",
      refresh_expires_at: "2026-01-20T00:00:00.000Z",
    });
    const fakeFetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      assert.equal(init?.redirect, "manual");
      return Response.json({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token_expires_in: 2_592_000,
      });
    }) as typeof fetch;

    await authCommand(["status", "--host", "cloud.example", "--quiet"], {
      credentials,
      fetch: fakeFetch,
      now: () => Date.parse("2026-01-01T00:00:00.000Z"),
      resolveCurrentOrigin: async () => null,
    });

    assert.equal(credentials.value?.access_token, "rotated-access");
    assert.equal(credentials.value?.refresh_token, "rotated-refresh");
    assert.equal(credentials.writes, 1);
  });
});

describe("remote and sync commands", () => {
  it("derives an absolute clone destination when path is omitted", async () => {
    const cwd = path.resolve("test-fixtures", "clone-parent");
    let request:
      | { method: string; requestPath: string; body?: unknown }
      | undefined;

    await cloneCommand(
      ["http://localhost:4000/api/v1/repos/veguidev/vcontext", "--quiet"],
      {
        cwd,
        resolveProjectSlug: async () => "unused",
        requestValue: async (method, requestPath, body) => {
          request = { method, requestPath, body };
          return {};
        },
      },
    );

    assert.deepEqual(request, {
      method: "POST",
      requestPath: "/sync/clone",
      body: {
        remote_url: "http://localhost:4000/api/v1/repos/veguidev/vcontext",
        path: path.join(cwd, "vcontext"),
        yes: false,
      },
    });
  });

  it("maps remote add to the daemon CRUD route", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    await remoteCommand(
      ["add", "upstream", "https://cloud.example/acme/demo", "--quiet"],
      {
        resolveProjectSlug: async () => "demo project",
        requestValue: async (method, path, body) => {
          requests.push({ method, path, body });
          return body;
        },
      },
    );
    assert.deepEqual(requests, [
      {
        method: "POST",
        path: "/projects/demo%20project/remotes",
        body: { name: "upstream", url: "https://cloud.example/acme/demo" },
      },
    ]);
  });

  it("returns REMOTE_MOVED without mutation in non-TTY mode", async () => {
    let calls = 0;
    await assert.rejects(
      fetchCommand(["origin", "--json"], {
        isTTY: false,
        resolveProjectSlug: async () => "demo",
        requestValue: async () => {
          calls += 1;
          return {
            code: "REMOTE_MOVED",
            location: "https://cloud.example/new/demo",
          };
        },
      }),
      (error) =>
        error instanceof DaemonClientError &&
        error.exitCode === 10 &&
        JSON.parse(error.message).code === "REMOTE_MOVED",
    );
    assert.equal(calls, 1);
  });

  it("retries once with confirmation and lets the daemon update the remote", async () => {
    const bodies: unknown[] = [];
    await pushCommand(["origin", "main"], {
      isTTY: true,
      confirmRemoteMove: async () => true,
      resolveProjectSlug: async () => "demo",
      requestValue: async (_method, _path, body) => {
        bodies.push(body);
        return bodies.length === 1
          ? { code: "REMOTE_MOVED", location: "https://cloud.example/new/demo" }
          : { updated: true };
      },
    });
    assert.deepEqual(bodies, [
      { remote: "origin", branch: "main", force: false, yes: false },
      { remote: "origin", branch: "main", force: false, yes: true },
    ]);
  });

  it("accepts named sync options before positional arguments", async () => {
    let received: unknown;
    await fetchCommand(
      ["--branch", "main", "origin", "--project", "demo", "--quiet"],
      {
        resolveProjectSlug: async (selector) => {
          assert.deepEqual(selector, ["--project", "demo"]);
          return "demo";
        },
        requestValue: async (_method, _path, body) => {
          received = body;
          return {};
        },
      },
    );
    assert.deepEqual(received, {
      remote: "origin",
      branch: "main",
      force: undefined,
      yes: false,
    });
  });
});

function credential(update: Partial<StoredCredential> = {}): StoredCredential {
  return {
    version: 1,
    origin: "https://cloud.example",
    api_origin: "https://cloud.example",
    authorization_endpoint: "https://cloud.example/authorize",
    token_endpoint: "https://cloud.example/oauth/token",
    revocation_endpoint: "https://cloud.example/oauth/revoke",
    access_token: "old-access",
    refresh_token: "old-refresh",
    token_type: "Bearer",
    expires_at: "2026-01-01T01:00:00.000Z",
    refresh_expires_at: "2026-01-30T00:00:00.000Z",
    ...update,
  };
}
