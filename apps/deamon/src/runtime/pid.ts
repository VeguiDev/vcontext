import fs from "node:fs";
import { VCONTEXT_HOME } from "../storage/paths.js";
import path from "node:path";

export const PID_FILE = path.join(VCONTEXT_HOME, "vcontext.pid");

export function readPid() {
  try {
    const value = fs.readFileSync(PID_FILE, "utf-8").trim();
    const pid = Number(value);

    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function writePid(pid = process.pid) {
  fs.mkdirSync(VCONTEXT_HOME, { recursive: true });
  fs.writeFileSync(PID_FILE, `${pid}\n`);
}

export function removePid(pid = process.pid) {
  if (readPid() !== pid) {
    return;
  }

  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // The daemon may be shutting down after the file was already removed.
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
