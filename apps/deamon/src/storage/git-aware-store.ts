import type { Database } from "better-sqlite3";
import type { SnapshotMetadata } from "@vcontext/versioning-contract";

export const SYNC_JOB_OPERATIONS = ["FETCH", "PULL", "PUSH", "CREATE_REMOTE_BRANCH", "LINK_SNAPSHOT_COMMIT"] as const;
export type SyncJobOperation = (typeof SYNC_JOB_OPERATIONS)[number];
export interface SyncJob { id: number; operation: SyncJobOperation; dedupe_key: string; payload: string; attempts: number; next_retry_at: number; last_error: string | null; created_at: number; updated_at: number; }

export class GitAwareStore {
  constructor(private readonly db: Database) {}

  metadata(): SnapshotMetadata[] {
    return (this.db.prepare("SELECT * FROM snapshot_metadata ORDER BY created_at, snapshot_id").all() as Array<Record<string, unknown>>).map((value) => ({
      snapshot_id: String(value.snapshot_id),
      author: { cloud_id: value.author_cloud_id === null ? null : String(value.author_cloud_id), name: String(value.author_name), email: value.author_email === null ? null : String(value.author_email) },
      git_commit_sha: value.git_commit_sha === null ? null : String(value.git_commit_sha),
      git_branch: value.git_branch === null ? null : String(value.git_branch),
      git_dirty: value.git_dirty === 1,
      commit_message: value.commit_message === null ? null : String(value.commit_message),
      version: Number(value.version),
    }));
  }

  upsertMetadata(value: SnapshotMetadata): "inserted" | "linked" | "unchanged" {
    return this.db.transaction(() => {
      const current = this.db.prepare("SELECT * FROM snapshot_metadata WHERE snapshot_id = ?").get(value.snapshot_id) as Record<string, unknown> | undefined;
      const now = Date.now();
      if (!current) {
        this.db.prepare(`INSERT INTO snapshot_metadata (snapshot_id, author_cloud_id, author_name, author_email, git_commit_sha, git_branch, git_dirty, commit_message, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(value.snapshot_id, value.author.cloud_id, value.author.name, value.author.email, value.git_commit_sha, value.git_branch, value.git_dirty ? 1 : 0, value.commit_message, value.version, now, now);
        return "inserted" as const;
      }
      const immutableMatches = current.author_cloud_id === value.author.cloud_id && current.author_name === value.author.name && current.author_email === value.author.email && current.git_branch === value.git_branch && Number(current.git_dirty) === (value.git_dirty ? 1 : 0) && current.commit_message === value.commit_message;
      if (!immutableMatches) throw new Error(`Snapshot metadata for ${value.snapshot_id} is immutable`);
      if (current.git_commit_sha === value.git_commit_sha) return "unchanged" as const;
      if (current.git_commit_sha !== null || value.git_commit_sha === null) throw new Error(`git_commit_sha for ${value.snapshot_id} is write-once`);
      this.db.prepare("UPDATE snapshot_metadata SET git_commit_sha = ?, version = version + 1, updated_at = ? WHERE snapshot_id = ? AND git_commit_sha IS NULL")
        .run(value.git_commit_sha, now, value.snapshot_id);
      return "linked" as const;
    })();
  }

  findSnapshotByCommit(sha: string): string | null {
    const row = this.db.prepare("SELECT snapshot_id FROM snapshot_metadata WHERE git_commit_sha = ?").get(sha) as { snapshot_id: string } | undefined;
    return row?.snapshot_id ?? null;
  }
  linkSnapshotCommit(snapshotId: string, sha: string): boolean {
    return this.db.prepare("UPDATE snapshot_metadata SET git_commit_sha = ?, version = version + 1, updated_at = ? WHERE snapshot_id = ? AND git_commit_sha IS NULL").run(sha, Date.now(), snapshotId).changes === 1;
  }
  setGitState(value: { mode: "branch" | "detached"; branch_name?: string | null; detached_snapshot_id?: string | null; previous_branch?: string | null; warning?: string | null }) {
    this.db.prepare(`INSERT INTO git_state(singleton, mode, branch_name, detached_snapshot_id, previous_branch, warning, updated_at) VALUES(1, ?, ?, ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET mode=excluded.mode, branch_name=excluded.branch_name, detached_snapshot_id=excluded.detached_snapshot_id, previous_branch=excluded.previous_branch, warning=excluded.warning, updated_at=excluded.updated_at`)
      .run(value.mode, value.branch_name ?? null, value.detached_snapshot_id ?? null, value.previous_branch ?? null, value.warning ?? null, Date.now());
  }
  enqueue(operation: SyncJobOperation, dedupeKey: string, payload: unknown, now = Date.now()) {
    this.db.prepare(`INSERT INTO sync_job(operation, dedupe_key, payload, attempts, next_retry_at, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?) ON CONFLICT(dedupe_key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`).run(operation, dedupeKey, JSON.stringify(payload), now, now, now);
  }
  dueJobs(now = Date.now(), limit = 50): SyncJob[] { return this.db.prepare("SELECT * FROM sync_job WHERE next_retry_at <= ? ORDER BY next_retry_at, id LIMIT ?").all(now, limit) as SyncJob[]; }
  completeJob(id: number) { this.db.prepare("DELETE FROM sync_job WHERE id = ?").run(id); }
  failJob(id: number, error: unknown, now = Date.now()) {
    const row = this.db.prepare("SELECT attempts FROM sync_job WHERE id = ?").get(id) as { attempts: number } | undefined;
    if (!row) return;
    const attempts = row.attempts + 1;
    const base = Math.min(300_000, 2_000 * 2 ** Math.min(attempts - 1, 8));
    const jitter = Math.floor(base * 0.2 * Math.random());
    this.db.prepare("UPDATE sync_job SET attempts=?, next_retry_at=?, last_error=?, updated_at=? WHERE id=?").run(attempts, now + base + jitter, error instanceof Error ? error.message : String(error), now, id);
  }
  addConflict(kind: string, branch: string | null, preview: unknown) { this.db.prepare("INSERT INTO sync_conflict(kind, branch_name, preview, created_at) VALUES (?, ?, ?, ?)").run(kind, branch, JSON.stringify(preview), Date.now()); }
}
