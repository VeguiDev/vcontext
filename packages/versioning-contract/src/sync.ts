import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SYNC_LIMITS } from "./constants.js";
import {
  EntityTypeSchema,
  IdSchema,
  ObjectHashSchema,
  ProjectIdSchema,
  RefNameSchema,
  SyncEnvelopeSchema,
  TimestampSchema,
} from "./common.js";
import { canonicalizeJson, sha256, type JsonObject, type JsonValue } from "./json.js";

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);
export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  JsonValueSchema,
);

export const SnapshotPayloadSchema = z
  .object({
    id: IdSchema,
    message: z.string().nullable(),
    created_at: TimestampSchema,
    parents: z.array(IdSchema).max(2).refine((ids) => new Set(ids).size === ids.length, {
      message: "snapshot parents must be unique",
    }),
  })
  .strict();

export const RecordIdentityPayloadSchema = z
  .object({
    id: IdSchema,
    entity_type: EntityTypeSchema,
    created_at: TimestampSchema,
  })
  .strict();

export const RecordRevisionPayloadSchema = z
  .object({
    id: IdSchema,
    record_id: IdSchema,
    snapshot_id: IdSchema,
    previous_revision_id: IdSchema.nullable(),
    entity_type: EntityTypeSchema,
    deleted_at: TimestampSchema.nullable(),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
    data: JsonObjectSchema,
  })
  .strict()
  .refine((value) => value.updated_at >= value.created_at, {
    message: "updated_at must not precede created_at",
    path: ["updated_at"],
  })
  .refine(
    (value) => value.deleted_at === null || value.deleted_at >= value.created_at,
    { message: "deleted_at must not precede created_at", path: ["deleted_at"] },
  );

const transportFields = { project_id: ProjectIdSchema, hash: ObjectHashSchema };
function idMatchesPayload(value: { id: string; payload: { id: string } }) {
  return value.id === value.payload.id;
}

export const SnapshotSyncObjectSchema = z
  .object({
    ...transportFields,
    object_type: z.literal("snapshot"),
    id: IdSchema,
    payload: SnapshotPayloadSchema,
  })
  .strict()
  .refine(idMatchesPayload, { message: "object id must equal payload id", path: ["id"] });
export const RecordIdentitySyncObjectSchema = z
  .object({
    ...transportFields,
    object_type: z.literal("record_identity"),
    id: IdSchema,
    payload: RecordIdentityPayloadSchema,
  })
  .strict()
  .refine(idMatchesPayload, { message: "object id must equal payload id", path: ["id"] });
export const RecordRevisionSyncObjectSchema = z
  .object({
    ...transportFields,
    object_type: z.literal("record_revision"),
    id: IdSchema,
    payload: RecordRevisionPayloadSchema,
  })
  .strict()
  .refine(idMatchesPayload, { message: "object id must equal payload id", path: ["id"] });

export const SyncObjectSchema = z.union([
  SnapshotSyncObjectSchema,
  RecordIdentitySyncObjectSchema,
  RecordRevisionSyncObjectSchema,
]);

export const SnapshotSyncObjectHashInputSchema = z
  .object({ object_type: z.literal("snapshot"), id: IdSchema, payload: SnapshotPayloadSchema })
  .strict()
  .refine(idMatchesPayload, { message: "object id must equal payload id", path: ["id"] });
export const RecordIdentitySyncObjectHashInputSchema = z
  .object({
    object_type: z.literal("record_identity"),
    id: IdSchema,
    payload: RecordIdentityPayloadSchema,
  })
  .strict()
  .refine(idMatchesPayload, { message: "object id must equal payload id", path: ["id"] });
export const RecordRevisionSyncObjectHashInputSchema = z
  .object({
    object_type: z.literal("record_revision"),
    id: IdSchema,
    payload: RecordRevisionPayloadSchema,
  })
  .strict()
  .refine(idMatchesPayload, { message: "object id must equal payload id", path: ["id"] });
export const SyncObjectHashInputSchema = z.union([
  SnapshotSyncObjectHashInputSchema,
  RecordIdentitySyncObjectHashInputSchema,
  RecordRevisionSyncObjectHashInputSchema,
]);

export type SnapshotPayload = z.infer<typeof SnapshotPayloadSchema>;
export type RecordIdentityPayload = z.infer<typeof RecordIdentityPayloadSchema>;
export type RecordRevisionPayload = z.infer<typeof RecordRevisionPayloadSchema>;
export type SnapshotSyncObject = z.infer<typeof SnapshotSyncObjectSchema>;
export type RecordIdentitySyncObject = z.infer<typeof RecordIdentitySyncObjectSchema>;
export type RecordRevisionSyncObject = z.infer<typeof RecordRevisionSyncObjectSchema>;
export type SyncObject = z.infer<typeof SyncObjectSchema>;
export type SyncObjectHashInput = z.infer<typeof SyncObjectHashInputSchema>;

/** Hashes exactly canonical JSON of `{ object_type, id, payload }`. */
export function hashSyncObject(object: SyncObject | SyncObjectHashInput): string {
  const { object_type, id, payload } = object;
  const content = SyncObjectHashInputSchema.parse({ object_type, id, payload });
  return sha256(canonicalizeJson(content));
}

export function verifySyncObject(object: unknown): object is SyncObject {
  const parsed = SyncObjectSchema.safeParse(object);
  if (!parsed.success) return false;
  const expected = Buffer.from(hashSyncObject(parsed.data), "hex");
  const actual = Buffer.from(parsed.data.hash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function assertSyncObject(object: unknown): asserts object is SyncObject {
  const parsed = SyncObjectSchema.parse(object);
  if (!verifySyncObject(parsed)) throw new Error("Sync object hash mismatch");
}

export function withSyncObjectHash<T extends SyncObjectHashInput>(
  project_id: string,
  content: T,
): T & { project_id: string; hash: string } {
  const parsedProjectId = ProjectIdSchema.parse(project_id);
  const parsed = SyncObjectHashInputSchema.parse(content) as T;
  return { ...parsed, project_id: parsedProjectId, hash: hashSyncObject(parsed) };
}

export const SyncObjectDescriptorSchema = z
  .object({
    object_type: z.enum(["snapshot", "record_identity", "record_revision"]),
    id: IdSchema,
    hash: ObjectHashSchema,
  })
  .strict();
export const SyncRefSchema = z
  .object({ name: RefNameSchema, snapshot_id: IdSchema.nullable() })
  .strict();

export const RefsRequestSchema = SyncEnvelopeSchema.strict();
export const RefsResponseSchema = SyncEnvelopeSchema.extend({
  refs: z.array(SyncRefSchema),
}).strict();
export const FetchRequestSchema = SyncEnvelopeSchema.extend({
  have: z.array(SyncObjectDescriptorSchema).max(10_000).default([]),
  continuation: z.string().min(1).optional(),
}).strict();
export const FetchResponseSchema = SyncEnvelopeSchema.extend({
  objects: z.array(SyncObjectSchema).max(SYNC_LIMITS.fetch.max_objects),
  refs: z.array(SyncRefSchema),
  continuation: z.string().min(1).nullable(),
})
  .strict()
  .refine(
    (value) => value.objects.every((object) => object.project_id === value.project_id),
    { message: "all objects must belong to the envelope project", path: ["objects"] },
  );
export const MissingRequestSchema = SyncEnvelopeSchema.extend({
  objects: z.array(SyncObjectDescriptorSchema).max(SYNC_LIMITS.missing.max_descriptors),
}).strict();
export const MissingResponseSchema = SyncEnvelopeSchema.extend({
  missing: z.array(SyncObjectDescriptorSchema).max(SYNC_LIMITS.missing.max_descriptors),
}).strict();

export const RefUpdateSchema = z
  .object({
    name: RefNameSchema,
    old_snapshot_id: IdSchema.nullable(),
    new_snapshot_id: IdSchema.nullable(),
    force: z.boolean().optional().default(false),
  })
  .strict();
export const PushRequestSchema = SyncEnvelopeSchema.extend({
  request_id: IdSchema,
  client_id: IdSchema,
  objects: z.array(SyncObjectSchema).max(SYNC_LIMITS.push.max_objects),
  ref_updates: z.array(RefUpdateSchema).max(100),
})
  .strict()
  .refine(
    (value) => value.objects.every((object) => object.project_id === value.project_id),
    { message: "all objects must belong to the envelope project", path: ["objects"] },
  );
export const RefUpdateResultSchema = z
  .object({
    name: RefNameSchema,
    old_snapshot_id: IdSchema.nullable(),
    new_snapshot_id: IdSchema.nullable(),
  })
  .strict();
export const PushResponseSchema = SyncEnvelopeSchema.extend({
  request_id: IdSchema,
  replayed: z.boolean(),
  stored_objects: z.number().int().nonnegative(),
  refs: z.array(RefUpdateResultSchema),
}).strict();

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function isWithinSyncByteLimit(
  operation: "fetch" | "missing" | "push",
  value: unknown,
): boolean {
  return jsonByteLength(value) <= SYNC_LIMITS[operation].max_bytes;
}

export type SyncObjectDescriptor = z.infer<typeof SyncObjectDescriptorSchema>;
export type SyncRef = z.infer<typeof SyncRefSchema>;
export type RefsRequest = z.infer<typeof RefsRequestSchema>;
export type RefsResponse = z.infer<typeof RefsResponseSchema>;
export type FetchRequest = z.infer<typeof FetchRequestSchema>;
export type FetchResponse = z.infer<typeof FetchResponseSchema>;
export type MissingRequest = z.infer<typeof MissingRequestSchema>;
export type MissingResponse = z.infer<typeof MissingResponseSchema>;
export type RefUpdate = z.infer<typeof RefUpdateSchema>;
export type PushRequest = z.infer<typeof PushRequestSchema>;
export type PushResponse = z.infer<typeof PushResponseSchema>;
