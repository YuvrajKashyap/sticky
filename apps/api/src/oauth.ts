import { createHash } from "node:crypto";
import { z } from "zod";

export const OAUTH_SCOPES = ["tasks:read", "tasks:write", "tasks:destructive", "calendar:read", "calendar:write", "calendar:destructive"] as const;
export const CHATGPT_CLIENT = "https://chatgpt.com/oauth/client.json";
export const CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
export const oauthIssuer = () => "https://sticky.yuvrajkashyap.com";
export const oauthResource = () => `${oauthIssuer()}/api/mcp`;
export const oauthChallenge = () => `Bearer resource_metadata="${oauthIssuer()}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPES.join(" ")}"`;
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function oauthMetadata() {
  return {
    issuer: oauthIssuer(), authorization_endpoint: `${oauthIssuer()}/connect/chatgpt`,
    token_endpoint: `${oauthIssuer()}/api/oauth/token`, revocation_endpoint: `${oauthIssuer()}/api/oauth/revoke`,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"], scopes_supported: [...OAUTH_SCOPES],
    client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true,
  };
}
export function protectedResourceMetadata() {
  return { resource: oauthResource(), resource_name: "Sticky", authorization_servers: [oauthIssuer()],
    scopes_supported: [...OAUTH_SCOPES], bearer_methods_supported: ["header"] };
}

const requestSchema = z.object({
  client_id: z.literal(CHATGPT_CLIENT), redirect_uri: z.literal(CHATGPT_REDIRECT),
  response_type: z.literal("code"), resource: z.string().refine(value => value === oauthResource()),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal("S256"),
  state: z.string().min(1).max(2048), scope: z.string().min(1).max(512),
});

export async function validateAuthorization(params: URLSearchParams) {
  for (const key of params.keys()) if (params.getAll(key).length !== 1) throw new Error("Duplicate authorization parameter.");
  const request = requestSchema.parse(Object.fromEntries(params));
  const scopes = [...new Set(request.scope.split(/\s+/))];
  if (scopes.some(scope => !(OAUTH_SCOPES as readonly string[]).includes(scope))) throw new Error("Unsupported permission requested.");
  // A fixed HTTPS client URL avoids SSRF and arbitrary client/callback registration.
  const response = await fetch(CHATGPT_CLIENT, { redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("ChatGPT client metadata is unavailable. Try again.");
  const client = await response.json();
  const methods = client.token_endpoint_auth_methods_supported ?? [client.token_endpoint_auth_method];
  if (client.client_id !== CHATGPT_CLIENT || !client.redirect_uris?.includes(request.redirect_uri) || !methods.includes("none")) {
    throw new Error("ChatGPT client metadata did not match the supported connection.");
  }
  return { ...request, scopes };
}
