export type ApplicationErrorCode =
  | "PROJECT_NOT_FOUND"
  | "BRANCH_NOT_FOUND"
  | "SNAPSHOT_NOT_FOUND"
  | "RECORD_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "MERGE_CONFLICT"
  | "MIGRATION_ERROR"
  | "DATABASE_ERROR";

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly details?: unknown,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export const applicationErrorStatus: Record<ApplicationErrorCode, number> = {
  PROJECT_NOT_FOUND: 404,
  BRANCH_NOT_FOUND: 404,
  SNAPSHOT_NOT_FOUND: 404,
  RECORD_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  MERGE_CONFLICT: 409,
  MIGRATION_ERROR: 409,
  DATABASE_ERROR: 500,
};
