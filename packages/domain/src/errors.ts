import type { ApiErrorCode } from "@sticky/contracts";

export class StickyDomainError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "StickyDomainError";
  }
}

export function conflict(message: string, details?: unknown) {
  return new StickyDomainError("conflict", message, 409, details);
}
