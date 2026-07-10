import { execFileSync } from "node:child_process";

export function gitRemoteUrl(cwd: string) {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
