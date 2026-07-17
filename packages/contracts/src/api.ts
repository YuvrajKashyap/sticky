import { z } from "zod";

export const apiErrorCodeSchema = z.enum([
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "validation_error",
  "idempotency_required",
  "rate_limited",
  "provider_error",
  "internal_error",
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export type ApiMeta = {
  requestId: string;
  idempotentReplay?: boolean;
  nextCursor?: string | null;
};

export type ApiSuccess<T> = { data: T; meta: ApiMeta };
export type ApiFailure = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

export const idSchema = z.uuid();
export const versionSchema = z.int().positive();
export const idempotencyKeySchema = z.string().trim().min(8).max(200);

export const destructiveConfirmationSchema = z.object({
  confirmed: z.literal(true),
  summary: z.string().trim().min(5).max(240),
});
