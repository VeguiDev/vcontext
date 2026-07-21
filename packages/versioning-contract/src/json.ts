import { createHash } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

function normalizeJson(value: unknown, stack: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON only supports finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON does not support ${typeof value}`);
  }
  if (stack.has(value)) throw new TypeError("Canonical JSON does not support cyclic values");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      const result: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError("Canonical JSON does not support sparse arrays");
        }
        result.push(normalizeJson(value[index], stack));
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON only supports plain objects");
    }
    const record = value as Record<string, unknown>;
    const result: JsonObject = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) throw new TypeError("Canonical JSON does not support undefined values");
      result[key] = normalizeJson(item, stack);
    }
    return result;
  } finally {
    stack.delete(value);
  }
}

/** Deterministic JSON with recursively lexicographically sorted object keys. */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, new Set()));
}

/** SHA-256 as a lowercase, 64-character hexadecimal string. */
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashCanonicalJson(value: unknown): string {
  return sha256(canonicalizeJson(value));
}
