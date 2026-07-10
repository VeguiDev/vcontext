import fs from "node:fs";
import { PID_FILE } from "./paths.js";

export { PID_FILE };

export function readPid() {
  try {
    const value = fs.readFileSync(PID_FILE, "utf-8").trim();
    const pid = Number(value);

    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function runningPid() {
  const pid = readPid();

  if (!pid) {
    return null;
  }

  if (isProcessRunning(pid)) {
    return pid;
  }

  removeStalePid();

  return null;
}

export function removeStalePid() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // Nothing to clean.
  }
}
