const TECHNICAL_MESSAGE_PATTERNS = [
  /\b(?:public|auth|storage)\.[a-z_]+\b/i,
  /\bsticky\.[a-z_]+\b/i,
  /\bnext_public_[a-z0-9_]+\b/i,
  /\b(?:database|function|relation|table|trigger|view)\b/i,
  /\b(?:column|constraint|duplicate key|foreign key|not-null|null value)\b/i,
  /\b(?:pgrst|postgrest)\d*\b/i,
  /\bpostgres(?:ql)?\b/i,
  /\bpermission denied\b/i,
  /\bpolicy\b/i,
  /\brpc\b/i,
  /\brow[- ]level security\b/i,
  /\brls\b/i,
  /\bschema\b/i,
  /\bservice[_ -]?role\b/i,
  /\bsql\b/i,
  /\bsupabase\b/i,
];

export const GENERIC_STICKY_ACCESS_MESSAGE =
  "Sticky could not open this workspace yet. Please try again, or ask the workspace owner to check access.";

export const GENERIC_STICKY_SAVE_MESSAGE =
  "Sticky could not save this change yet. Please try again in a moment.";

export function userFacingStickyMessage(
  message: string | null | undefined,
  fallback = GENERIC_STICKY_ACCESS_MESSAGE,
) {
  const normalized = message?.trim();

  if (!normalized) {
    return "";
  }

  if (
    normalized.length > 220 ||
    TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return fallback;
  }

  return normalized;
}

export function userFacingStickySaveMessage(message: string | null | undefined) {
  return userFacingStickyMessage(message, GENERIC_STICKY_SAVE_MESSAGE) || GENERIC_STICKY_SAVE_MESSAGE;
}
