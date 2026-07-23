import { DaemonClientError, rawRequest } from "@repo/daemon-client";
import { isProcessRunning, readPid, removeStalePid } from "@repo/vcontext-core";
import { assertNoArgs, emit, outputOptions, takeFlag } from "./common.js";
import { getUi } from "../ui/index.js";
import { renderResult } from "../ui/renderers.js";
import { checkForUpdates, type UpdateStatus } from "../update/checker.js";
import {
  installUpdate,
  type InstallUpdateResult,
} from "../update/installer.js";
import { VCONTEXT_VERSION } from "../version.js";

export interface UpdateCommandDependencies {
  currentVersion?: string;
  standalone?: boolean;
  check?: () => Promise<UpdateStatus | null>;
  install?: (status: UpdateStatus) => Promise<InstallUpdateResult>;
}

export async function updateCommand(
  input: string[],
  dependencies: UpdateCommandDependencies = {},
): Promise<void> {
  const checkOnly = takeFlag(input, "--check");
  const output = outputOptions(input);
  assertNoArgs(
    input,
    "Usage: vcontext update [--check] [--yes] [--json|--quiet]",
  );
  const currentVersion = dependencies.currentVersion ?? VCONTEXT_VERSION;
  const standalone =
    dependencies.standalone ?? process.env.VCONTEXT_STANDALONE === "1";

  if (!checkOnly && !standalone) {
    throw new DaemonClientError(
      "Self-update is only available in the official standalone binary.",
      1,
      undefined,
      {
        code: "UPDATE_UNSUPPORTED",
        hint:
          getUi().commandName === "vcontext-dev"
            ? "Build or install the standalone CLI to test self-update; the development repository was not modified."
            : "Re-run the official installer to update this installation.",
      },
    );
  }

  const status = await getUi().run("Checking for updates", async () => {
    try {
      return await (dependencies.check?.() ??
        checkForUpdates({
          currentVersion,
          force: true,
          timeoutMs: 15_000,
        }));
    } catch (error) {
      throw updateError(
        "UPDATE_CHECK_FAILED",
        "Could not check for updates.",
        "Check your internet connection and try again.",
        error,
      );
    }
  });
  if (!status)
    throw new DaemonClientError("Could not resolve the latest release.", 1);

  const payload = publicStatus(status);
  if (checkOnly) {
    emit(payload, output, (_value, ui) =>
      renderResult(
        ui,
        status.updateAvailable ? "Update available" : "vcontext is up to date",
        [
          ["Current", status.currentVersion],
          ["Latest", status.latestVersion],
          ["Release", ui.url(status.releaseUrl)],
        ],
      ),
    );
    return;
  }

  if (!status.updateAvailable) {
    emit(payload, output, (_value, ui) =>
      ui.success(`vcontext ${status.currentVersion} is up to date`),
    );
    return;
  }

  if (!getUi().options.yes) {
    if (!getUi().isTTY)
      throw new DaemonClientError(
        "Updating vcontext requires confirmation.",
        10,
        undefined,
        {
          code: "CONFIRMATION_REQUIRED",
          hint: "Re-run the command with `--yes`.",
        },
      );
    const accepted = await getUi().confirm(
      `Update vcontext ${status.currentVersion} → ${status.latestVersion}?`,
    );
    if (!accepted) {
      if (!output.quiet) getUi().note("Update cancelled");
      return;
    }
  }

  const result = await getUi().run(
    "Downloading and verifying update",
    async () => {
      try {
        return await (dependencies.install?.(status) ??
          installUpdate({
            release: status.release,
            currentVersion: status.currentVersion,
            beforeReplace: stopDaemonForUpdate,
          }));
      } catch (error) {
        throw updateError(
          "UPDATE_INSTALL_FAILED",
          "Could not install the update.",
          "The current executable was left unchanged. Re-run the official installer if the problem continues.",
          error,
        );
      }
    },
  );

  emit(
    {
      updated: result.updated,
      scheduled: result.scheduled,
      previousVersion: result.previousVersion,
      currentVersion: result.currentVersion,
      targetPath: result.targetPath,
    },
    output,
    (_value, ui) => {
      if (result.scheduled) {
        ui.success(`vcontext ${result.currentVersion} is ready to install`);
        ui.note("The update will finish after this command exits.");
      } else {
        ui.success(
          `Updated vcontext ${result.previousVersion} → ${result.currentVersion}`,
        );
      }
    },
  );
}

export async function stopDaemonForUpdate(): Promise<void> {
  const pid = readPid();
  if (!pid || !isProcessRunning(pid)) {
    removeStalePid();
    return;
  }
  try {
    await rawRequest("POST", "/daemon/stop");
  } catch {
    process.kill(pid, "SIGTERM");
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isProcessRunning(pid)) {
      removeStalePid();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Daemon PID ${pid} did not stop within 10 seconds.`);
}

function publicStatus(status: UpdateStatus) {
  return {
    currentVersion: status.currentVersion,
    latestVersion: status.latestVersion,
    updateAvailable: status.updateAvailable,
    releaseUrl: status.releaseUrl,
  };
}

function updateError(
  code: string,
  message: string,
  hint: string,
  cause: unknown,
) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  return new DaemonClientError(message, 1, error, {
    code,
    hint,
    details: { note: error.message },
  });
}
