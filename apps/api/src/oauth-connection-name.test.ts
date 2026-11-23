import { expect, it } from "vitest";
import { CHATGPT_CLIENT, oauthConnectionName, publicOAuthClient } from "./oauth-clients";

it("distinguishes Dot, the Grok Bot connector, and an independent agent", () => {
  expect(oauthConnectionName(CHATGPT_CLIENT)).toBe("ChatGPT / dot");
  const grok = publicOAuthClient(["http://localhost:8787/callback", "https://www.cursor.com/agents/mcp/oauth/callback"]);
  expect(oauthConnectionName(grok!.id)).toBe("Grok Bot / Cursor");
  const independent = publicOAuthClient(["https://agent.example/oauth/callback"]);
  expect(oauthConnectionName(independent!.id)).toBe("agent.example");
});
