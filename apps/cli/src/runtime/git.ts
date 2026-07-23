import { execFileSync } from "node:child_process";

type AllowedGitCommand =
  | readonly ["rev-parse", ...string[]]
  | readonly ["symbolic-ref", ...string[]]
  | readonly ["status", "--porcelain"]
  | readonly ["merge-base", ...string[]]
  | readonly ["log", `--format=${string}`, ...string[]];

const ALLOWED = new Set([
  "rev-parse",
  "symbolic-ref",
  "status",
  "merge-base",
  "log",
]);

/** The only generic Git execution surface. It rejects every mutating command. */
export class ReadOnlyGitService {
  constructor(readonly cwd: string) {}

  run(args: AllowedGitCommand): string {
    if (!ALLOWED.has(args[0]))
      throw new Error(`Git command is not read-only: ${args[0]}`);
    if (
      args[0] === "status" &&
      (args.length !== 2 || args[1] !== "--porcelain")
    )
      throw new Error("Only git status --porcelain is allowed");
    if (args[0] === "log" && !args.some((arg) => arg.startsWith("--format=")))
      throw new Error("git log requires --format");
    return execFileSync("git", [...args], {
      cwd: this.cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  }

  gitDir() {
    return this.run(["rev-parse", "--absolute-git-dir"]);
  }
  head() {
    return this.run(["rev-parse", "HEAD"]);
  }
  branch(): string | null {
    try {
      return this.run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    } catch {
      return null;
    }
  }
  dirty() {
    return this.run(["status", "--porcelain"]).length > 0;
  }
  mergeBase(left: string, right: string) {
    return this.run(["merge-base", left, right]);
  }
  commitMessage(sha = "HEAD") {
    return this.run(["log", "--format=%B", "-n", "1", sha]);
  }
}

export function gitRemoteUrl(cwd: string) {
  try {
    // Kept as a narrowly-scoped discovery operation; it never mutates the repo.
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
