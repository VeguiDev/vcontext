import fs from "node:fs";
import path from "node:path";
import { DaemonClientError } from "@repo/daemon-client";
import { VCONTEXT_HOME } from "@repo/vcontext-core";
import { IdentityStore } from "../runtime/identity.js";
import { emit, outputOptions, takeFlag, takeOption } from "./common.js";
import { getUi } from "../ui/index.js";
import { renderHeading, renderPairs, renderResult } from "../ui/renderers.js";

const GLOBAL_IDENTITY_FILE = path.join(VCONTEXT_HOME, "global-identity.json");

interface GlobalIdentityData {
  name: string;
  email: string | null;
  updated_at: string;
}

function readGlobalIdentity(): GlobalIdentityData | null {
  try {
    const data = JSON.parse(
      fs.readFileSync(GLOBAL_IDENTITY_FILE, "utf8"),
    ) as GlobalIdentityData;
    return data.name ? data : null;
  } catch {
    return null;
  }
}

function writeGlobalIdentity(
  name: string,
  email: string | null,
): GlobalIdentityData {
  const data: GlobalIdentityData = {
    name,
    email,
    updated_at: new Date().toISOString(),
  };
  fs.mkdirSync(VCONTEXT_HOME, { recursive: true });
  const tmp = `${GLOBAL_IDENTITY_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, GLOBAL_IDENTITY_FILE);
  return data;
}

export async function identityCommand(
  input: string[],
  resolveOrigin: () => Promise<string | null>,
) {
  const isGlobal = takeFlag(input, "--global");
  const action = input.shift();
  const output = outputOptions(input);

  if (action === undefined) {
    const ui = getUi();
    if (!ui.isTTY) {
      throw new DaemonClientError(
        "Usage: vcontext identity <show|set> [--host url] [--name name] [--email email] [--global]",
        2,
      );
    }
    const name = await ui.textInput("Name:", { defaultValue: "" });
    if (!name) throw new DaemonClientError("Name is required", 2);
    const email = await ui.textInput("Email:", { defaultValue: "" });

    if (isGlobal) {
      const saved = writeGlobalIdentity(name, email || null);
      emit(saved, output, (_result, ui) =>
        renderResult(ui, "Global identity saved", [
          ["Name", saved.name],
          ["Email", saved.email ?? "(none)"],
        ]),
      );
    } else {
      const origin = takeOption(input, "--host") ?? (await resolveOrigin());
      if (!origin)
        throw new DaemonClientError(
          "No Cloud origin found; pass --host <url>",
          2,
        );
      const store = new IdentityStore();
      const cloudId = store.get(origin)?.cloud_id ?? null;
      const saved = store.set(origin, {
        cloud_id: cloudId,
        name,
        email: email || null,
      });
      emit(saved, output, (_result, ui) =>
        renderResult(ui, "Identity saved", [
          ["Name", saved.name],
          ["Origin", ui.url(new URL(origin).origin)],
        ]),
      );
    }
    return;
  }

  const origin = takeOption(input, "--host") ?? (await resolveOrigin());
  if (!origin)
    throw new DaemonClientError("No Cloud origin found; pass --host <url>", 2);
  const store = new IdentityStore();

  if (action === "show") {
    if (isGlobal) {
      const globalData = readGlobalIdentity();
      if (!globalData) {
        throw new DaemonClientError("No global identity stored", 3);
      }
      emit(globalData, output, (_result, ui) => {
        renderHeading(ui, "Global Identity");
        renderPairs(ui, [
          ["Name", globalData.name],
          ["Email", globalData.email ?? "(none)"],
        ]);
      });
      return;
    }
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
    if (isGlobal) {
      const saved = writeGlobalIdentity(name, email);
      emit(saved, output, (_result, ui) =>
        renderResult(ui, "Global identity saved", [
          ["Name", saved.name],
          ["Email", saved.email ?? "(none)"],
        ]),
      );
      return;
    }
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
    "Usage: vcontext identity [show|set] [--host url] [--name name] [--email email] [--global]",
    2,
  );
}
