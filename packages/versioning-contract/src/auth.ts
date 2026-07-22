import { z } from "zod";
import { SUPPORTED_SYNC_PROTOCOL_VERSIONS } from "./constants.js";
import { IdSchema } from "./common.js";

const AbsoluteUrlSchema = z.url().refine((url) => {
  if (!URL.canParse(url)) return false;
  const protocol = new URL(url).protocol;
  return protocol === "https:" || protocol === "http:";
}, "endpoint must be an absolute HTTP(S) URL");

export const DiscoveryDocumentSchema = z
  .object({
    service: z.literal("vcontext"),
    authorization_endpoint: AbsoluteUrlSchema,
    token_endpoint: AbsoluteUrlSchema,
    revocation_endpoint: AbsoluteUrlSchema,
    api_endpoint: AbsoluteUrlSchema,
    supported_sync_versions: z
      .array(z.union([z.literal(1), z.literal(2)]))
      .min(1)
      .refine(
        (versions) => versions.every((version) => SUPPORTED_SYNC_PROTOCOL_VERSIONS.includes(version)),
        "unsupported sync protocol version",
      ),
  })
  .strict();

export const CodeChallengeSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const CodeVerifierSchema = CodeChallengeSchema;

export const AuthorizationRequestSchema = z
  .object({
    response_type: z.literal("code"),
    client_id: IdSchema,
    redirect_uri: AbsoluteUrlSchema,
    state: z.string().min(1).max(1024),
    code_challenge: CodeChallengeSchema,
    code_challenge_method: z.literal("S256"),
  })
  .strict();

export const AuthorizationSuccessSchema = z
  .object({ code: IdSchema, state: z.string().min(1).max(1024) })
  .strict();

export const AuthorizationCodeTokenRequestSchema = z
  .object({
    grant_type: z.literal("authorization_code"),
    client_id: IdSchema,
    code: IdSchema,
    redirect_uri: AbsoluteUrlSchema,
    code_verifier: CodeVerifierSchema,
  })
  .strict();
export const RefreshTokenRequestSchema = z
  .object({
    grant_type: z.literal("refresh_token"),
    client_id: IdSchema,
    refresh_token: z.string().min(1),
  })
  .strict();
export const TokenRequestSchema = z.discriminatedUnion("grant_type", [
  AuthorizationCodeTokenRequestSchema,
  RefreshTokenRequestSchema,
]);
export const TokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().min(1),
    refresh_token_expires_in: z.number().int().positive(),
  })
  .strict();
export const RevokeTokenRequestSchema = z
  .object({ token: z.string().min(1), token_type_hint: z.enum(["access_token", "refresh_token"]).optional() })
  .strict();

export type DiscoveryDocument = z.infer<typeof DiscoveryDocumentSchema>;
export type AuthorizationRequest = z.infer<typeof AuthorizationRequestSchema>;
export type AuthorizationSuccess = z.infer<typeof AuthorizationSuccessSchema>;
export type TokenRequest = z.infer<typeof TokenRequestSchema>;
export type TokenResponse = z.infer<typeof TokenResponseSchema>;
export type RevokeTokenRequest = z.infer<typeof RevokeTokenRequestSchema>;
