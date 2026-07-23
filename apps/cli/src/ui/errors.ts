import { DaemonClientError } from "@repo/daemon-client";
import type { CliErrorData } from "./index.js";

export function errorData(
  error: unknown,
  commandName = process.env.VCONTEXT_CLI_NAME?.trim() || "vcontext",
): CliErrorData {
  if (error instanceof DaemonClientError) {
    const normalized = normalizeMessage(error.message);
    const details = record(error.details);
    const rawHint =
      error.hint ?? stringDetail(details, "hint") ?? normalized.hint;
    const hint = rawHint
      ? rewriteCommandReferences(rawHint, commandName)
      : undefined;
    const notes = [
      stringDetail(details, "note"),
      ...arrayDetail(details, "notes"),
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => rewriteCommandReferences(value, commandName));
    return {
      code:
        error.code ??
        normalized.code ??
        (error.exitCode === 2 ? "INVALID_ARGUMENT" : "CLI_ERROR"),
      message: rewriteCommandReferences(normalized.message, commandName),
      status: error.status ?? normalized.status,
      ...(hint ? { hint } : {}),
      ...(notes.length ? { notes } : {}),
      ...(details ? { details } : {}),
      debug: { stack: error.stack },
    };
  }
  if (error instanceof Error) {
    return {
      code: "UNEXPECTED_ERROR",
      message: `Unexpected error while running ${commandName}.`,
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

function normalizeMessage(message: string): {
  message: string;
  code?: string;
  status?: number;
  hint?: string;
} {
  const legacyApi = message.match(
    /^API error (\d+)(?:: ([A-Z][A-Z0-9_]*))?(?:: (.*))?$/,
  );
  if (legacyApi) {
    const status = Number(legacyApi[1]);
    const normalized = splitHint(
      legacyApi[3] ?? `Request failed with HTTP ${status}.`,
    );
    return {
      ...normalized,
      status,
      ...(legacyApi[2] ? { code: legacyApi[2] } : {}),
    };
  }
  return splitHint(message);
}

function splitHint(message: string): { message: string; hint?: string } {
  const match = message.match(
    /^(.*?)(?:[.;]\s+|\s+)((?:run|re-run|pass|authenticate)\b.*)$/i,
  );
  if (!match) return { message };
  return {
    message: match[1]!.trim().replace(/[.;]$/, ""),
    hint: match[2]!.trim(),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringDetail(
  details: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = details?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayDetail(
  details: Record<string, unknown> | null,
  key: string,
): string[] {
  const value = details?.[key];
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && Boolean(entry.trim()),
      )
    : [];
}

function rewriteCommandReferences(value: string, commandName: string): string {
  if (commandName === "vcontext") return value;
  return value
    .replace(/`vcontext(?=[\s`])/g, `\`${commandName}`)
    .replace(/(^|\n)(Usage:\s+)vcontext(?=\s)/g, `$1$2${commandName}`)
    .replace(
      /\b((?:re-)?run\s+)vcontext(?=\s)/gi,
      (_match, prefix: string) => `${prefix}${commandName}`,
    );
}
