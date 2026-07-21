import {
  SyncObjectSchema,
  VContextSyncError,
  assertSyncObject,
  hashSyncObject,
  withSyncObjectHash,
  type EntityType,
  type SyncObject,
  type SyncObjectDescriptor,
  type SnapshotSyncObject,
  type RecordRevisionSyncObject,
} from "@vcontext/versioning-contract";
import { ENTITY_FIELDS, ENTITY_TYPES } from "../storage/snapshot-state.js";
import type { ProjectStore } from "../storage/project-store.js";

export class SyncObjectStore {
  constructor(private readonly store: Pick<ProjectStore, "db">) {}

  descriptors(projectId: string): SyncObjectDescriptor[] {
    return this.exportAll(projectId).map(({ object_type, id, hash }) => ({ object_type, id, hash }));
  }

  exportAll(projectId: string): SyncObject[] {
    const snapshots = (this.store.db.prepare("SELECT id, message, created_at FROM snapshot ORDER BY created_at, id").all() as Array<{ id: string; message: string | null; created_at: number }>).map((snapshot) => {
      const parents = this.store.db.prepare("SELECT parent_snapshot_id FROM snapshot_parent WHERE snapshot_id = ? ORDER BY parent_order").all(snapshot.id) as Array<{ parent_snapshot_id: string }>;
      const object = withSyncObjectHash(projectId, { object_type: "snapshot" as const, id: snapshot.id, payload: { ...snapshot, parents: parents.map((entry) => entry.parent_snapshot_id) } });
      this.store.db.prepare("UPDATE snapshot SET object_hash = ? WHERE id = ? AND object_hash IS NULL").run(object.hash, object.id);
      return object;
    });
    const identities = (this.store.db.prepare("SELECT record_id AS id, entity_type, created_at FROM record_identity ORDER BY created_at, record_id").all() as Array<{ id: string; entity_type: EntityType; created_at: number }>).map((identity) => {
      const object = withSyncObjectHash(projectId, { object_type: "record_identity" as const, id: identity.id, payload: identity });
      this.store.db.prepare("UPDATE record_identity SET object_hash = ? WHERE record_id = ? AND object_hash IS NULL").run(object.hash, object.id);
      return object;
    });
    const revisions: RecordRevisionSyncObject[] = [];
    for (const entityType of ENTITY_TYPES) {
      const rows = this.store.db.prepare(`SELECT * FROM ${entityType} ORDER BY created_at, updated_at, id`).all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const object = withSyncObjectHash(projectId, {
          object_type: "record_revision" as const,
          id: String(row.id),
          payload: {
            id: String(row.id), record_id: String(row.record_id), snapshot_id: String(row.snapshot_id),
            previous_revision_id: row.previous_revision_id === null ? null : String(row.previous_revision_id),
            entity_type: entityType, deleted_at: row.deleted_at === null ? null : Number(row.deleted_at),
            created_at: Number(row.created_at), updated_at: Number(row.updated_at),
            data: Object.fromEntries(ENTITY_FIELDS[entityType].map((field) => [field, row[field] as never])),
          },
        });
        this.store.db.prepare(`UPDATE ${entityType} SET object_hash = ? WHERE id = ? AND object_hash IS NULL`).run(object.hash, object.id);
        revisions.push(object);
      }
    }
    return [...topologicalSnapshots(snapshots), ...identities, ...topologicalRevisions(revisions)];
  }

  import(projectId: string, rawObjects: unknown[]): { imported: number; existing: number } {
    const objects = rawObjects.map((raw) => {
      const object = SyncObjectSchema.parse(raw);
      assertSyncObject(object);
      if (object.project_id !== projectId) throw syncError("PROJECT_MISMATCH", `Object ${object.id} belongs to another project`);
      return object;
    });
    return this.store.db.transaction(() => {
      // Backfill hashes for v2 objects before comparing incoming ids.
      this.exportAll(projectId);
      let imported = 0;
      let existing = 0;
      const snapshots = objects.filter((item) => item.object_type === "snapshot");
      const identities = objects.filter((item) => item.object_type === "record_identity");
      const revisions = objects.filter((item) => item.object_type === "record_revision");

      for (const object of topologicalSnapshots(snapshots, (id) => this.hasSnapshot(id))) {
        const current = this.store.db.prepare("SELECT object_hash FROM snapshot WHERE id = ?").get(object.id) as { object_hash: string | null } | undefined;
        if (current) { this.assertSameHash(object, current.object_hash); existing += 1; continue; }
        this.store.db.prepare("INSERT INTO snapshot (id, message, created_at, object_hash) VALUES (?, ?, ?, ?)").run(object.id, object.payload.message, object.payload.created_at, object.hash);
        const insertParent = this.store.db.prepare("INSERT INTO snapshot_parent (snapshot_id, parent_snapshot_id, parent_order) VALUES (?, ?, ?)");
        object.payload.parents.forEach((parent, index) => insertParent.run(object.id, parent, index));
        imported += 1;
      }
      for (const object of identities) {
        const current = this.store.db.prepare("SELECT object_hash FROM record_identity WHERE record_id = ?").get(object.id) as { object_hash: string | null } | undefined;
        if (current) { this.assertSameHash(object, current.object_hash); existing += 1; continue; }
        this.store.db.prepare("INSERT INTO record_identity (record_id, entity_type, created_at, object_hash) VALUES (?, ?, ?, ?)").run(object.id, object.payload.entity_type, object.payload.created_at, object.hash);
        imported += 1;
      }
      for (const object of topologicalRevisions(revisions, (id, type) => this.hasRevision(id, type))) {
        const table = object.payload.entity_type;
        const current = this.store.db.prepare(`SELECT object_hash FROM ${table} WHERE id = ?`).get(object.id) as { object_hash: string | null } | undefined;
        if (current) { this.assertSameHash(object, current.object_hash); existing += 1; continue; }
        const identity = this.store.db.prepare("SELECT entity_type, created_at FROM record_identity WHERE record_id = ?").get(object.payload.record_id) as { entity_type: string; created_at: number } | undefined;
        if (!identity || identity.entity_type !== table || identity.created_at !== object.payload.created_at) throw syncError("INVALID_OBJECT", `Invalid identity for revision ${object.id}`);
        if (!this.hasSnapshot(object.payload.snapshot_id)) throw syncError("MISSING_OBJECTS", `Missing snapshot ${object.payload.snapshot_id}`);
        this.validateData(table, object.payload.data);
        const columns = ["id", "record_id", "snapshot_id", "previous_revision_id", "deleted_at", ...ENTITY_FIELDS[table], "created_at", "updated_at", "object_hash"];
        const values: Record<string, unknown> = { ...object.payload, ...object.payload.data, object_hash: object.hash };
        this.store.db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((column) => values[column]));
        imported += 1;
      }
      this.validateReferences();
      return { imported, existing };
    })();
  }

  private hasSnapshot(id: string) { return Boolean(this.store.db.prepare("SELECT 1 FROM snapshot WHERE id = ?").get(id)); }
  private hasRevision(id: string, type: EntityType) { return Boolean(this.store.db.prepare(`SELECT 1 FROM ${type} WHERE id = ?`).get(id)); }
  private assertSameHash(object: SyncObject, storedHash: string | null) {
    if ((storedHash ?? hashSyncObject(object)) !== object.hash) throw syncError("OBJECT_COLLISION", `Object id ${object.id} has different content`);
  }
  private validateData(type: EntityType, data: Record<string, unknown>) {
    const expected = ENTITY_FIELDS[type];
    if (Object.keys(data).length !== expected.length || expected.some((field) => !(field in data))) throw syncError("INVALID_OBJECT", `Revision data for ${type} must contain exactly ${expected.join(", ")}`);
  }
  private validateReferences() {
    for (const table of ["task", "change_note"] as const) {
      const invalid = this.store.db.prepare(`SELECT source.id FROM ${table} source LEFT JOIN record_identity target ON target.record_id = source.document_id AND target.entity_type = 'document' WHERE source.document_id IS NOT NULL AND target.record_id IS NULL LIMIT 1`).get() as { id: string } | undefined;
      if (invalid) throw syncError("INVALID_GRAPH", `Revision ${invalid.id} references a missing document identity`);
    }
  }
}

function topologicalSnapshots(objects: SnapshotSyncObject[], already = (_id: string) => false): SnapshotSyncObject[] {
  const nodes = objects.filter((item) => item.object_type === "snapshot");
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const result: SnapshotSyncObject[] = []; const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (item: (typeof nodes)[number]) => {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) throw syncError("INVALID_GRAPH", "Snapshot graph contains a cycle");
    visiting.add(item.id);
    for (const parent of item.payload.parents) { const node = byId.get(parent); if (node) visit(node); else if (!already(parent)) throw syncError("MISSING_OBJECTS", `Missing snapshot parent ${parent}`); }
    visiting.delete(item.id); visited.add(item.id); result.push(item);
  };
  nodes.forEach(visit); return result;
}

function topologicalRevisions(objects: RecordRevisionSyncObject[], already = (_id: string, _type: EntityType) => false): RecordRevisionSyncObject[] {
  const nodes = objects.filter((item) => item.object_type === "record_revision");
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const result: RecordRevisionSyncObject[] = []; const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (item: (typeof nodes)[number]) => {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) throw syncError("INVALID_GRAPH", "Revision chain contains a cycle");
    visiting.add(item.id);
    const previous = item.payload.previous_revision_id;
    if (previous) { const node = byId.get(previous); if (node) { if (node.payload.record_id !== item.payload.record_id || node.payload.entity_type !== item.payload.entity_type) throw syncError("INVALID_GRAPH", `Revision ${item.id} has an invalid predecessor`); visit(node); } else if (!already(previous, item.payload.entity_type)) throw syncError("MISSING_OBJECTS", `Missing previous revision ${previous}`); }
    visiting.delete(item.id); visited.add(item.id); result.push(item);
  };
  nodes.forEach(visit); return result;
}

function syncError(code: ConstructorParameters<typeof VContextSyncError>[0]["code"], message: string) { return new VContextSyncError({ code, message }); }
