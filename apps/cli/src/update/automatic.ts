import type { CliUi } from "../ui/index.js";
import { VCONTEXT_VERSION } from "../version.js";
import {
  checkForUpdates,
  markUpdateNotified,
  shouldNotifyUpdate,
  type UpdateStatus,
} from "./checker.js";
import { consumePendingUpdateResult } from "./installer.js";

const SKIPPED_COMMANDS = new Set(["daemon", "give-context", "mcp", "update"]);

export function startAutomaticUpdateCheck(
  command: string | undefined,
  ui: CliUi,
): Promise<UpdateStatus | null> | null {
  if (!automaticUpdateChecksEnabled(command, ui)) return null;
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
  return Boolean(
    environment.VCONTEXT_STANDALONE === "1" &&
    environment.VCONTEXT_NO_UPDATE_CHECK !== "1" &&
    ui.rich &&
    !ui.options.quiet &&
    !ui.options.help &&
    !ui.options.version &&
    command &&
    !SKIPPED_COMMANDS.has(command),
  );
}

export async function finishAutomaticUpdateCheck(
  pending: Promise<UpdateStatus | null> | null,
  ui: CliUi,
): Promise<void> {
  if (!pending) return;
  try {
    const status = await pending;
    if (!status || !(await shouldNotifyUpdate(status))) return;
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
