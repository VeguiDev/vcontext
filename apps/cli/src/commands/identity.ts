import { DaemonClientError } from "@repo/daemon-client";
import { IdentityStore } from "../runtime/identity.js";
import { emit, outputOptions, takeOption } from "./common.js";
import { renderHeading, renderPairs, renderResult } from "../ui/renderers.js";

export async function identityCommand(
  input: string[],
  resolveOrigin: () => Promise<string | null>,
) {
  const action = input.shift();
  const output = outputOptions(input);
  const origin = takeOption(input, "--host") ?? (await resolveOrigin());
  if (!origin)
    throw new DaemonClientError("No Cloud origin found; pass --host <url>", 2);
  const store = new IdentityStore();
  if (action === "show") {
    const value = store.get(origin);
    if (!value)
      throw new DaemonClientError(
        `No identity stored for ${new URL(origin).origin}`,
        3,
      );
    emit(value, output, (_result, ui) => {
      renderHeading(ui, "Identity");
      renderPairs(ui, [
        ["Name", value.name],
        ["Email", value.email],
        ["Cloud ID", value.cloud_id],
        ["Origin", ui.url(new URL(origin).origin)],
      ]);
    });
    return;
  }
  if (action === "set") {
    const name = takeOption(input, "--name");
    if (!name) throw new DaemonClientError("identity set requires --name", 2);
    const email = takeOption(input, "--email") ?? null;
    const cloudId =
      takeOption(input, "--cloud-id") ?? store.get(origin)?.cloud_id ?? null;
    const value = store.set(origin, { cloud_id: cloudId, name, email });
    emit(value, output, (_result, ui) =>
      renderResult(ui, "Identity saved", [
        ["Name", value.name],
        ["Origin", ui.url(new URL(origin).origin)],
      ]),
    );
    return;
  }
  throw new DaemonClientError(
    "Usage: vcontext identity <show|set> [--host url] [--name name] [--email email]",
    2,
  );
}
