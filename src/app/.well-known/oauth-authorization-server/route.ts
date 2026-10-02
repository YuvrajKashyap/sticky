import { oauthMetadata } from "@sticky/api";
export function GET() { return Response.json(oauthMetadata()); }
