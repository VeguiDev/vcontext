import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { VContextSyncError } from "@vcontext/versioning-contract";
import type { ProjectService } from "../src/project/project-service.js";
import { SyncService } from "../src/sync/sync-service.js";

describe("SyncService push identity", () => {
  let workspace = "";

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "vcontext-identity-"));
    execFileSync("git", ["init"], { cwd: workspace });
    execFileSync("git", ["config", "user.name", ""], { cwd: workspace });
    execFileSync("git", ["config", "user.email", ""], { cwd: workspace });
  });

  after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("reports every missing identity field for the selected remote", async () => {
    const sync = service(null);
    const result = await sync.pushReadiness("demo", "upstream");

    assert.equal(result.ready, false);
    assert.equal(result.remote.name, "upstream");
    assert.equal(result.remote.origin, "https://cloud.example");
    assert.deepEqual(result.missing, [
      "git.user.name",
      "git.user.email",
      "vcontext.name",
      "vcontext.email",
    ]);
  });

  it("accepts effective Git config and a complete VContext identity", async () => {
    execFileSync("git", ["config", "user.name", "Git User"], {
      cwd: workspace,
    });
    execFileSync("git", ["config", "user.email", "git@example.com"], {
      cwd: workspace,
    });
    const result = await service({
      cloud_id: null,
      name: "VContext User",
      email: "user@example.com",
      updated_at: new Date().toISOString(),
    }).pushReadiness("demo");

    assert.equal(result.ready, true);
    assert.deepEqual(result.missing, []);
    assert.equal(result.git.name, "Git User");
    assert.equal(result.vcontext.email, "user@example.com");
  });

  it("blocks direct push calls before contacting the remote", async () => {
    execFileSync("git", ["config", "user.email", ""], {
      cwd: workspace,
    });
    await assert.rejects(
      service(null).push("demo", {}),
      (error) =>
        error instanceof VContextSyncError &&
        error.code === "IDENTITY_REQUIRED" &&
        error.message.includes("git.user.email"),
    );
  });

  function service(
    identity: {
      cloud_id: string | null;
      name: string;
      email: string | null;
      updated_at: string;
    } | null,
  ): SyncService {
    const remote = {
      name: "upstream",
      url: "https://cloud.example/api/v1/projects/demo",
    };
    const store = {
      remotes: {
        findByName: (name: string) =>
          name === "upstream" || name === "origin" ? remote : null,
        find: () => [remote],
      },
      close() {},
    };
    const projects = {
      open: async () => ({
        cwd: workspace,
        store,
        close() {},
      }),
      openStore: async () => store,
    } as unknown as ProjectService;
    return new SyncService(projects, {
      identityStore: { get: () => identity },
    });
  }
});
