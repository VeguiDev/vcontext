import { DaemonClientError } from "@repo/daemon-client";
import { getUi, type CliUi } from "../ui/index.js";

export interface OutputOptions {
  json: boolean;
  quiet: boolean;
}
export type HumanRenderer = (value: unknown, ui: CliUi) => void;

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
  if (value === undefined || value.startsWith("--"))
    throw new DaemonClientError(`Missing value for ${option}`, 2);
  input.splice(index, 2);
  return value;
}

export function outputOptions(input: string[]): OutputOptions {
  const ui = getUi();
  const json = takeFlag(input, "--json") || ui.options.json;
  const quiet = takeFlag(input, "--quiet") || ui.options.quiet;
  if (json && quiet)
    throw new DaemonClientError("--json and --quiet are incompatible", 2);
  return { json, quiet };
}

export function assertNoArgs(input: string[], usage: string): void {
  if (input.length > 0) throw new DaemonClientError(usage, 2);
}

export function emit(
  value: unknown,
  output: OutputOptions,
  human: HumanRenderer = () => {},
): void {
  if (output.quiet) return;
  if (output.json) {
    getUi().json(value);
    return;
  }
  human(value, getUi());
}
