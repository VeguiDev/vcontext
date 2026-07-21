import { Entry } from "@napi-rs/keyring";
import {
  FetchResponseSchema,
  MissingResponseSchema,
  PushResponseSchema,
  RefsResponseSchema,
  SyncErrorResponseSchema,
  VContextSyncError,
  type FetchRequest,
  type MissingRequest,
  type PushRequest,
} from "@vcontext/versioning-contract";

const KEYRING_SERVICE = "vcontext-cli";

export interface RemoteCredential {
  version: 1;
  origin: string;
  api_origin: string;
  token_endpoint: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
}

export interface RemoteCredentialProvider {
  get(origin: string): Promise<RemoteCredential | null>;
  set(origin: string, value: RemoteCredential): Promise<void>;
}

export class KeyringRemoteCredentialProvider implements RemoteCredentialProvider {
  async get(origin: string) {
    try {
      const value = new Entry(KEYRING_SERVICE, new URL(origin).origin).getPassword();
      if (value === null) return null;
      return JSON.parse(value) as RemoteCredential;
    } catch (error) {
      if (/not found|no entry|no password/i.test(error instanceof Error ? error.message : String(error))) return null;
      throw new Error(`Could not read VContext credentials: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async set(origin: string, value: RemoteCredential) {
    new Entry(KEYRING_SERVICE, new URL(origin).origin).setPassword(JSON.stringify(value));
  }
}

export interface RemoteClientOptions {
  fetch?: typeof globalThis.fetch;
  credentials?: RemoteCredentialProvider;
  now?: () => number;
}

export class RemoteRepositoryClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly credentials: RemoteCredentialProvider;
  private readonly now: () => number;
  readonly endpoint: string;
  readonly origin: string;

  constructor(readonly remoteUrl: string, options: RemoteClientOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.credentials = options.credentials ?? new KeyringRemoteCredentialProvider();
    this.now = options.now ?? Date.now;
    const parsed = new URL(remoteUrl);
    this.origin = parsed.origin;
    this.endpoint = syncEndpoint(parsed);
  }

  async refs() {
    return RefsResponseSchema.parse(await this.request(""));
  }

  async fetch(input: FetchRequest) {
    return FetchResponseSchema.parse(await this.request("/fetch", input));
  }

  async missing(input: MissingRequest) {
    return MissingResponseSchema.parse(await this.request("/missing", input));
  }

  async push(input: PushRequest) {
    return PushResponseSchema.parse(await this.request("/push", input));
  }

  private async request(path: string, body?: unknown) {
    const url = new URL(this.endpoint + path);
    const credential = await this.authorizedCredential(url.origin);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: body === undefined ? "GET" : "POST",
        redirect: "manual",
        headers: {
          accept: "application/json",
          ...(body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...(credential
            ? { authorization: `Bearer ${credential.access_token}` }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new VContextSyncError(
        {
          code: "INTERNAL_ERROR",
          message: `Could not connect to remote ${url.origin}`,
          retryable: true,
        },
        { cause: error },
      );
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      throw new VContextSyncError({
        code: "REMOTE_MOVED",
        message: "The repository moved to a new URL",
        details: location ? { location: new URL(location, url).toString() } : undefined,
      });
    }
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = SyncErrorResponseSchema.safeParse(value);
      if (parsed.success) throw new VContextSyncError(parsed.data.error);
      throw new VContextSyncError({ code: response.status === 401 ? "UNAUTHENTICATED" : "INTERNAL_ERROR", message: `Remote returned HTTP ${response.status}` });
    }
    return value;
  }

  private async authorizedCredential(apiOrigin: string) {
    let credential = await this.credentials.get(this.origin);
    if (!credential) return null;
    if (new URL(credential.api_origin).origin !== apiOrigin) {
      throw new VContextSyncError({ code: "FORBIDDEN", message: "Credential API origin does not match the remote endpoint" });
    }
    if (Date.parse(credential.expires_at) > this.now() + 30_000) return credential;
    if (Date.parse(credential.refresh_expires_at) <= this.now()) throw new VContextSyncError({ code: "UNAUTHENTICATED", message: "VContext login expired; run vcontext auth login" });
    const response = await this.fetcher(credential.token_endpoint, {
      method: "POST", redirect: "manual",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: "vcontext-cli", refresh_token: credential.refresh_token }),
    });
    const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number };
    if (!response.ok || !token.access_token || !token.refresh_token || !token.expires_in) throw new VContextSyncError({ code: "UNAUTHENTICATED", message: "Could not refresh VContext credentials" });
    credential = {
      ...credential,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: new Date(this.now() + token.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(this.now() + (token.refresh_token_expires_in ?? 30 * 86400) * 1000).toISOString(),
    };
    await this.credentials.set(this.origin, credential);
    return credential;
  }
}

function syncEndpoint(url: URL) {
  if (url.username || url.password || url.search || url.hash) {
    throw invalidRemoteUrl();
  }

  const parts = url.pathname.split("/").filter(Boolean);
  let namespace: string;
  let project: string;

  if (parts.length === 2) {
    [namespace, project] = parts as [string, string];
  } else if (
    (parts.length === 5 || parts.length === 7) &&
    parts[0] === "api" &&
    parts[1] === "v1" &&
    parts[2] === "repos" &&
    (parts.length === 5 || (parts[5] === "sync" && parts[6] === "v1"))
  ) {
    namespace = parts[3]!;
    project = parts[4]!;
  } else {
    throw invalidRemoteUrl();
  }

  try {
    namespace = encodeURIComponent(decodeURIComponent(namespace));
    project = encodeURIComponent(decodeURIComponent(project));
  } catch {
    throw invalidRemoteUrl();
  }

  return new URL(
    `/api/v1/repos/${namespace}/${project}/sync/v1`,
    url.origin,
  ).toString();
}

function invalidRemoteUrl() {
  return new VContextSyncError({
    code: "INVALID_REQUEST",
    message:
      "Remote URL must be /<namespace>/<project>, /api/v1/repos/<namespace>/<project>, or the full /sync/v1 endpoint",
  });
}
