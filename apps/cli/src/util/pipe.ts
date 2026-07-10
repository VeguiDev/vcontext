import path from "node:path";
import { VCONTEXT_HOME } from "../runtime/paths.js";

export function getSocketPath() {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\vcontext";
  }

  return path.join(VCONTEXT_HOME, "vcontext.sock");
}
