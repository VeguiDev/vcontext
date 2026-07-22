import type { ProjectService } from "../project/project-service.js";
import { ReadOnlyGitService } from "./read-only-git-service.js";

export class GitObservationService {
  constructor(private readonly projects: ProjectService) {}
  async observe(slug: string, input: { event: string; cwd: string; args?: string[]; stdin?: string }) {
    const handle = await this.projects.open(slug);
    if (!handle.store) throw new Error("Project store unavailable");
    try {
      const store = handle.store;
      const git = new ReadOnlyGitService(input.cwd);
      const head = git.head();
      const branch = git.branch();
      if (input.event === "post-checkout") {
        if (branch) {
          if (!store.branches.findByName(branch)) {
            let base = store.gitAware.findSnapshotByCommit(head);
            if (!base) {
              for (const metadata of store.gitAware.metadata().reverse()) {
                if (!metadata.git_commit_sha) continue;
                try {
                  if (git.mergeBase(head, metadata.git_commit_sha) === metadata.git_commit_sha) { base = metadata.snapshot_id; break; }
                } catch { /* Commit is not present in this Git repository. */ }
              }
            }
            store.branches.create(branch, base ?? undefined);
          }
          store.branches.checkout(branch);
          store.gitAware.setGitState({ mode: "branch", branch_name: branch, previous_branch: store.current_branch });
          store.gitAware.enqueue("FETCH", `fetch:checkout:${branch}`, { branch });
          return { mode: "branch", branch, snapshot_id: store.requireBranch(branch).snapshot_id };
        }
        const exact = store.gitAware.findSnapshotByCommit(head);
        store.gitAware.setGitState({ mode: "detached", detached_snapshot_id: exact, previous_branch: store.current_branch, warning: exact ? null : "No VContext snapshot is associated with detached HEAD; writes are disabled." });
        return { mode: "detached", snapshot_id: exact, writable: false, warning: exact ? null : "No exact context for detached HEAD; keeping previous context read-only." };
      }
      if (input.event === "post-commit") {
        const snapshotId = store.requireBranchHead(store.current_branch);
        const linked = store.gitAware.linkSnapshotCommit(snapshotId, head);
        store.gitAware.enqueue("PUSH", `push:commit:${head}`, { branch: branch ?? store.current_branch, snapshot_id: snapshotId, git_commit_sha: head });
        return { linked, snapshot_id: snapshotId, git_commit_sha: head };
      }
      if (input.event === "post-merge" || input.event === "post-rewrite") {
        store.gitAware.enqueue("FETCH", `fetch:${input.event}:${head}`, { event: input.event, head });
        store.gitAware.enqueue("PULL", `pull:${input.event}:${head}`, { event: input.event, head });
        return { queued: ["FETCH", "PULL"] };
      }
      if (input.event === "pre-push") {
        const refs = (input.stdin ?? "").split(/\r?\n/).filter(Boolean);
        for (const ref of refs) store.gitAware.enqueue("PUSH", `push:ref:${ref}`, { ref });
        return { queued: refs.length };
      }
      return { ignored: true };
    } finally { handle.close(); }
  }

  async queueStatus(slug: string) {
    const store = await this.projects.openStore(slug);
    try {
      return { jobs: store.db.prepare("SELECT * FROM sync_job ORDER BY next_retry_at, id").all(), conflicts: store.db.prepare("SELECT * FROM sync_conflict WHERE resolved_at IS NULL ORDER BY id").all() };
    } finally { store.close(); }
  }
  async retry(slug: string) {
    const store = await this.projects.openStore(slug);
    try { const result = store.db.prepare("UPDATE sync_job SET next_retry_at = ?, last_error = NULL, updated_at = ?").run(Date.now(), Date.now()); return { queued: result.changes }; }
    finally { store.close(); }
  }
}
