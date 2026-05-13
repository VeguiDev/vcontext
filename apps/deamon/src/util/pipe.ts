import os from "node:os";
import path from "node:path";

export function getSocketPath() {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\vcontext";
  }

  return path.join(os.homedir(), ".vcontext", "vcontext.sock");
}
