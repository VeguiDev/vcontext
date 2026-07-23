import { DaemonClientError } from "@repo/daemon-client";
import { getUi } from "../ui/index.js";
import {
  assertNoArgs,
  emit,
  outputOptions,
  takeOption,
  type OutputOptions,
} from "./common.js";

export interface RemoteCommandDependencies {
  requestValue(method: string, path: string, body?: unknown): Promise<unknown>;
  resolveProjectSlug(input: string[]): Promise<string>;
}

export async function remoteCommand(
  input: string[],
  dependencies: RemoteCommandDependencies,
): Promise<void> {
  const subcommand = input.shift();
  const output = outputOptions(input);
  const projectInput = takeProjectSelector(input);
  const usage =
    "Usage: vcontext remote <add|list|get-url|set-url|remove> [name] [url] [--project slug] [--json|--quiet]";

  if (!subcommand) throw new DaemonClientError(usage, 2);

  if (subcommand === "list") {
    const slug = await dependencies.resolveProjectSlug(projectInput);
    assertNoArgs(input, usage);
    const value = await dependencies.requestValue(
      "GET",
      `/projects/${encodeURIComponent(slug)}/remotes`,
    );
    emit(value, output, printRemoteList);
    return;
  }

  const name = takePositional(input, usage);
  const slugPromise = () => dependencies.resolveProjectSlug(projectInput);
  const remotePath = async () =>
    `/projects/${encodeURIComponent(await slugPromise())}/remotes/${encodeURIComponent(name)}`;

  if (subcommand === "add") {
    const url = takePositional(input, usage);
    const slug = await slugPromise();
    assertNoArgs(input, usage);
    const value = await dependencies.requestValue(
      "POST",
      `/projects/${encodeURIComponent(slug)}/remotes`,
      { name, url },
    );
    emit(value, output, () => getUi().line(`Added remote ${name}: ${url}`));
    return;
  }

  if (subcommand === "get-url") {
    const path = await remotePath();
    assertNoArgs(input, usage);
    const value = await dependencies.requestValue("GET", path);
    emit(value, output, printRemoteUrl);
    return;
  }

  if (subcommand === "set-url") {
    const url = takePositional(input, usage);
    const path = await remotePath();
    assertNoArgs(input, usage);
    const value = await dependencies.requestValue("PATCH", path, { url });
    emit(value, output, () => getUi().line(`Updated remote ${name}: ${url}`));
    return;
  }

  if (subcommand === "remove") {
    if (!getUi().options.yes && !getUi().isTTY)
      throw new DaemonClientError(
        "Removing a remote requires confirmation. Re-run with --yes.",
        10,
      );

    if (
      !getUi().options.yes &&
      !(await getUi().confirm(`Remove remote ${name}?`))
    )
      throw new DaemonClientError("Operation cancelled.", 130);
    const path = await remotePath();
    assertNoArgs(input, usage);
    const value = await dependencies.requestValue("DELETE", path);
    emit(value, output, () => getUi().line(`Removed remote ${name}`));
    return;
  }

  throw new DaemonClientError(usage, 2);
}

function takePositional(input: string[], usage: string): string {
  const value = input[0];
  if (!value || value.startsWith("--")) throw new DaemonClientError(usage, 2);
  input.shift();
  return value;
}

function takeProjectSelector(input: string[]): string[] {
  const project = takeOption(input, "--project") ?? takeOption(input, "--slug");
  return project ? ["--project", project] : [];
}

function printRemoteList(value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (isRemote(item)) getUi().line(`${item.name}\t${item.url}`);
  }
}

function printRemoteUrl(value: unknown): void {
  if (typeof value === "string") getUi().line(value);
  else if (isRemote(value)) getUi().line(value.url);
}

function isRemote(value: unknown): value is { name: string; url: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "url" in value &&
    typeof value.url === "string"
  );
}
