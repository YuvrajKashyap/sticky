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
  const clients = [{ id: CHATGPT_CLIENT, name: "ChatGPT / dot", redirectUris: [CHATGPT_REDIRECT], registration: true }, ...extra];
  if (new Set(clients.map(client => client.id)).size !== clients.length) throw new Error("Duplicate OAuth client configuration");
  const callbacks = clients.flatMap(client => client.redirectUris);
  if (new Set(callbacks).size !== callbacks.length) throw new Error("Ambiguous OAuth callback configuration");
  return clients;
}

export function trustedOAuthClient(id: string) {
  const clients = trustedOAuthClients();
  const configured = clients.find(client => client.id === id);
  if (configured || !id.startsWith("mcp1.") || id.length > 4096) return configured;
  try {
    const callbacks: unknown = JSON.parse(Buffer.from(id.slice(5), "base64url").toString("utf8"));
    if (!Array.isArray(callbacks)) return undefined;
    const client = publicOAuthClient(callbacks, clients);
    return client?.id === id ? client : undefined;
  } catch {
    return undefined;
  }
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

// A public client ID is an identifier, never a credential. Encoding the exact
// callback set binds it to every code and grant without anonymous database writes.
export function publicOAuthClient(callbacks: unknown[], configured = trustedOAuthClients()) {
  if (!callbacks.length || callbacks.length > 10) return undefined;
  const redirectUris: string[] = [];
  const origins = new Set<string>();
  for (const uri of callbacks) {
    if (typeof uri !== "string" || uri.length > 512 || !URL.canParse(uri)) return undefined;
    const url = new URL(uri);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) return undefined;
    if (url.username || url.password || uri.includes("#") || url.href !== uri) return undefined;
    if (configured.some(client => client.redirectUris.includes(uri))) return undefined;
    redirectUris.push(uri);
    origins.add(url.origin);
  }
  redirectUris.sort();
  const id = "mcp1." + Buffer.from(JSON.stringify(redirectUris)).toString("base64url");
  if (id.length > 4096) return undefined;
  return { id, name: [...origins].sort().join(", "), redirectUris, registration: true };
}
