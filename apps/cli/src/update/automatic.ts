import type { CliUi } from "../ui/index.js";
import { VCONTEXT_DISTRIBUTION, VCONTEXT_VERSION } from "../version.js";
import {
  checkForUpdates,
  markUpdateNotified,
  shouldNotifyUpdate,
  type UpdateStatus,
} from "./checker.js";
import { checkForNpmUpdates, type NpmUpdateStatus } from "./npm-checker.js";
import { consumePendingUpdateResult } from "./installer.js";

export interface AutomaticUpdateInfo {
  currentVersion: string;
  latestVersion: string;
}

const SKIPPED_COMMANDS = new Set(["daemon", "give-context", "mcp", "update"]);

export function startAutomaticUpdateCheck(
  command: string | undefined,
  ui: CliUi,
): Promise<AutomaticUpdateInfo | null> | null {
  if (!automaticUpdateChecksEnabled(command, ui)) return null;

  if (VCONTEXT_DISTRIBUTION === "npm") {
    return checkForNpmUpdates(VCONTEXT_VERSION)
      .then(
        (status) =>
          status
            ? { currentVersion: status.current, latestVersion: status.latest }
            : null,
      )
      .catch(() => null);
  }

  return checkForUpdates({
    currentVersion: VCONTEXT_VERSION,
    timeoutMs: 1_000,
  }).catch(() => null);
}

export function automaticUpdateChecksEnabled(
  command: string | undefined,
  ui: CliUi,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const isNpm = VCONTEXT_DISTRIBUTION === "npm";
  const isStandalone = environment.VCONTEXT_STANDALONE === "1";
  return Boolean(
    (isNpm || isStandalone) &&
    environment.VCONTEXT_NO_UPDATE_CHECK !== "1" &&
    !environment.NO_UPDATE_NOTIFIER &&
    ui.rich &&
    !ui.options.quiet &&
    !ui.options.help &&
    !ui.options.version &&
    command &&
    !SKIPPED_COMMANDS.has(command),
  );
}

export async function finishAutomaticUpdateCheck(
  pending: Promise<AutomaticUpdateInfo | null> | null,
  ui: CliUi,
): Promise<void> {
  if (!pending) return;
  try {
    const info = await pending;
    if (!info) return;

    if (VCONTEXT_DISTRIBUTION === "npm") {
      ui.updateAvailable(
        info.currentVersion,
        info.latestVersion,
        "npm install -g vcontext@latest",
      );
      return;
    }

    const status = info as UpdateStatus;
    if (!(await shouldNotifyUpdate(status))) return;
    ui.updateAvailable(status.currentVersion, status.latestVersion);
    await markUpdateNotified(status);
  } catch {
    // Automatic checks are best-effort and never alter command behavior.
  }
}

export async function reportPendingUpdateResult(ui: CliUi): Promise<void> {
  if (
    process.env.VCONTEXT_STANDALONE !== "1" ||
    !ui.rich ||
    ui.options.quiet ||
    ui.options.help ||
    ui.options.version
  )
    return;
  const result = await consumePendingUpdateResult();
  if (result) ui.updateResult(result);
}
