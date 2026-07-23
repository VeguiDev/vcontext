import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database, { type Database as DatabaseConnection } from "../storage/database.js";
import {
  SYNC_LIMITS,
  SYNC_PROTOCOL_VERSION,
  SYNC_PROTOCOL_V2_VERSION,
  SYNC_V2_LIMITS,
  VContextSyncError,
  jsonByteLength,
  type RefUpdate,
  type SyncObject,
} from "@vcontext/versioning-contract";
import type { ProjectService } from "../project/project-service.js";
import { migrateGitAwareProjectSchema } from "../storage/schema.js";
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

  async drainQueue(slug: string) {
    const store = await this.projects.openStore(slug);
    const jobs = store.gitAware.dueJobs();
    store.close();
    let completed = 0; let failed = 0;
    for (const job of jobs) {
      try {
        const payload = JSON.parse(job.payload) as { branch?: string };
        if (job.operation === "FETCH") await this.fetch(slug);
        else if (job.operation === "PULL") await this.pull(slug, { branch: payload.branch });
        else if (job.operation === "PUSH") await this.push(slug, { branch: payload.branch });
        const current = await this.projects.openStore(slug); current.gitAware.completeJob(job.id); current.close(); completed += 1;
      } catch (error) {
        const current = await this.projects.openStore(slug);
        if (error instanceof VContextSyncError && error.code === "NON_FAST_FORWARD") current.gitAware.enqueue("PULL", `pull:nff:${job.id}`, { source_job: job.id });
        if (/conflict/i.test(error instanceof Error ? error.message : String(error))) current.gitAware.addConflict("MERGE_CONFLICT", (JSON.parse(job.payload) as { branch?: string }).branch ?? null, { message: error instanceof Error ? error.message : String(error) });
        current.gitAware.failJob(job.id, error); current.close(); failed += 1;
      }
    }
    return { attempted: jobs.length, completed, failed };
  }

  async fetch(slug: string, remoteName?: string) {
    return this.withStore(slug, async (store) => {
      const remote = selectRemote(store, remoteName);
      const client = new RemoteRepositoryClient(remote.url, this.options);
      const refsV2 = await preferV2Refs(client);
      const refsEnvelope = refsV2 ?? await client.refs();
      const objectStore = new SyncObjectStore(store);
      let continuation: string | undefined;
      let pinnedRefs = refsEnvelope.refs;
      let imported = 0;
      let existing = 0;
      do {
        const response = refsV2 ? await client.fetchV2({
          protocol_version: SYNC_PROTOCOL_V2_VERSION,
          project_id: refsEnvelope.project_id,
          have: objectStore.descriptors(refsEnvelope.project_id),
          have_snapshot_metadata: store.gitAware.metadata().map(({ snapshot_id, version }) => ({ snapshot_id, version })),
          ...(continuation ? { continuation } : {}),
        }) : await client.fetch({
          protocol_version: SYNC_PROTOCOL_VERSION,
          project_id: refsEnvelope.project_id,
          have: objectStore.descriptors(refsEnvelope.project_id),
          ...(continuation ? { continuation } : {}),
        });
        const result = store.db.transaction(() => {
          const importedObjects = objectStore.import(refsEnvelope.project_id, response.objects);
          if ("snapshot_metadata" in response) response.snapshot_metadata.forEach((metadata) => store.gitAware.upsertMetadata(metadata));
          return importedObjects;
        })();
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
      const refsV2 = await preferV2Refs(client);
      const refs = refsV2 ?? await client.refs();
      const remoteBranch = store.remotes.upstream(branchName)?.remote_branch ?? branchName;
      const oldHead = refs.refs.find((ref) => ref.name === remoteBranch)?.snapshot_id ?? null;
      const objectStore = new SyncObjectStore(store);
      const objects = objectStore.exportAll(refs.project_id);
      const metadata = store.gitAware.metadata();
      if (refsV2) {
        const missingResponse = await client.missingV2({
          protocol_version: SYNC_PROTOCOL_V2_VERSION,
          project_id: refs.project_id,
          objects: objects.map(({ object_type, id, hash }) => ({ object_type, id, hash })),
          snapshot_metadata: metadata.map(({ snapshot_id, version }) => ({ snapshot_id, version })),
        });
        const objectKeys = new Set(missingResponse.missing.map((item) => `${item.object_type}:${item.id}:${item.hash}`));
        const missingObjects = objects.filter((item) => objectKeys.has(`${item.object_type}:${item.id}:${item.hash}`));
        const metadataKeys = new Set(missingResponse.missing_snapshot_metadata.map((item) => `${item.snapshot_id}:${item.version}`));
        const missingMetadata = metadata.filter((item) => metadataKeys.has(`${item.snapshot_id}:${item.version}`));
        let storedObjects = 0; let storedMetadata = 0;
        const objectChunks = batches(missingObjects, SYNC_V2_LIMITS.push.max_objects, SYNC_V2_LIMITS.push.max_bytes);
        const metadataChunks = batches(missingMetadata, SYNC_V2_LIMITS.push.max_snapshot_metadata, SYNC_V2_LIMITS.push.max_bytes);
        const count = Math.max(objectChunks.length, metadataChunks.length);
        for (let index = 0; index < count; index += 1) {
          const response = await client.pushV2({ protocol_version: SYNC_PROTOCOL_V2_VERSION, project_id: refs.project_id, request_id: randomUUID(), client_id: this.clientId, objects: objectChunks[index] ?? [], snapshot_metadata: metadataChunks[index] ?? [], ref_updates: [] });
          storedObjects += response.stored_objects; storedMetadata += response.stored_snapshot_metadata;
        }
        const update: RefUpdate = { name: remoteBranch, old_snapshot_id: oldHead, new_snapshot_id: branch.snapshot_id, force: input.force ?? false };
        const result = await client.pushV2({ protocol_version: SYNC_PROTOCOL_V2_VERSION, project_id: refs.project_id, request_id: randomUUID(), client_id: this.clientId, objects: [], snapshot_metadata: [], ref_updates: [update] });
        const updated = new Map(refs.refs.map((ref) => [ref.name, ref.snapshot_id]));
        result.refs.forEach((ref) => updated.set(ref.name, ref.new_snapshot_id));
        store.remotes.replaceRefs(remote.name, [...updated].map(([name, snapshot_id]) => ({ name, snapshot_id })));
        store.remotes.setUpstream(branchName, remote.name, remoteBranch);
        return { ...result, stored_objects: storedObjects + result.stored_objects, stored_snapshot_metadata: storedMetadata + result.stored_snapshot_metadata, remote: remote.name };
      }
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
    const existingTarget = fs.existsSync(target);
    if (existingTarget && !fs.statSync(target).isDirectory()) throw new Error(`Clone target is not a directory: ${target}`);
    if (existingTarget && fs.existsSync(path.join(target, ".vcontext", "project.json"))) throw new Error(`Clone target already has a VContext marker: ${target}`);
    const client = new RemoteRepositoryClient(remoteUrl, this.options);
    const refsV2 = await preferV2Refs(client);
    const refs = refsV2 ?? await client.refs();
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
    if (!existingTarget) fs.mkdirSync(path.join(workStage, ".vcontext"), { recursive: true });
    const db = new Database(path.join(dbStage, "data.db"));
    try {
      db.pragma("foreign_keys = ON");
      migrateGitAwareProjectSchema(db);
      const now = Date.now();
      db.prepare("INSERT INTO branch (name, snapshot_id, created_at, updated_at) VALUES ('main', NULL, ?, ?)").run(now, now);
      const objectStore = new SyncObjectStore({ db });
      let continuation: string | undefined;
      let finalRefs = refs.refs;
      do {
        const response = refsV2 ? await client.fetchV2({ protocol_version: SYNC_PROTOCOL_V2_VERSION, project_id: refs.project_id, have: objectStore.descriptors(refs.project_id), have_snapshot_metadata: [], ...(continuation ? { continuation } : {}) }) : await client.fetch({ protocol_version: SYNC_PROTOCOL_VERSION, project_id: refs.project_id, have: objectStore.descriptors(refs.project_id), ...(continuation ? { continuation } : {}) });
        objectStore.import(refs.project_id, response.objects);
        if ("snapshot_metadata" in response) response.snapshot_metadata.forEach((metadata) => {
          const now = Date.now();
          db.prepare(`INSERT INTO snapshot_metadata(snapshot_id,author_cloud_id,author_name,author_email,git_commit_sha,git_branch,git_dirty,commit_message,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
            .run(metadata.snapshot_id, metadata.author.cloud_id, metadata.author.name, metadata.author.email, metadata.git_commit_sha, metadata.git_branch, metadata.git_dirty ? 1 : 0, metadata.commit_message, metadata.version, now, now);
        });
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
      fs.writeFileSync(path.join(dbStage, "project.json"), JSON.stringify({ current_branch: "main", schema_version: "4.0.0", migration: { incomplete_post_migrations: [], backup_paths: [] } }, null, 2) + "\n");
      const remoteEndpoint = new URL(`/api/v1/projects/${refs.project_id}`, parsed.origin).toString();
      const markerProject = parts.length === 2 ? `${parts[0]}/${parts[1]}` : parts[0] === "api" && parts[1] === "v1" && parts[2] === "repos" ? `${parts[3]}/${parts[4]}` : `remote/${baseSlug}`;
      const markerText = JSON.stringify({ version: 1, project_id: refs.project_id, project: markerProject, remote: remoteEndpoint }, null, 2) + "\n";
      if (!existingTarget) fs.writeFileSync(path.join(workStage, ".vcontext", "project.json"), markerText);
      this.projects.registry.db.transaction(() => {
        const project = this.projects.registry.registerImported({ uuid: refs.project_id, slug, name: baseSlug });
        fs.renameSync(dbStage, publishedRoot);
        publishedDatabase = true;
        if (existingTarget) {
          const markerDir = path.join(target, ".vcontext"); fs.mkdirSync(markerDir, { recursive: true });
          const markerStage = path.join(markerDir, `.project-${process.pid}.tmp`); fs.writeFileSync(markerStage, markerText); fs.renameSync(markerStage, path.join(markerDir, "project.json"));
        } else fs.renameSync(workStage, target);
        publishedWorkspace = true;
        this.projects.registry.addPath(project.slug, { type: "local", path: target, label: "workspace" });
      })();
      return { slug, uuid: refs.project_id, path: target, remote: "origin", empty: main === null };
    } catch (error) {
      if (db.open) db.close();
      fs.rmSync(dbStage, { recursive: true, force: true });
      fs.rmSync(workStage, { recursive: true, force: true });
      if (publishedDatabase) fs.rmSync(publishedRoot, { recursive: true, force: true });
      if (publishedWorkspace) {
        if (existingTarget) fs.rmSync(path.join(target, ".vcontext", "project.json"), { force: true });
        else fs.rmSync(target, { recursive: true, force: true });
      }
      throw error;
    }
  }

  async initializeExisting(input: { project_id: string; project: string; remote: string; cwd: string }) {
    const existing = this.projects.registry.findByUuid(input.project_id);
    if (existing) {
      this.projects.registry.addPath(existing.slug, { type: "local", path: path.resolve(input.cwd), label: "workspace" });
      return existing;
    }
    const client = new RemoteRepositoryClient(input.remote, this.options);
    const refsV2 = await preferV2Refs(client);
    const refs = refsV2 ?? await client.refs();
    if (refs.project_id !== input.project_id) throw syncError("PROJECT_MISMATCH", "Marker project_id does not match the authenticated Cloud project");
    const baseSlug = input.project.split("/")[1] ?? "project";
    let slug = baseSlug; let suffix = 2;
    while (this.projects.registry.findBySlug(slug) || fs.existsSync(projectRoot(slug))) slug = `${baseSlug}-${suffix++}`;
    const stageRoot = path.join(PROJECTS_ROOT, `.resolve-${input.project_id}-${randomUUID()}`);
    const publishedRoot = projectRoot(slug);
    fs.mkdirSync(stageRoot, { recursive: true });
    const db = new Database(path.join(stageRoot, "data.db"));
    let published = false;
    try {
      db.pragma("foreign_keys = ON");
      migrateGitAwareProjectSchema(db);
      const now = Date.now();
      db.prepare("INSERT INTO branch(name,snapshot_id,created_at,updated_at) VALUES('main',NULL,?,?)").run(now, now);
      const objectStore = new SyncObjectStore({ db });
      let continuation: string | undefined; let finalRefs = refs.refs;
      do {
        const response = refsV2
          ? await client.fetchV2({ protocol_version: SYNC_PROTOCOL_V2_VERSION, project_id: refs.project_id, have: objectStore.descriptors(refs.project_id), have_snapshot_metadata: [], ...(continuation ? { continuation } : {}) })
          : await client.fetch({ protocol_version: SYNC_PROTOCOL_VERSION, project_id: refs.project_id, have: objectStore.descriptors(refs.project_id), ...(continuation ? { continuation } : {}) });
        db.transaction(() => {
          objectStore.import(refs.project_id, response.objects);
          if ("snapshot_metadata" in response) {
            for (const metadata of response.snapshot_metadata) {
              db.prepare(`INSERT INTO snapshot_metadata(snapshot_id,author_cloud_id,author_name,author_email,git_commit_sha,git_branch,git_dirty,commit_message,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
                .run(metadata.snapshot_id, metadata.author.cloud_id, metadata.author.name, metadata.author.email, metadata.git_commit_sha, metadata.git_branch, metadata.git_dirty ? 1 : 0, metadata.commit_message, metadata.version, now, now);
            }
          }
        })();
        finalRefs = response.refs; continuation = response.continuation ?? undefined;
      } while (continuation);
      const main = finalRefs.find((ref) => ref.name === "main")?.snapshot_id ?? finalRefs[0]?.snapshot_id ?? null;
      db.prepare("UPDATE branch SET snapshot_id=?, updated_at=? WHERE name='main'").run(main, Date.now());
      db.prepare("INSERT INTO remote(name,url,created_at,updated_at) VALUES('origin',?,?,?)").run(input.remote, now, now);
      const insertRef = db.prepare("INSERT INTO remote_ref(remote_name,name,snapshot_id,updated_at) VALUES('origin',?,?,?)");
      finalRefs.forEach((ref) => insertRef.run(ref.name, ref.snapshot_id, now));
      db.prepare("INSERT INTO branch_upstream(branch_name,remote_name,remote_branch,created_at,updated_at) VALUES('main','origin','main',?,?)").run(now, now);
      db.close();
      fs.writeFileSync(path.join(stageRoot, "project.json"), JSON.stringify({ current_branch: "main", schema_version: "4.0.0", migration: { incomplete_post_migrations: [], backup_paths: [] } }, null, 2) + "\n");
      const project = this.projects.registry.db.transaction(() => {
        const registered = this.projects.registry.registerImported({ uuid: input.project_id, slug, name: baseSlug });
        fs.renameSync(stageRoot, publishedRoot); published = true;
        this.projects.registry.addPath(registered.slug, { type: "local", path: path.resolve(input.cwd), label: "workspace" });
        this.projects.registry.addPath(registered.slug, { type: "remote", path: input.remote, label: "vcontext:origin" });
        return registered;
      })();
      return project;
    } catch (error) {
      if (db.open) db.close();
      fs.rmSync(stageRoot, { recursive: true, force: true });
      if (published) fs.rmSync(publishedRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async linkExisting(project: string, remoteUrl: string, cwd: string) {
    const client = new RemoteRepositoryClient(remoteUrl, this.options);
    const refs = await client.refs();
    const remote = new URL(`/api/v1/projects/${refs.project_id}`, new URL(remoteUrl).origin).toString();
    const registered = await this.initializeExisting({ project_id: refs.project_id, project, remote, cwd });
    return { ...registered, marker: { version: 1 as const, project_id: refs.project_id, project, remote } };
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

function isAncestor(db: DatabaseConnection, ancestor: string, descendant: string) {
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

async function preferV2Refs(client: RemoteRepositoryClient) {
  if (!client.endpointV2) return null;
  try { return await client.refsV2(); }
  catch (error) {
    if (error instanceof VContextSyncError && ["INVALID_REQUEST", "INTERNAL_ERROR"].includes(error.code)) return null;
    throw error;
  }
}
