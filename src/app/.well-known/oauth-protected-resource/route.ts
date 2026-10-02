import { protectedResourceMetadata } from "@sticky/api";
export function GET() { return Response.json(protectedResourceMetadata()); }
