import type { ApiFailure } from "@sticky/contracts";
import { StickyDomainError } from "@sticky/domain";
import type { Context } from "hono";
import { ZodError } from "zod";

export function errorResponse(c: Context, error: unknown) {
  const requestId = c.get("requestId") as string;
  if (error instanceof StickyDomainError) {
    return c.json<ApiFailure>({ error: { code: error.code, message: error.message, details: error.details, requestId } }, error.status as 400);
  }
  if (error instanceof ZodError) {
    return c.json<ApiFailure>({ error: { code: "validation_error", message: "The request is not valid.", details: error.issues, requestId } }, 422);
  }
  console.error("Sticky API request failed", { requestId, error });
  return c.json<ApiFailure>({ error: { code: "internal_error", message: "Sticky could not complete that request.", requestId } }, 500);
}
