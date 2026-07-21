import { DaemonClientError } from "@repo/daemon-client";

export interface OutputOptions {
  json: boolean;
  quiet: boolean;
}

export function takeFlag(input: string[], flag: string): boolean {
  const index = input.indexOf(flag);
  if (index === -1) return false;
  input.splice(index, 1);
  return true;
}

export function takeOption(
  input: string[],
  option: string,
): string | undefined {
  const index = input.indexOf(option);
  if (index === -1) return undefined;
  const value = input[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new DaemonClientError(`Missing value for ${option}`, 2);
  }
  input.splice(index, 2);
  return value;
}

export function outputOptions(input: string[]): OutputOptions {
  const json = takeFlag(input, "--json");
  const quiet = takeFlag(input, "--quiet");
  if (json && quiet) {
    throw new DaemonClientError("--json and --quiet are incompatible", 2);
  }
  return { json, quiet };
}

export function assertNoArgs(input: string[], usage: string): void {
  if (input.length > 0) throw new DaemonClientError(usage, 2);
}

export function emit(
  value: unknown,
  output: OutputOptions,
  human: (value: unknown) => void = printHuman,
): void {
  if (output.quiet) return;
  if (output.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  human(value);
}

function printHuman(value: unknown): void {
  if (typeof value === "string") {
    console.log(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) printHuman(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      console.log(`${key}: ${format(item)}`);
    }
    return;
  }
  console.log(String(value ?? ""));
}

function format(value: unknown): string {
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value ?? "");
}
