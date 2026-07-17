/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type StickySupabaseClient = SupabaseClient<any, any, any, any, any>;

export type SupabaseServerEnvironment = {
  url: string;
  publishableKey: string;
  secretKey: string;
};

export function readSupabaseServerEnvironment(): SupabaseServerEnvironment {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publishableKey || !secretKey) {
    throw new Error("Sticky API requires its Supabase URL, publishable key, and server secret.");
  }
  return { url, publishableKey, secretKey };
}

export function createStickyAdminClient(env = readSupabaseServerEnvironment()): StickySupabaseClient {
  return createClient(env.url, env.secretKey, {
    db: { schema: "sticky" },
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

export function createStickyUserClient(accessToken: string, env = readSupabaseServerEnvironment()): StickySupabaseClient {
  return createClient(env.url, env.publishableKey, {
    db: { schema: "sticky" },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}
