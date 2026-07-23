import { writeDaemonStartError } from "@repo/vcontext-core";
import { AppBoostrap } from "./bootstrap.js";

export async function startDaemon(): Promise<void> {
  try {
    await new AppBoostrap().bootstrap();
  } catch (error) {
    writeDaemonStartError(error);
    throw error;
  }
}
