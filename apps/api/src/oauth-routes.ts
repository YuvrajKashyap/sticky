import { randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { authenticateRequest, getRuntime, hashCredential, parseCredentialToken } from "./runtime";
import { CHATGPT_CLIENT, oauthIssuer, oauthResource, pkceChallenge, validateAuthorization } from "./oauth";

const opaque = () => randomBytes(32).toString("base64url");
const tokenSchema = z.object({
  client_id: z.literal(CHATGPT_CLIENT), resource: z.literal(oauthResource()),
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  code: z.string().max(256).optional(), redirect_uri: z.string().max(512).optional(),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional(),
  refresh_token: z.string().max(256).optional(),
}).strict();

export function createOAuthApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store"); c.header("Pragma", "no-cache");
    c.header("Referrer-Policy", "no-referrer");
    if (Number(c.req.header("content-length") ?? 0) > 16384) return c.json({ error: "invalid_request" }, 413);
    await next();
  });
  app.onError(() => new Response(JSON.stringify({ error: "invalid_request", error_description: "The authorization request could not be completed. Start again from ChatGPT." }),
    { status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }));

  app.get("/request", async c => {
    const request = await validateAuthorization(new URL(c.req.url).searchParams);
    return c.json({ data: { scopes: request.scopes, client: "ChatGPT / dot" } });
  });
  app.post("/consent", async c => {
    // Browser authorization is an explicit same-origin, authenticated action.
    if (c.req.header("origin") !== new URL(c.req.url).origin) return c.json({ error: "invalid_request" }, 403);
    const current = await authenticateRequest(c.req.raw, randomUUID());
    if (current.actorType !== "human") return c.json({ error: "access_denied" }, 403);
    const body = z.object({ query: z.string().max(8192), approve: z.boolean() }).strict().parse(await c.req.json());
    const request = await validateAuthorization(new URLSearchParams(body.query));
    const redirect = new URL(request.redirect_uri);
    redirect.searchParams.set("state", request.state); redirect.searchParams.set("iss", oauthIssuer());
    if (!body.approve) redirect.searchParams.set("error", "access_denied");
    else {
      const code = opaque();
      const { error } = await getRuntime().db.from("oauth_codes").insert({
        code_hash: hashCredential(code), user_id: current.userId, client_id: request.client_id,
        redirect_uri: request.redirect_uri, resource: request.resource, scopes: request.scopes,
        challenge: request.code_challenge, expires_at: new Date(Date.now() + 300000).toISOString(),
      });
      if (error) throw error;
      redirect.searchParams.set("code", code);
    }
    return c.json({ data: { redirect: redirect.toString() } });
  });
  app.post("/token", async c => {
    if (!c.req.header("content-type")?.startsWith("application/x-www-form-urlencoded")) return c.json({ error: "invalid_request" }, 400);
    const text = await c.req.text(); if (text.length > 16384) return c.json({ error: "invalid_request" }, 413);
    const params = new URLSearchParams(text);
    for (const key of params.keys()) if (params.getAll(key).length !== 1) return c.json({ error: "invalid_request" }, 400);
    const body = tokenSchema.parse(Object.fromEntries(params));
    const secret = opaque(), refresh = opaque(), id = randomUUID();
    const { db } = getRuntime();
    let exchanged;
    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.code_verifier || !body.redirect_uri) return c.json({ error: "invalid_request" }, 400);
      exchanged = await db.rpc("exchange_oauth_code", { p_code_hash: hashCredential(body.code), p_client_id: body.client_id,
        p_redirect_uri: body.redirect_uri, p_resource: body.resource, p_challenge: pkceChallenge(body.code_verifier),
        p_id: id, p_access_hash: hashCredential(secret), p_refresh_hash: hashCredential(refresh) });
    } else {
      if (!body.refresh_token) return c.json({ error: "invalid_request" }, 400);
      exchanged = await db.rpc("rotate_oauth_token", { p_refresh_hash: hashCredential(body.refresh_token), p_client_id: body.client_id,
        p_resource: body.resource, p_access_hash: hashCredential(secret), p_next_refresh_hash: hashCredential(refresh) });
    }
    if (exchanged.error) return c.json({ error: "server_error" }, 503);
    if (!exchanged.data) return c.json({ error: "invalid_grant" }, 400);
    return c.json({ access_token: `stk_${exchanged.data.id}_${secret}`, token_type: "Bearer", expires_in: 3600,
      refresh_token: refresh, scope: exchanged.data.scopes.join(" ") });
  });
  app.post("/revoke", async c => {
    const body = z.object({ client_id: z.literal(CHATGPT_CLIENT), token: z.string().min(1).max(512),
      token_type_hint: z.string().optional() }).parse(await c.req.parseBody());
    const access = parseCredentialToken(body.token);
    const { error } = await getRuntime().db.rpc("revoke_oauth_token", { p_client_id: body.client_id,
      p_token_hash: hashCredential(access?.secret ?? body.token), p_token_prefix: access?.tokenPrefix ?? "" });
    if (error) return c.json({ error: "server_error" }, 503);
    return c.body(null, 200);
  });
  return app;
}
