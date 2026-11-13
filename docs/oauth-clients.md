# Trusted MCP OAuth clients

ChatGPT's existing client ID, exact callback, metadata verification, scopes and
tokens are unchanged. All clients use the same MCP tools and six scopes.
The historical `/connect/chatgpt` path is retained for compatibility; its consent
screen displays the validated client's name.

Additional clients are configured in server-only `STICKY_OAUTH_CLIENTS`, a JSON
array of `{ "id": "...", "name": "Grok Bot", "redirectUris": ["..."], "registration": true }`.
Use actual client details observed from the retry and independently verify the
callback belongs to the intended provider before approving it. No Grok callback
is preconfigured or guessed. Environment changes require a deployment.

Discovery advertises `/api/oauth/register`. Registration accepts public clients
(`none`) only, with exact HTTPS callbacks already approved in configuration.
It returns the configured stable client ID; arbitrary registration is rejected.
No secrets or mutable registration records are needed. Shared callbacks and
duplicate client IDs fail closed. Additional client URLs are never fetched.

Rejected registration/authorization logs contain only candidate ID/name and
callback origins/paths, never state, tokens, codes, PKCE, or query strings.
If a callback needs query parameters, obtain the exact URI separately before
approval; logs deliberately redact them. Retry after deployment, inspect the
`Sticky OAuth untrusted client` log, configure the verified entry, then redeploy.

Connections derives client labels from owner-scoped OAuth grants. Each grant has
its own disconnect action; revoking it leaves other clients' grants untouched.
The existing atomic SQL code exchange, five-minute single-use codes, S256 PKCE,
client/resource/callback binding, issuer response, refresh rotation and replay
revocation remain unchanged. The internal legacy provider tag `chatgpt_oauth`
is retained for compatibility and is not used as the displayed client identity.

Status: infrastructure implemented; Grok's actual identity and end-to-end linking
remain pending its first rejected request and owner allowlisting.

## Verification for this change

Typecheck, lint (two existing warnings), 213 unit tests, security checks, schema
checks, and the production build passed. `npm run verify` stopped at dependency
audit with 27 moderate-or-higher findings in the unchanged dependency tree.
Database tests were added but could not run because Docker's Linux daemon was
unavailable. These are release limitations, not passing checks.
