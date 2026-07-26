export const VERSIONING_CONTRACT_VERSION = "0.1.0" as const;
export const SYNC_PROTOCOL_VERSION = 1 as const;
export const SYNC_PROTOCOL_V2_VERSION = 2 as const;
export const SUPPORTED_SYNC_PROTOCOL_VERSIONS = [1, 2] as const;

export const SYNC_V2_ROUTES = Object.freeze({
  refs: "/api/v1/projects/:projectId/sync/v2/refs",
  fetch: "/api/v1/projects/:projectId/sync/v2/fetch",
  missing: "/api/v1/projects/:projectId/sync/v2/missing",
  push: "/api/v1/projects/:projectId/sync/v2/push",
} as const);

export const ENTITY_TYPES = [
  "project_prompt",
  "document",
  "change_note",
  "task",
  "file_context",
  "file_outside_link",
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

export const SYNC_V2_LIMITS = Object.freeze({
  fetch: Object.freeze({
    max_objects: 500,
    max_snapshot_metadata: 500,
    max_bytes: 8 * 1024 * 1024,
  }),
  missing: Object.freeze({ max_descriptors: 10_000, max_bytes: 2 * 1024 * 1024 }),
  push: Object.freeze({
    max_objects: 500,
    max_snapshot_metadata: 500,
    max_bytes: 8 * 1024 * 1024,
  }),
  continuation_ttl_seconds: 15 * 60,
} as const);

export const DEFAULT_COMPACT_PROMPT_TEMPLATE =
  "Para cada documento: escribí una descripción corta (1 oración), su responsabilidad principal, importancia (ALTA/MEDIA/BAJA), y decisiones de diseño clave. Para cada descriptor de archivo: escribí qué hace, su responsabilidad, importancia, y decisiones. Máximo 200 caracteres por entrada. Priorizá información accionable sobre contexto genérico." as const;
