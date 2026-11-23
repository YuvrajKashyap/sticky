# Connecting an MCP client to Sticky

Use `https://sticky.yuvrajkashyap.com/api/mcp` with remote HTTP and OAuth.
Sticky advertises dynamic registration for public clients using S256 PKCE and
the authorization code flow. Leave the client ID and secret empty for automatic
registration. Previously configured client IDs and ChatGPT's published ID
continue to work. A client that supports only shared secrets or arbitrary
client metadata URLs needs a compatible authentication mode.

Registration accepts HTTPS callbacks and HTTP callbacks on localhost, 127.0.0.1
or [::1]. Clients can include hosted and desktop callbacks in one registration.
The public ID encodes the sorted exact callbacks. It carries no access rights.
The authorization screen identifies the selected callback origin, and requires
a signed-in human to approve the requested scopes. The authorization code and
rotating refresh grant are bound to the client and Sticky MCP resource. Each
grant can be disconnected independently in Connections.

All OAuth clients share the same MCP catalog. An omitted scope requests the
six advertised task and calendar permissions, shown at consent. An explicit
subset remains a subset. Google tools require a separate Google connection.
Human-only actions, including the owner bulk sync override, stay in the app.

`STICKY_OAUTH_CLIENTS` can still configure a fixed ID, display name and exact
callbacks for a known client. Those callbacks are reserved to its ID. New public
clients do not need an environment edit or a deployment.

The Grok Bot registration observed on November 23, 2026 identified itself as
Cursor and supplied both `https://www.cursor.com/agents/mcp/oauth/callback`
and `http://localhost:8787/callback`. Both are covered by the registration test.
