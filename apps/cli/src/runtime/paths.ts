import os from "node:os";
import path from "node:path";

export const VCONTEXT_HOME =
  process.env.VCONTEXT_HOME ?? path.join(os.homedir(), ".vcontext");

export const PID_FILE = path.join(VCONTEXT_HOME, "vcontext.pid");
