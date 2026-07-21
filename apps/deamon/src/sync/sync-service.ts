import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  SYNC_LIMITS,
  SYNC_PROTOCOL_VERSION,
  VContextSyncError,
  jsonByteLength,
  type RefUpdate,
  type SyncObject,
} from "@vcontext/versioning-contract";
import type { ProjectService } from "../project/project-service.js";
import { migrateSyncProjectSchema } from "../storage/schema.js";
import { PROJECTS_ROOT, projectRoot } from "../storage/paths.js";
import { SyncObjectStore } from "./sync-object-store.js";
import { RemoteRepositoryClient, type RemoteClientOptions } from "./remote-client.js";

export interface SyncServiceOptions extends RemoteClientOptions {
  clientId?: string;
}

export class SyncService {
  private readonly clientId: string;
  constructor(private readonly projects: ProjectService, private readonly options: SyncServiceOptions = {}) {
    this.clientId = options.clientId ?? randomUUID();
  }

  async remotes(slug: string) { return this.withStore(slug, (store) => store.remotes.find()); }
  async remote(slug: string, name: string) { return this.withStore(slug, (store) => store.remotes.findByName(name) ?? (() => { throw new Error(`Remote "${name}" does not exist`); })()); }
  async addRemote(slug: string, name: string, url: string) { return this.withStore(slug, (store) => store.remotes.add(name, url)); }
  async setRemoteUrl(slug: string, name: string, url: string) { return this.withStore(slug, (store) => store.remotes.setUrl(name, url)); }
  async removeRemote(slug: string, name: string) { return this.withStore(slug, (store) => ({ deleted: store.remotes.remove(name) })); }
  async acceptRemoteMove(slug: string, remoteName: string | undefined, url: string) {
    return this.withStore(slug, (store) => {
      const remote = selectRemote(store, remoteName);
      return store.remotes.setUrl(remote.name, url);
    });
  }

  async fetch(slug: string, remoteName?: string) {
    return this.withStore(slug, async (store) => {
      const remote = selectRemote(store, remoteName);
      const client = new RemoteRepositoryClient(remote.url, this.options);
      const refsEnvelope = await client.refs();
      const objectStore = new SyncObjectStore(store);
      let continuation: string | undefined;
      let pinnedRefs = refsEnvelope.refs;
      let imported = 0;
      let existing = 0;
      do {
        const response = await client.fetch({
          protocol_version: SYNC_PROTOCOL_VERSION,
          project_id: refsEnvelope.project_id,
          have: objectStore.descriptors(refsEnvelope.project_id),
          ...(continuation ? { continuation } : {}),
        });
        const result = objectStore.import(refsEnvelope.project_id, response.objects);
        imported += result.imported;
        existing += result.existing;
        pinnedRefs = response.refs;
        continuation = response.continuation ?? undefined;
      } while (continuation);
      const refs = store.remotes.replaceRefs(remote.name, pinnedRefs.map((ref) => ({ name: ref.name, snapshot_id: ref.snapshot_id })));
      return { remote: remote.name, project_id: refsEnvelope.project_id, imported, existing, refs };
    });
  }

  async pull(slug: string, input: { remote?: string; branch?: string }) {
    await this.fetch(slug, input.remote);
    return this.withStore(slug, (store) => {
      const branchName = input.branch ?? store.current_branch;
      const local = store.requireBranch(branchName);
      const remote = selectRemote(store, input.remote);
      const upstream = store.remotes.upstream(branchName);
      const remoteBranch = upstream?.remote_branch ?? branchName;
      const remoteRef = store.remotes.refs(remote.name).find((ref) => ref.name === remoteBranch);
      if (!remoteRef) throw syncError("REF_NOT_FOUND", `Remote branch ${remote.name}/${remoteBranch} does not exist`);
      if (remoteRef.snapshot_id === null) return { status: "up-to-date", branch: local };
      if (local.snapshot_id === remoteRef.snapshot_id) return { status: "up-to-date", branch: local };
      if (local.snapshot_id === null || isAncestor(store.db, local.snapshot_id, remoteRef.snapshot_id)) {
        store.moveBranch(branchName, local.snapshot_id, remoteRef.snapshot_id, Date.now());
        store.remotes.setUpstream(branchName, remote.name, remoteBranch);
        return { status: "fast-forward", branch: store.requireBranch(branchName) };
      }
      if (isAncestor(store.db, remoteRef.snapshot_id, local.snapshot_id)) return { status: "local-ahead", branch: local };
      const result = store.merge.apply(`${remote.name}/${remoteBranch}`, branchName);
      store.remotes.setUpstream(branchName, remote.name, remoteBranch);
      return { status: "merged", ...result };
    });
  }

  async push(slug: string, input: { remote?: string; branch?: string; force?: boolean }) {
    return this.withStore(slug, async (store) => {
      const branchName = input.branch ?? store.current_branch;
      const branch = store.requireBranch(branchName);
      const remote = selectRemote(store, input.remote);
      const client = new RemoteRepositoryClient(remote.url, this.options);
      const refs = await client.refs();
      const remoteBranch = store.remotes.upstream(branchName)?.remote_branch ?? branchName;
      const oldHead = refs.refs.find((ref) => ref.name === remoteBranch)?.snapshot_id ?? null;
      const objectStore = new SyncObjectStore(store);
      const objects = objectStore.exportAll(refs.project_id);
      const missing: SyncObject[] = [];
      for (const descriptors of batches(objects.map(({ object_type, id, hash }) => ({ object_type, id, hash })), SYNC_LIMITS.missing.max_descriptors, SYNC_LIMITS.missing.max_bytes)) {
        const response = await client.missing({ protocol_version: SYNC_PROTOCOL_VERSION, project_id: refs.project_id, objects: descriptors });
        const keys = new Set(response.missing.map((item) => `${item.object_type}:${item.id}:${item.hash}`));
        missing.push(...objects.filter((item) => keys.has(`${item.object_type}:${item.id}:${item.hash}`)));
      }
      let stored = 0;
      for (const chunk of batches(missing, SYNC_LIMITS.push.max_objects, SYNC_LIMITS.push.max_bytes)) {
        const response = await client.push({ protocol_version: SYNC_PROTOCOL_VERSION, project_id: refs.project_id, request_id: randomUUID(), client_id: this.clientId, objects: chunk, ref_updates: [] });
        stored += response.stored_objects;
      }
      const update: RefUpdate = { name: remoteBranch, old_snapshot_id: oldHead, new_snapshot_id: branch.snapshot_id, force: input.force ?? false };
      const result = await client.push({ protocol_version: SYNC_PROTOCOL_VERSION, project_id: refs.project_id, request_id: randomUUID(), client_id: this.clientId, objects: [], ref_updates: [update] });
      const updated = new Map(refs.refs.map((ref) => [ref.name, ref.snapshot_id]));
      result.refs.forEach((ref) => updated.set(ref.name, ref.new_snapshot_id));
      store.remotes.replaceRefs(remote.name, [...updated].map(([name, snapshot_id]) => ({ name, snapshot_id })));
      store.remotes.setUpstream(branchName, remote.name, remoteBranch);
      return { ...result, stored_objects: stored + result.stored_objects, remote: remote.name };
    });
  }

  async clone(remoteUrl: string, targetPath: string) {
    const target = path.resolve(targetPath);
    if (fs.existsSync(target)) throw new Error(`Clone target already exists: ${target}`);
    const client = new RemoteRepositoryClient(remoteUrl, this.options);
    const refs = await client.refs();
    const parsed = new URL(remoteUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const baseSlug = parts.at(-1) ?? "project";
    let slug = baseSlug; let suffix = 2;
    while (this.projects.registry.findBySlug(slug) || fs.existsSync(projectRoot(slug))) slug = `${baseSlug}-${suffix++}`;
    const stageId = `.clone-${randomUUID()}`;
    const dbStage = path.join(PROJECTS_ROOT, stageId);
    const workStage = `${target}.${stageId}`;
    const publishedRoot = projectRoot(slug);
    let publishedDatabase = false;
    let publishedWorkspace = false;
    fs.mkdirSync(dbStage, { recursive: true });
    fs.mkdirSync(path.join(workStage, ".vcontext"), { recursive: true });
    const db = new Database(path.join(dbStage, "data.db"));
    try {
      db.pragma("foreign_keys = ON");
      migrateSyncProjectSchema(db);
      const now = Date.now();
      db.prepare("INSERT INTO branch (name, snapshot_id, created_at, updated_at) VALUES ('main', NULL, ?, ?)").run(now, now);
      const objectStore = new SyncObjectStore({ db });
      let continuation: string | undefined;
      let finalRefs = refs.refs;
      do {
        const response = await client.fetch({ protocol_version: SYNC_PROTOCOL_VERSION, project_id: refs.project_id, have: objectStore.descriptors(refs.project_id), ...(continuation ? { continuation } : {}) });
        objectStore.import(refs.project_id, response.objects);
        finalRefs = response.refs;
        continuation = response.continuation ?? undefined;
      } while (continuation);
      const main = finalRefs.find((ref) => ref.name === "main")?.snapshot_id ?? null;
      db.prepare("UPDATE branch SET snapshot_id = ?, updated_at = ? WHERE name = 'main'").run(main, Date.now());
      db.prepare("INSERT INTO remote (name, url, created_at, updated_at) VALUES ('origin', ?, ?, ?)").run(remoteUrl.replace(/\/$/, ""), now, now);
      const insertRef = db.prepare("INSERT INTO remote_ref (remote_name, name, snapshot_id, updated_at) VALUES ('origin', ?, ?, ?)");
      finalRefs.forEach((ref) => insertRef.run(ref.name, ref.snapshot_id, now));
      db.prepare("INSERT INTO branch_upstream (branch_name, remote_name, remote_branch, created_at, updated_at) VALUES ('main','origin','main',?,?)").run(now, now);
      db.close();
      fs.writeFileSync(path.join(dbStage, "project.json"), JSON.stringify({ current_branch: "main", schema_version: "3.0.0", migration: { incomplete_post_migrations: [], backup_paths: [] } }, null, 2) + "\n");
      fs.writeFileSync(path.join(workStage, ".vcontext", "project.json"), JSON.stringify({ slug, uuid: refs.project_id }, null, 2) + "\n");
      this.projects.registry.db.transaction(() => {
        const project = this.projects.registry.registerImported({ uuid: refs.project_id, slug, name: baseSlug });
        fs.renameSync(dbStage, publishedRoot);
        publishedDatabase = true;
        fs.renameSync(workStage, target);
        publishedWorkspace = true;
        this.projects.registry.addPath(project.slug, { type: "local", path: target, label: "workspace" });
      })();
      return { slug, uuid: refs.project_id, path: target, remote: "origin", empty: main === null };
    } catch (error) {
      if (db.open) db.close();
      fs.rmSync(dbStage, { recursive: true, force: true });
      fs.rmSync(workStage, { recursive: true, force: true });
      if (publishedDatabase) fs.rmSync(publishedRoot, { recursive: true, force: true });
      if (publishedWorkspace) fs.rmSync(target, { recursive: true, force: true });
      throw error;
    }
  }

  private async withStore<T>(slug: string, action: (store: Awaited<ReturnType<ProjectService["openStore"]>>) => Promise<T> | T) {
    const store = await this.projects.openStore(slug);
    try { return await action(store); } finally { store.close(); }
  }
}

function selectRemote(store: Awaited<ReturnType<ProjectService["openStore"]>>, name?: string) {
  const selected = name ? store.remotes.findByName(name) : store.remotes.findByName("origin") ?? store.remotes.find()[0];
  if (!selected) throw new Error(name ? `Remote "${name}" does not exist` : "No remote configured");
  return selected;
}

function isAncestor(db: Database.Database, ancestor: string, descendant: string) {
  return Boolean(db.prepare(`WITH RECURSIVE ancestry(id) AS (SELECT ? UNION SELECT parent_snapshot_id FROM snapshot_parent JOIN ancestry ON snapshot_id = ancestry.id) SELECT 1 FROM ancestry WHERE id = ? LIMIT 1`).get(descendant, ancestor));
}

function batches<T>(items: T[], maxItems: number, maxBytes: number) {
  const result: T[][] = []; let current: T[] = [];
  for (const item of items) {
    const next = [...current, item];
    if (current.length > 0 && (next.length > maxItems || jsonByteLength(next) > maxBytes)) { result.push(current); current = [item]; }
    else current = next;
    if (jsonByteLength(current) > maxBytes) throw syncError("REQUEST_TOO_LARGE", "A single sync object exceeds the request byte limit");
  }
  if (current.length) result.push(current);
  return result;
}

function syncError(code: ConstructorParameters<typeof VContextSyncError>[0]["code"], message: string) { return new VContextSyncError({ code, message }); }
