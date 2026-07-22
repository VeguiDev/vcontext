import { z } from "zod";
import { SYNC_V2_LIMITS, SYNC_PROTOCOL_V2_VERSION } from "./constants.js";
import {
  IdSchema,
  ObjectHashSchema,
  ProjectIdSchema,
  RefNameSchema,
} from "./common.js";
import {
  RefUpdateResultSchema,
  RefUpdateSchema,
  SyncObjectDescriptorSchema,
  SyncObjectSchema,
  SyncRefSchema,
  jsonByteLength,
} from "./sync.js";

export const GitCommitShaSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);

export const SnapshotAuthorSchema = z
  .object({
    cloud_id: IdSchema.nullable(),
    name: z.string().min(1).max(255),
    email: z.email().nullable(),
  })
  .strict();

/**
 * Snapshot metadata is transported independently from immutable sync objects.
 * `author` is a copied value. Servers reject every mutation except
 * `git_commit_sha: null -> value`; `version` is the optimistic concurrency token.
 */
export const SnapshotMetadataSchema = z
  .object({
    snapshot_id: IdSchema,
    author: SnapshotAuthorSchema,
    git_commit_sha: GitCommitShaSchema.nullable(),
    git_branch: RefNameSchema.nullable(),
    git_dirty: z.boolean(),
    commit_message: z.string().max(4096).nullable(),
    version: z.number().int().positive(),
  })
  .strict();

export const SnapshotMetadataDescriptorSchema = z
  .object({ snapshot_id: IdSchema, version: z.number().int().positive() })
  .strict();

export const SyncV2EnvelopeSchema = z.object({
  protocol_version: z.literal(SYNC_PROTOCOL_V2_VERSION),
  project_id: ProjectIdSchema,
});

export const RefsV2RequestSchema = SyncV2EnvelopeSchema.strict();
export const RefsV2ResponseSchema = SyncV2EnvelopeSchema.extend({
  refs: z.array(SyncRefSchema),
}).strict();

export const FetchV2RequestSchema = SyncV2EnvelopeSchema.extend({
  have: z.array(SyncObjectDescriptorSchema).max(SYNC_V2_LIMITS.missing.max_descriptors).default([]),
  have_snapshot_metadata: z
    .array(SnapshotMetadataDescriptorSchema)
    .max(SYNC_V2_LIMITS.missing.max_descriptors)
    .default([]),
  continuation: z.string().min(1).optional(),
}).strict();

export const FetchV2ResponseSchema = SyncV2EnvelopeSchema.extend({
  objects: z.array(SyncObjectSchema).max(SYNC_V2_LIMITS.fetch.max_objects),
  snapshot_metadata: z
    .array(SnapshotMetadataSchema)
    .max(SYNC_V2_LIMITS.fetch.max_snapshot_metadata),
  refs: z.array(SyncRefSchema),
  continuation: z.string().min(1).nullable(),
})
  .strict()
  .refine(
    (value) => value.objects.every((object) => object.project_id === value.project_id),
    { message: "all objects must belong to the envelope project", path: ["objects"] },
  );

export const MissingV2RequestSchema = SyncV2EnvelopeSchema.extend({
  objects: z
    .array(SyncObjectDescriptorSchema)
    .max(SYNC_V2_LIMITS.missing.max_descriptors),
  snapshot_metadata: z
    .array(SnapshotMetadataDescriptorSchema)
    .max(SYNC_V2_LIMITS.missing.max_descriptors),
}).strict();

export const MissingV2ResponseSchema = SyncV2EnvelopeSchema.extend({
  missing: z
    .array(SyncObjectDescriptorSchema)
    .max(SYNC_V2_LIMITS.missing.max_descriptors),
  missing_snapshot_metadata: z
    .array(SnapshotMetadataDescriptorSchema)
    .max(SYNC_V2_LIMITS.missing.max_descriptors),
}).strict();

export const PushV2RequestSchema = SyncV2EnvelopeSchema.extend({
  request_id: IdSchema,
  client_id: IdSchema,
  objects: z.array(SyncObjectSchema).max(SYNC_V2_LIMITS.push.max_objects),
  snapshot_metadata: z
    .array(SnapshotMetadataSchema)
    .max(SYNC_V2_LIMITS.push.max_snapshot_metadata),
  ref_updates: z.array(RefUpdateSchema).max(100),
})
  .strict()
  .refine(
    (value) => value.objects.every((object) => object.project_id === value.project_id),
    { message: "all objects must belong to the envelope project", path: ["objects"] },
  );

export const PushV2ResponseSchema = SyncV2EnvelopeSchema.extend({
  request_id: IdSchema,
  replayed: z.boolean(),
  stored_objects: z.number().int().nonnegative(),
  stored_snapshot_metadata: z.number().int().nonnegative(),
  refs: z.array(RefUpdateResultSchema),
}).strict();

export function isWithinSyncV2ByteLimit(
  operation: "fetch" | "missing" | "push",
  value: unknown,
): boolean {
  return jsonByteLength(value) <= SYNC_V2_LIMITS[operation].max_bytes;
}

export type SnapshotAuthor = z.infer<typeof SnapshotAuthorSchema>;
export type SnapshotMetadata = z.infer<typeof SnapshotMetadataSchema>;
export type SnapshotMetadataDescriptor = z.infer<typeof SnapshotMetadataDescriptorSchema>;
export type FetchV2Request = z.infer<typeof FetchV2RequestSchema>;
export type FetchV2Response = z.infer<typeof FetchV2ResponseSchema>;
export type MissingV2Request = z.infer<typeof MissingV2RequestSchema>;
export type MissingV2Response = z.infer<typeof MissingV2ResponseSchema>;
export type PushV2Request = z.infer<typeof PushV2RequestSchema>;
export type PushV2Response = z.infer<typeof PushV2ResponseSchema>;
