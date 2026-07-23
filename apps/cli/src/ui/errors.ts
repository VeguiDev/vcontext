import { DaemonClientError } from "@repo/daemon-client";
import type { CliErrorData } from "./index.js";

export function errorData(error: unknown): CliErrorData {
  if (error instanceof DaemonClientError) {
    const value = error as DaemonClientError & { code?: string; hint?: string };
    return {
      code:
        value.code ?? (error.exitCode === 2 ? "INVALID_ARGUMENT" : "CLI_ERROR"),
      message: error.message,
      hint: value.hint,
      debug: { stack: error.stack },
    };
  }
  if (error instanceof Error) {
    return {
      code: "UNEXPECTED_ERROR",
      message: "Unexpected error while running vcontext.",
      hint: "Run the command again with --verbose for diagnostic details.",
      debug: { stack: error.stack },
    };
  }
  return {
    code: "UNEXPECTED_ERROR",
    message: String(error),
    hint: "Run the command again with --verbose for diagnostic details.",
  };
}
