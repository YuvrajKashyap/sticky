import { createApiApp } from "@sticky/api";
import { handle } from "hono/vercel";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = handle(createApiApp());

export {
  handler as DELETE,
  handler as GET,
  handler as OPTIONS,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
