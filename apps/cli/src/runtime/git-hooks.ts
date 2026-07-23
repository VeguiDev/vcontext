import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ReadOnlyGitService } from "./git.js";

const HOOKS = [
  "post-checkout",
  "post-commit",
  "post-merge",
  "post-rewrite",
  "pre-push",
] as const;
interface HookState {
  version: 1;
  previous_hooks_path: string | null;
  dispatcher_hash: string;
  hook_hashes: Record<string, string>;
}

export class GitHooksManager {
  readonly git: ReadOnlyGitService;
  readonly gitDir: string;
  readonly hooksDir: string;
  readonly statePath: string;
  constructor(readonly cwd: string) {
    this.git = new ReadOnlyGitService(cwd);
    this.gitDir = this.git.gitDir();
    this.hooksDir = path.join(this.gitDir, "vcontext-hooks");
    this.statePath = path.join(this.gitDir, "vcontext-hooks-state.json");
  }

  install() {
    if (fs.existsSync(this.statePath))
      throw new Error(
        "VContext hooks are already installed; use status or repair",
      );
    const previous = this.readHooksPath();
    fs.mkdirSync(this.hooksDir, { recursive: true });
    const dispatcher = dispatcherSource(previous);
    const dispatcherPath = path.join(this.hooksDir, "dispatcher.cjs");
    fs.writeFileSync(dispatcherPath, dispatcher, { mode: 0o755 });
    const hookHashes: Record<string, string> = {};
    for (const hook of HOOKS) {
      const source = `#!/bin/sh\nexec node "$(dirname "$0")/dispatcher.cjs" ${hook} "$@"\n`;
      const target = path.join(this.hooksDir, hook);
      fs.writeFileSync(target, source, { mode: 0o755 });
      hookHashes[hook] = hash(source);
    }
    const state: HookState = {
      version: 1,
      previous_hooks_path: previous,
      dispatcher_hash: hash(dispatcher),
      hook_hashes: hookHashes,
    };
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2) + "\n");
    this.writeHooksPath(this.hooksDir);
    return this.status();
  }

  status() {
    const state = this.readState();
    if (!state)
      return { installed: false, healthy: false, reason: "state missing" };
    const problems: string[] = [];
    if (
      path.resolve(this.readHooksPath() ?? "") !== path.resolve(this.hooksDir)
    )
      problems.push("core.hooksPath changed externally");
    if (
      fileHash(path.join(this.hooksDir, "dispatcher.cjs")) !==
      state.dispatcher_hash
    )
      problems.push("dispatcher modified");
    for (const hook of HOOKS)
      if (fileHash(path.join(this.hooksDir, hook)) !== state.hook_hashes[hook])
        problems.push(`${hook} modified`);
    return {
      installed: true,
      healthy: problems.length === 0,
      problems,
      previous_hooks_path: state.previous_hooks_path,
      hooks_path: this.hooksDir,
    };
  }

  repair() {
    const state = this.readState();
    if (!state) throw new Error("VContext hook state is missing; run install");
    const dispatcherChanged =
      fileHash(path.join(this.hooksDir, "dispatcher.cjs")) !==
      state.dispatcher_hash;
    const hookChanged = HOOKS.some(
      (hook) =>
        fileHash(path.join(this.hooksDir, hook)) !== state.hook_hashes[hook],
    );
    if (dispatcherChanged || hookChanged)
      throw new Error(
        "Hooks were modified externally; repair refuses to overwrite them. Uninstall and reinstall explicitly.",
      );
    this.writeHooksPath(this.hooksDir);
    return this.status();
  }

  uninstall() {
    const state = this.readState();
    if (!state) return { installed: false };
    const status = this.status() as { healthy: boolean; problems?: string[] };
    if (!status.healthy)
      throw new Error(
        `Hooks were modified externally; refusing uninstall: ${status.problems?.join(", ")}`,
      );
    if (state.previous_hooks_path === null)
      execFileSync("git", ["config", "--local", "--unset", "core.hooksPath"], {
        cwd: this.cwd,
        stdio: "ignore",
      });
    else this.writeHooksPath(state.previous_hooks_path);
    for (const hook of HOOKS) fs.unlinkSync(path.join(this.hooksDir, hook));
    fs.unlinkSync(path.join(this.hooksDir, "dispatcher.cjs"));
    fs.rmdirSync(this.hooksDir);
    fs.unlinkSync(this.statePath);
    return { installed: false, restored_hooks_path: state.previous_hooks_path };
  }

  private readState(): HookState | null {
    try {
      return JSON.parse(fs.readFileSync(this.statePath, "utf8")) as HookState;
    } catch {
      return null;
    }
  }
  private readHooksPath(): string | null {
    try {
      return (
        execFileSync("git", ["config", "--local", "--get", "core.hooksPath"], {
          cwd: this.cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim() || null
      );
    } catch {
      return null;
    }
  }
  private writeHooksPath(value: string) {
    execFileSync("git", ["config", "--local", "core.hooksPath", value], {
      cwd: this.cwd,
      stdio: "ignore",
    });
  }
}

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
function fileHash(file: string) {
  try {
    return hash(fs.readFileSync(file));
  } catch {
    return null;
  }
}
function dispatcherSource(previous: string | null) {
  return `'use strict';\nconst cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');\nconst hook=process.argv[2],args=process.argv.slice(3),input=hook==='pre-push'?fs.readFileSync(0):undefined;\nlet oldCode=0;\nconst previous=${JSON.stringify(previous)};\nif(previous){const root=cp.execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();const base=path.isAbsolute(previous)?previous:path.resolve(root,previous);const old=path.join(base,hook);if(fs.existsSync(old)){const r=cp.spawnSync(old,args,{stdio:[input?'pipe':'inherit','inherit','inherit'],input});oldCode=r.status??1;}}\ntry{cp.spawnSync(process.platform==='win32'?'vcontext.exe':'vcontext',['git','hook-event',hook,...args],{input,stdio:['pipe','ignore','ignore'],timeout:2000});}catch{}\nprocess.exit(oldCode);\n`;
}
