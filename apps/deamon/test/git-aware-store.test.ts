import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { migrateGitAwareProjectSchema } from "../src/storage/schema.js";
import { GitAwareStore } from "../src/storage/git-aware-store.js";

describe("GitAwareStore", () => {
  it("deduplicates jobs and permits only null-to-value commit association", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrateGitAwareProjectSchema(db);
    db.prepare("INSERT INTO snapshot(id,message,created_at) VALUES('s1','one',1)").run();
    const store = new GitAwareStore(db);
    const metadata = { snapshot_id: "s1", author: { cloud_id: null, name: "Ada", email: null }, git_commit_sha: null, git_branch: "main", git_dirty: false, commit_message: "one", version: 1 } as const;
    assert.equal(store.upsertMetadata(metadata), "inserted");
    assert.equal(store.upsertMetadata({ ...metadata, git_commit_sha: "a".repeat(40) }), "linked");
    assert.equal(store.upsertMetadata({ ...metadata, git_commit_sha: "a".repeat(40), version: 2 }), "unchanged");
    assert.throws(() => store.upsertMetadata({ ...metadata, git_commit_sha: "b".repeat(40), version: 2 }), /write-once/);
    store.enqueue("FETCH", "fetch:main", { branch: "main" }, 100);
    store.enqueue("FETCH", "fetch:main", { branch: "main", fresh: true }, 101);
    assert.equal(store.dueJobs(101).length, 1);
    store.failJob(store.dueJobs(101)[0]!.id, new Error("offline"), 101);
    const row = db.prepare("SELECT attempts, next_retry_at, last_error FROM sync_job").get() as { attempts: number; next_retry_at: number; last_error: string };
    assert.equal(row.attempts, 1);
    assert.ok(row.next_retry_at >= 2101 && row.next_retry_at <= 2501);
    assert.equal(row.last_error, "offline");
    db.close();
  });
});
