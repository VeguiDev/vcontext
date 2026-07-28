export interface WellKnownConfig {
  api: string;
  version?: string;
  auth: {
    issuer: string;
    type: string;
    endpoints: {
      sessions: string;
      authorize: string;
      token: string;
    };
  };
  services: {
    sync: string;
  };
}

export class WellKnownError extends Error {
  readonly code: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "WellKnownError";
    this.code = code ?? "UNKNOWN";
  }
}

export async function resolveWellKnown(url: string): Promise<WellKnownConfig> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new WellKnownError(`Invalid URL: ${url}`, "INVALID_URL");
  }

  const wellKnownUrl = `${origin}/.well-known/vcontext.json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  let response: Response;
  try {
    response = await fetch(wellKnownUrl, { signal: controller.signal });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new WellKnownError(
        `Request timed out after 5000ms: ${wellKnownUrl}`,
        "TIMEOUT",
      );
    }
    throw new WellKnownError(
      `Network error fetching ${wellKnownUrl}: ${(error as Error).message ?? String(error)}`,
      "NETWORK",
    );
  }
  clearTimeout(timeout);

  if (!response.ok) {
    throw new WellKnownError(
      `HTTP ${response.status} ${response.statusText} fetching ${wellKnownUrl}`,
      `HTTP_${response.status}`,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new WellKnownError(
      `Invalid JSON response from ${wellKnownUrl}`,
      "INVALID_JSON",
    );
  }

  validateWellKnownConfig(data);
  return data;
}

function validateWellKnownConfig(data: unknown): asserts data is WellKnownConfig {
  if (typeof data !== "object" || data === null) {
    throw new WellKnownError(
      "Response must be a JSON object",
      "INVALID_SHAPE",
    );
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.api !== "string") {
    throw new WellKnownError(
      "Missing or invalid 'api' field: expected a string",
      "INVALID_SHAPE",
    );
  }

  if (typeof obj.auth !== "object" || obj.auth === null) {
    throw new WellKnownError(
      "Missing or invalid 'auth' field: expected an object",
      "INVALID_SHAPE",
    );
  }

  const auth = obj.auth as Record<string, unknown>;

  if (typeof auth.issuer !== "string") {
    throw new WellKnownError(
      "Missing or invalid 'auth.issuer' field: expected a string",
      "INVALID_SHAPE",
    );
  }

  if (typeof auth.type !== "string") {
    throw new WellKnownError(
      "Missing or invalid 'auth.type' field: expected a string",
      "INVALID_SHAPE",
    );
  }

  if (typeof auth.endpoints !== "object" || auth.endpoints === null) {
    throw new WellKnownError(
      "Missing or invalid 'auth.endpoints' field: expected an object",
      "INVALID_SHAPE",
    );
  }

  const endpoints = auth.endpoints as Record<string, unknown>;

  if (typeof endpoints.sessions !== "string") {
    throw new WellKnownError(
      "Missing or invalid 'auth.endpoints.sessions' field: expected a string",
      "INVALID_SHAPE",
    );
  }

  if (typeof endpoints.authorize !== "string") {
    throw new WellKnownError(
      "Missing or invalid 'auth.endpoints.authorize' field: expected a string",
      "INVALID_SHAPE",
    );
  }

  if (typeof endpoints.token !== "string") {
    throw new WellKnownError(
      "Missing or invalid 'auth.endpoints.token' field: expected a string",
      "INVALID_SHAPE",
    );
  }

  if (typeof obj.services !== "object" || obj.services === null) {
    throw new WellKnownError(
      "Missing or invalid 'services' field: expected an object",
      "INVALID_SHAPE",
    );
  }

  const services = obj.services as Record<string, unknown>;

  if (typeof services.sync !== "string") {
    throw new WellKnownError(
      "Missing or invalid 'services.sync' field: expected a string",
      "INVALID_SHAPE",
    );
  }
}
