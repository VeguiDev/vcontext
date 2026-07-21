import { DaemonClientError } from "@repo/daemon-client";

export const VCONTEXT_KEYRING_SERVICE = "vcontext-cli";

export interface StoredCredential {
  version: 1;
  origin: string;
  api_origin: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_at: string;
  refresh_expires_at: string;
}

export interface CredentialStore {
  get(origin: string): Promise<StoredCredential | null>;
  set(origin: string, credential: StoredCredential): Promise<void>;
  delete(origin: string): Promise<void>;
}

export function credentialAccount(origin: string): string {
  return normalizeOrigin(origin);
}

export class SystemKeyringCredentialStore implements CredentialStore {
  async get(origin: string): Promise<StoredCredential | null> {
    const entry = await this.entry(origin);
    let encoded: string | null;
    try {
      encoded = entry.getPassword();
    } catch (error) {
      if (isMissingCredential(error)) return null;
      throw keyringError("read", error);
    }
    if (encoded === null) return null;
    try {
      return parseCredential(JSON.parse(encoded));
    } catch (error) {
      throw new DaemonClientError(
        `Credential in the system keyring is invalid for ${normalizeOrigin(origin)}`,
        1,
        error instanceof Error ? error : undefined,
      );
    }
  }

  async set(origin: string, credential: StoredCredential): Promise<void> {
    try {
      (await this.entry(origin)).setPassword(JSON.stringify(credential));
    } catch (error) {
      throw keyringError("store", error);
    }
  }

  async delete(origin: string): Promise<void> {
    try {
      (await this.entry(origin)).deletePassword();
    } catch (error) {
      if (!isMissingCredential(error)) throw keyringError("delete", error);
    }
  }

  private async entry(origin: string) {
    try {
      const { Entry } = await import("@napi-rs/keyring");
      return new Entry(VCONTEXT_KEYRING_SERVICE, credentialAccount(origin));
    } catch (error) {
      throw new DaemonClientError(
        "The operating-system keyring is unavailable; credentials were not stored.",
        1,
        error instanceof Error ? error : undefined,
      );
    }
  }
}

export function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch (error) {
    throw new DaemonClientError(
      `Invalid VContext host: ${value}`,
      2,
      error as Error,
    );
  }
  if (url.protocol !== "https:" && !isLoopbackHttp(url)) {
    throw new DaemonClientError(
      "VContext hosts must use HTTPS (HTTP is allowed only for loopback development).",
      2,
    );
  }
  return url.origin;
}

function isLoopbackHttp(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}

function parseCredential(value: unknown): StoredCredential {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("origin" in value) ||
    typeof value.origin !== "string" ||
    !("api_origin" in value) ||
    typeof value.api_origin !== "string" ||
    !("authorization_endpoint" in value) ||
    typeof value.authorization_endpoint !== "string" ||
    !("token_endpoint" in value) ||
    typeof value.token_endpoint !== "string" ||
    !("access_token" in value) ||
    typeof value.access_token !== "string" ||
    !("refresh_token" in value) ||
    typeof value.refresh_token !== "string" ||
    !("expires_at" in value) ||
    typeof value.expires_at !== "string" ||
    !("refresh_expires_at" in value) ||
    typeof value.refresh_expires_at !== "string"
  ) {
    throw new Error("Invalid credential shape");
  }
  return value as StoredCredential;
}

function isMissingCredential(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|no entry|no matching|item.*exist/i.test(message);
}

function keyringError(action: string, error: unknown): DaemonClientError {
  return new DaemonClientError(
    `Could not ${action} credentials in the operating-system keyring. No plaintext fallback is allowed.`,
    1,
    error instanceof Error ? error : undefined,
  );
}
