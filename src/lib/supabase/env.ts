export type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey || publishableKey.includes("replace_me")) {
    return null;
  }

  return { url, publishableKey };
}

export function isDemoModeEnabled() {
  return (
    process.env.STICKY_DEMO_MODE === "true" ||
    process.env.NEXT_PUBLIC_STICKY_DEMO_MODE === "true"
  );
}
