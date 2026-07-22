import { execFileSync } from "node:child_process";

const ALLOWED = new Set(["rev-parse", "symbolic-ref", "status", "merge-base", "log"]);
export class ReadOnlyGitService {
  constructor(readonly cwd: string) {}
  run(args: string[]) {
    if (!ALLOWED.has(args[0] ?? "")) throw new Error(`Git command is not read-only: ${args[0]}`);
    if (args[0] === "status" && args.join(" ") !== "status --porcelain") throw new Error("Only git status --porcelain is allowed");
    if (args[0] === "log" && !args.some((arg) => arg.startsWith("--format="))) throw new Error("git log requires --format");
    return execFileSync("git", args, { cwd: this.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  }
  head() { return this.run(["rev-parse", "HEAD"]); }
  branch() { try { return this.run(["symbolic-ref", "--quiet", "--short", "HEAD"]); } catch { return null; } }
  dirty() { return this.run(["status", "--porcelain"]).length > 0; }
  message() { return this.run(["log", "--format=%B", "-n", "1", "HEAD"]); }
  mergeBase(left: string, right: string) { return this.run(["merge-base", left, right]); }
}
