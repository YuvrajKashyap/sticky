import { z } from "zod";

export const CHATGPT_CLIENT = "https://chatgpt.com/oauth/client.json";
export const CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const httpsUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash;
});
const clientSchema = z.object({
  id: z.string().min(1).max(512), name: z.string().min(1).max(80),
  redirectUris: z.array(httpsUrl).min(1).max(10),
  registration: z.boolean().default(false),
}).strict();

export function trustedOAuthClients() {
  const extra = z.array(clientSchema).max(20).parse(JSON.parse(process.env.STICKY_OAUTH_CLIENTS ?? "[]"));
  const clients = [{ id: CHATGPT_CLIENT, name: "ChatGPT / dot", redirectUris: [CHATGPT_REDIRECT], registration: false }, ...extra];
  if (new Set(clients.map(client => client.id)).size !== clients.length) throw new Error("Duplicate OAuth client configuration");
  const callbacks = clients.flatMap(client => client.redirectUris);
  if (new Set(callbacks).size !== callbacks.length) throw new Error("Ambiguous OAuth callback configuration");
  return clients;
}

export function trustedOAuthClient(id: string) {
  return trustedOAuthClients().find(client => client.id === id);
}

// Never log codes, state, tokens, PKCE, or callback query strings.
export function logOAuthCandidate(kind: string, id: unknown, redirects: unknown) {
  const safe = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    try { const url = new URL(value); return `${url.origin}${url.pathname}`.slice(0, 512); }
    catch { return value.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 128); }
  };
  console.warn("Sticky OAuth untrusted client", { kind, client: safe(id), redirects: Array.isArray(redirects) ? redirects.slice(0, 10).map(safe) : [] });
}
