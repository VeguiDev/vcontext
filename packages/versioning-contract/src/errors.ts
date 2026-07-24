import { z } from "zod";

export const SYNC_ERROR_CODES = [
  "INVALID_REQUEST",
  "UNSUPPORTED_PROTOCOL_VERSION",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "PROJECT_NOT_FOUND",
  "REF_NOT_FOUND",
  "OBJECT_NOT_FOUND",
  "HASH_MISMATCH",
  "OBJECT_COLLISION",
  "PROJECT_MISMATCH",
  "INVALID_OBJECT",
  "INVALID_GRAPH",
  "MISSING_OBJECTS",
  "NON_FAST_FORWARD",
  "REF_CONFLICT",
  "BRANCH_PROTECTED",
  "FORCE_NOT_ALLOWED",
  "REQUEST_ID_REUSED",
  "REQUEST_TOO_LARGE",
  "CONTINUATION_INVALID",
  "CONTINUATION_EXPIRED",
  "REMOTE_MOVED",
  "IDENTITY_REQUIRED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export const SyncErrorCodeSchema = z.enum(SYNC_ERROR_CODES);
export type SyncErrorCode = z.infer<typeof SyncErrorCodeSchema>;

export const SyncErrorSchema = z
  .object({
    code: SyncErrorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    retryable: z.boolean().optional(),
  })
  .strict();
export const SyncErrorResponseSchema = z
  .object({ error: SyncErrorSchema })
  .strict();
export type SyncError = z.infer<typeof SyncErrorSchema>;
export type SyncErrorResponse = z.infer<typeof SyncErrorResponseSchema>;

export class VContextSyncError extends Error {
  readonly code: SyncErrorCode;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(error: SyncError, options?: ErrorOptions) {
    super(error.message, options);
    this.name = "VContextSyncError";
    this.code = error.code;
    this.details = error.details;
    this.retryable = error.retryable ?? false;
  }

  toJSON(): SyncErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
        ...(this.retryable ? { retryable: true } : {}),
      },
    };
  }
}
