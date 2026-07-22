import fs from "node:fs";
import path from "node:path";
import { VCONTEXT_HOME } from "@repo/vcontext-core";

export interface LocalIdentity { cloud_id: string | null; name: string; email: string | null; updated_at: string; }
type IdentityFile = { version: 1; origins: Record<string, LocalIdentity> };

export class IdentityStore {
  readonly file = path.join(VCONTEXT_HOME, "identities.json");
  get(origin: string) { return this.read().origins[new URL(origin).origin] ?? null; }
  set(origin: string, identity: Omit<LocalIdentity, "updated_at">) {
    const current = this.read();
    current.origins[new URL(origin).origin] = { ...identity, updated_at: new Date().toISOString() };
    fs.mkdirSync(VCONTEXT_HOME, { recursive: true });
    const stage = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(stage, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(stage, this.file);
    return current.origins[new URL(origin).origin]!;
  }
  private read(): IdentityFile { try { const value = JSON.parse(fs.readFileSync(this.file, "utf8")) as IdentityFile; return value.version === 1 && value.origins ? value : { version: 1, origins: {} }; } catch { return { version: 1, origins: {} }; } }
}
