import { z } from "zod";
import { ENTITY_TYPES, SYNC_PROTOCOL_VERSION } from "./constants.js";

export const IdSchema = z.string().min(1).max(255);
export const ProjectIdSchema = IdSchema;
export const ObjectHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const TimestampSchema = z.number().int().nonnegative();
export const EntityTypeSchema = z.enum(ENTITY_TYPES);
export const RefNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^(?!\/|.*(?:\.\.|\/\/|@\{|\\|\s|~|\^|:|\?|\*|\[))(?!.*\/$)(?!.*\.lock$)[\x21-\x7e]+$/);

export const SyncEnvelopeSchema = z.object({
  protocol_version: z.literal(SYNC_PROTOCOL_VERSION),
  project_id: ProjectIdSchema,
});

export interface VersionedRecordCore {
  id: string;
  record_id: string;
  snapshot_id: string;
  previous_revision_id: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

export type MergeConflictType =
  | "FIELD_CONFLICT"
  | "DELETE_UPDATE"
  | "CREATE_CREATE";
export interface MergeConflict {
  entity_type: import("./constants.js").EntityType;
  record_id: string;
  type: MergeConflictType;
  field?: string;
  base_value?: unknown;
  source_value?: unknown;
  target_value?: unknown;
}
export type MergeResolution =
  | "source"
  | "target"
  | { source: true }
  | { target: true }
  | { custom: unknown };

export type SyncEnvelope = z.infer<typeof SyncEnvelopeSchema>;
