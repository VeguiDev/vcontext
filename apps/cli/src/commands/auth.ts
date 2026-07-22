import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { DaemonClientError } from "@repo/daemon-client";
import {
  DiscoveryDocumentSchema,
  TokenResponseSchema,
  type DiscoveryDocument,
  type TokenResponse,
} from "@vcontext/versioning-contract";
import {
  SystemKeyringCredentialStore,
  normalizeOrigin,
  type CredentialStore,
  type StoredCredential,
} from "../auth/credentials.js";
import { assertNoArgs, emit, outputOptions, takeOption } from "./common.js";
import { IdentityStore } from "../runtime/identity.js";

const CLIENT_ID = "vcontext-cli";

export interface AuthorizationInput {
  authorizationEndpoint: string;
  clientId: string;
  state: string;
  codeChallenge: string;
}

export interface AuthorizationResult {
  code: string;
  redirectUri: string;
}

export interface OAuthAuthorizer {
  authorize(input: AuthorizationInput): Promise<AuthorizationResult>;
}

export interface AuthCommandDependencies {
  credentials?: CredentialStore;
  authorizer?: OAuthAuthorizer;
  fetch?: typeof globalThis.fetch;
  resolveCurrentOrigin(): Promise<string | null>;
  now?: () => number;
}

export async function authCommand(
  input: string[],
  dependencies: AuthCommandDependencies,
): Promise<void> {
  const subcommand = input.shift();
  const output = outputOptions(input);
  const host = takeOption(input, "--host");
  const clientId = takeOption(input, "--client-id") ?? CLIENT_ID;
  const usage =
    "Usage: vcontext auth <login|logout|status> [--host url] [--json|--quiet]";
  if (!subcommand || !["login", "logout", "status"].includes(subcommand)) {
    throw new DaemonClientError(usage, 2);
  }
  if (subcommand !== "login" && clientId !== CLIENT_ID) {
    throw new DaemonClientError("--client-id is only valid for auth login", 2);
  }
  assertNoArgs(input, usage);

  const resolved = host ?? (await dependencies.resolveCurrentOrigin());
  if (!resolved) {
    throw new DaemonClientError(
      "No project remote found. Pass --host <url> when logging in outside a project.",
      2,
    );
  }
  const origin = normalizeOrigin(resolved);
  const credentials =
    dependencies.credentials ?? new SystemKeyringCredentialStore();
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;

  if (subcommand === "login") {
    const discovery = await discover(origin, fetcher);
    const { verifier, challenge } = createPkcePair();
    const state = randomBase64Url(32);
    const authorization = await (
      dependencies.authorizer ?? new LoopbackOAuthAuthorizer()
    ).authorize({
      authorizationEndpoint: discovery.authorization_endpoint,
      clientId,
      state,
      codeChallenge: challenge,
    });
    const token = await tokenRequest(discovery.token_endpoint, fetcher, {
      grant_type: "authorization_code",
      code: authorization.code,
      redirect_uri: authorization.redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    const timestamp = now();
    const credential: StoredCredential = {
      version: 1,
      origin,
      api_origin: new URL(discovery.api_endpoint).origin,
      authorization_endpoint: discovery.authorization_endpoint,
      token_endpoint: discovery.token_endpoint,
      revocation_endpoint: discovery.revocation_endpoint,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_type: "Bearer",
      expires_at: new Date(timestamp + token.expires_in * 1_000).toISOString(),
      refresh_expires_at: new Date(
        timestamp + token.refresh_token_expires_in * 1_000,
      ).toISOString(),
    };
    await credentials.set(origin, credential);
    await refreshIdentity(discovery.api_endpoint, credential.access_token, fetcher, origin);
    emit(authStatusValue(credential, timestamp), output, () =>
      console.log(`Logged in to ${origin}`),
    );
    return;
  }

  let credential = await credentials.get(origin);
  if (subcommand === "status") {
    if (!credential) {
      emit({ authenticated: false, origin }, output, () =>
        console.log(`Not logged in to ${origin}`),
      );
      return;
    }
    credential = await refreshIfNeeded(credential, credentials, fetcher, now());
    emit(authStatusValue(credential, now()), output, (value) => {
      const status = value as ReturnType<typeof authStatusValue>;
      console.log(`Logged in to ${status.origin}`);
      console.log(`Access token expires at ${status.expires_at}`);
    });
    return;
  }

  if (credential?.revocation_endpoint) {
    await revoke(
      credential.revocation_endpoint,
      credential.refresh_token,
      fetcher,
    );
  }
  await credentials.delete(origin);
  emit({ authenticated: false, origin }, output, () =>
    console.log(`Logged out from ${origin}`),
  );
}

async function refreshIdentity(apiEndpoint: string, token: string, fetcher: typeof globalThis.fetch, origin: string) {
  const response = await fetcher(new URL("auth/cli/me", apiEndpoint.endsWith("/") ? apiEndpoint : `${apiEndpoint}/`).toString(), {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
    redirect: "manual",
  });
  if (!response.ok) return;
  const value = await response.json() as { id?: string; cloud_id?: string; name?: string; email?: string | null };
  if (typeof value.name !== "string") return;
  new IdentityStore().set(origin, { cloud_id: value.cloud_id ?? value.id ?? null, name: value.name, email: value.email ?? null });
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBase64Url(64);
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export class LoopbackOAuthAuthorizer implements OAuthAuthorizer {
  async authorize(input: AuthorizationInput): Promise<AuthorizationResult> {
    return new Promise<AuthorizationResult>((resolve, reject) => {
      const server = http.createServer((request, response) => {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
        if (requestUrl.pathname !== "/callback") {
          response.writeHead(404).end("Not found");
          return;
        }
        const returnedState = requestUrl.searchParams.get("state");
        const code = requestUrl.searchParams.get("code");
        const oauthError = requestUrl.searchParams.get("error");
        if (returnedState !== input.state || !code || oauthError) {
          response.writeHead(400, {
            "content-type": "text/plain; charset=utf-8",
          });
          response.end("VContext login failed. You may close this window.");
          finish(new DaemonClientError(oauthError ?? "Invalid OAuth callback"));
          return;
        }
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("VContext login complete. You may close this window.");
        finish(undefined, { code, redirectUri });
      });
      const timeout = setTimeout(
        () =>
          finish(new DaemonClientError("Timed out waiting for browser login")),
        5 * 60 * 1_000,
      );
      timeout.unref();
      let redirectUri = "";
      let settled = false;
      const finish = (error?: Error, result?: AuthorizationResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.close();
        if (error) reject(error);
        else resolve(result!);
      };
      server.once("error", finish);
      server.listen(0, "127.0.0.1", async () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          finish(
            new DaemonClientError(
              "Could not start the OAuth callback listener",
            ),
          );
          return;
        }
        redirectUri = `http://127.0.0.1:${address.port}/callback`;
        const authorizationUrl = new URL(input.authorizationEndpoint);
        authorizationUrl.searchParams.set("response_type", "code");
        authorizationUrl.searchParams.set("client_id", input.clientId);
        authorizationUrl.searchParams.set("redirect_uri", redirectUri);
        authorizationUrl.searchParams.set("state", input.state);
        authorizationUrl.searchParams.set(
          "code_challenge",
          input.codeChallenge,
        );
        authorizationUrl.searchParams.set("code_challenge_method", "S256");
        try {
          await openExternal(authorizationUrl.toString());
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
}

async function discover(
  origin: string,
  fetcher: typeof globalThis.fetch,
): Promise<DiscoveryDocument> {
  const response = await fetchManual(
    new URL("/.well-known/vcontext", origin).toString(),
    { headers: { accept: "application/json" } },
    fetcher,
  );
  const value: unknown = await response.json();
  if (!response.ok) throw remoteHttpError("Discovery", response.status, value);
  const parsed = DiscoveryDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new DaemonClientError(
      `Invalid VContext discovery document: ${parsed.error.message}`,
    );
  }
  enforceCredentialEndpointOrigins(parsed.data);
  return parsed.data;
}

function enforceCredentialEndpointOrigins(discovery: DiscoveryDocument): void {
  normalizeOrigin(discovery.api_endpoint);
  normalizeOrigin(discovery.authorization_endpoint);
  normalizeOrigin(discovery.token_endpoint);
  normalizeOrigin(discovery.revocation_endpoint);
  const apiOrigin = new URL(discovery.api_endpoint).origin;
  if (new URL(discovery.token_endpoint).origin !== apiOrigin) {
    throw new DaemonClientError("Discovery token endpoint must use api_origin");
  }
  if (new URL(discovery.revocation_endpoint).origin !== apiOrigin) {
    throw new DaemonClientError(
      "Discovery revocation endpoint must use api_origin",
    );
  }
}

async function tokenRequest(
  endpoint: string,
  fetcher: typeof globalThis.fetch,
  fields: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetchManual(
    endpoint,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
    },
    fetcher,
  );
  const value: unknown = await response.json();
  if (!response.ok)
    throw remoteHttpError("Token exchange", response.status, value);
  const parsed = TokenResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new DaemonClientError(
      `Invalid token response: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

async function refreshIfNeeded(
  credential: StoredCredential,
  store: CredentialStore,
  fetcher: typeof globalThis.fetch,
  now: number,
): Promise<StoredCredential> {
  if (Date.parse(credential.expires_at) > now + 60_000) return credential;
  if (Date.parse(credential.refresh_expires_at) <= now) {
    throw new DaemonClientError(
      "Refresh token expired; run `vcontext auth login` again.",
    );
  }
  const token = await tokenRequest(credential.token_endpoint, fetcher, {
    grant_type: "refresh_token",
    refresh_token: credential.refresh_token,
    client_id: CLIENT_ID,
  });
  const refreshed: StoredCredential = {
    ...credential,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: new Date(now + token.expires_in * 1_000).toISOString(),
    refresh_expires_at: new Date(
      now + token.refresh_token_expires_in * 1_000,
    ).toISOString(),
  };
  await store.set(credential.origin, refreshed);
  return refreshed;
}

async function revoke(
  endpoint: string,
  token: string,
  fetcher: typeof globalThis.fetch,
): Promise<void> {
  const response = await fetchManual(
    endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, token_type_hint: "refresh_token" }),
    },
    fetcher,
  );
  if (!response.ok) {
    throw remoteHttpError(
      "Token revocation",
      response.status,
      await response.text(),
    );
  }
}

async function fetchManual(
  url: string,
  init: RequestInit,
  fetcher: typeof globalThis.fetch,
): Promise<Response> {
  const response = await fetcher(url, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new DaemonClientError(
      `Refused redirect from OAuth endpoint (${response.status}); credentials were not forwarded.`,
      1,
    );
  }
  return response;
}

function authStatusValue(credential: StoredCredential, now: number) {
  return {
    authenticated: true,
    origin: credential.origin,
    api_origin: credential.api_origin,
    expires_at: credential.expires_at,
    refresh_expires_at: credential.refresh_expires_at,
    expired: Date.parse(credential.expires_at) <= now,
  };
}

function remoteHttpError(
  label: string,
  status: number,
  value: unknown,
): DaemonClientError {
  const detail =
    typeof value === "object" && value !== null && "error" in value
      ? String(value.error)
      : typeof value === "string"
        ? value
        : "request failed";
  return new DaemonClientError(`${label} failed (${status}): ${detail}`);
}

function randomBase64Url(bytes: number): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

async function openExternal(url: string): Promise<void> {
  const command =
    process.platform === "win32"
      ? { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
      : process.platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
