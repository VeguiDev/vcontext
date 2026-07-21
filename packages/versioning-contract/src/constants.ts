export const VERSIONING_CONTRACT_VERSION = "0.1.0" as const;
export const SYNC_PROTOCOL_VERSION = 1 as const;

export const ENTITY_TYPES = [
  "project_prompt",
  "document",
  "change_note",
  "task",
  "file_context",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];
export type TaskStatus =
  | "BACKLOG"
  | "RUNNING"
  | "COMPLETED"
  | "CANCELLED";
export type FileContextKind = "file" | "directory" | "path";

export const SYNC_LIMITS = Object.freeze({
  fetch: Object.freeze({ max_objects: 500, max_bytes: 8 * 1024 * 1024 }),
  missing: Object.freeze({ max_descriptors: 10_000, max_bytes: 2 * 1024 * 1024 }),
  push: Object.freeze({ max_objects: 500, max_bytes: 8 * 1024 * 1024 }),
  continuation_ttl_seconds: 15 * 60,
  access_token_ttl_seconds: 60 * 60,
  refresh_token_ttl_seconds: 30 * 24 * 60 * 60,
  personal_alias_ttl_seconds: 90 * 24 * 60 * 60,
  username_cooldown_seconds: 30 * 24 * 60 * 60,
} as const);
