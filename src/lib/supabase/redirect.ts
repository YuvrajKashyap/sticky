const LOCAL_APP_URL = "http://localhost:3000";

function normalizeBaseUrl(value?: string | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const withProtocol = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function isLocalUrl(value: string) {
  return value.startsWith("http://localhost") || value.startsWith("http://127.0.0.1");
}

export function getAppBaseUrl(currentOrigin?: string | null) {
  const current = normalizeBaseUrl(currentOrigin);

  if (current && isLocalUrl(current)) {
    return current;
  }

  return (
    normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
    current ??
    normalizeBaseUrl(process.env.NEXT_PUBLIC_VERCEL_URL) ??
    normalizeBaseUrl(process.env.VERCEL_URL) ??
    LOCAL_APP_URL
  );
}

export function getAuthCallbackUrl(currentOrigin?: string | null) {
  return `${getAppBaseUrl(currentOrigin)}/auth/callback`;
}
