# Sticky in ChatGPT / dot

## Status and scope

This implements a private OAuth 2.1 connection to the existing `/api/mcp` server.
Deployment, linking, and an actual dot tool call must each be verified separately;
the existence of these files does not establish that dot is connected.

ChatGPT uses the same Sticky tools and scope enforcement as Codex. The six task
and calendar scopes include reads, writes, and explicit destructive actions.
Credentials, account access administration, and the human-only bulk Google sync
override are not agent capabilities. Google and Sticky remain separate sources.
Existing API bearer credentials and Poke identity binding are unchanged.

## Setup

1. Deploy the migration and app after database and application checks pass.
2. In ChatGPT Plugins, choose **Add → Create custom MCP server**.
3. Name it **Sticky**, with server URL `https://sticky.yuvrajkashyap.com/api/mcp`.
4. Select **OAuth**, client setup **Client ID Metadata Document (CIMD)**,
   and public client token authentication (`none`). Discovery publishes these options.
5. Default scopes: `tasks:read tasks:write tasks:destructive calendar:read calendar:write calendar:destructive`.
6. Create the private connection, sign in to Sticky, and review the permission page.
   If sign-in opens another tab, return to the authorization tab afterward.
7. Enable the connection for dot and ask it for a bounded read, such as at most
   three current tasks and events in a one-day date range. Check its tool result.

No API key belongs in a chat. The OAuth client is the exact published ChatGPT
metadata URL `https://chatgpt.com/oauth/client.json`; the exact stable callback is
`https://chatgpt.com/connector_platform_oauth_redirect`. Arbitrary client URLs,
callbacks, and resources are rejected. Other existing clients keep bearer auth.

Account policy can limit custom plugins or dot availability. This flow does not
require an OpenAI API key or a new identity-provider subscription; normal ChatGPT,
Vercel, and Supabase plan limits still apply. It does not publish Sticky in the
public plugin directory.

## Security and revocation

- Authorization uses the existing active Sticky user, explicit consent, S256 PKCE,
  a five-minute single-use code, exact callback/client/resource binding, and `iss`.
- Access tokens expire after one hour. Refresh tokens rotate on every exchange,
  expire after 30 days, and cannot extend a grant beyond 90 days. Refresh replay
  revokes the entire grant. No plaintext access/refresh/code secret is stored.
- The three OAuth tables and transaction functions are service-role-only with
  RLS enabled. All data remains in `sticky`; no shared Auth configuration changes.
- Sticky → Connections → **Disconnect ChatGPT** revokes access and refresh tokens.
  OAuth's revocation endpoint also revokes the entire grant. Other clients remain
  connected. A revoked or inactive owner cannot continue using OAuth access.
- Uninstalling a plugin alone may not revoke its external connection. Use Sticky's
  disconnect control when verifying server-side revocation.

## Verification

Unit tests cover discovery, fixed client/callback validation, PKCE, scope escalation,
duplicate query parameters, token endpoint validation, and cross-origin consent.
The isolated database suite covers concurrent code redemption, incorrect PKCE,
wrong resource, refresh rotation/replay, owner revocation, and browser/anonymous
denial of access to OAuth tables/functions. Existing MCP tests check Poke/Codex.

Release verification must additionally record the deployed SHA, actual discovered
tools, a bounded dot read, denial with a revoked grant, and successful relinking.
Do not test deletion against real user data merely to demonstrate permissions.

### Verified live on October 2, 2026

- Deployed OAuth implementation: `7605a6e6e377500e47d95054bc68db59d19503b5`.
- The owner's ChatGPT account created a private Sticky plugin using discovered
  CIMD settings and all six scopes; discovery exposed 22 read and 54 write tools.
- The actual dot conversation successfully called `list_tasks` and
  `list_calendar_events`, returning current tasks and a one-day event result.
- After **Disconnect ChatGPT** in Sticky, dot's next fresh `list_tasks` request
  failed with `UNAUTHORIZED`, reauthentication required, and
  `oauth_token_invalid_grant`; no task data was returned.
- Reconnecting through dot restored access, and a fresh one-day
  `list_calendar_events` call succeeded. The final connection was left enabled.
- No real tasks or events were mutated during this check. Write permissions were
  granted and discovered; this does not claim every write tool was live-tested.

References: https://developers.openai.com/plugins/build/auth,
https://developers.openai.com/plugins/deploy/connect-chatgpt,
https://learn.chatgpt.com/docs/dots/getting-started.
