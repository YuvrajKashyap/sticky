import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";

type GenericTable = {
  Insert: Record<string, unknown>;
  Relationships: [];
  Row: Record<string, unknown>;
  Update: Record<string, unknown>;
};

type GenericFunction = {
  Args: Record<string, unknown>;
  Returns: unknown;
};

type StickyDatabase = {
  sticky: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, string>;
    Functions: Record<string, GenericFunction>;
    Tables: Record<string, GenericTable>;
    Views: Record<string, never>;
  };
};

let adminClient: SupabaseClient<StickyDatabase, "sticky", "sticky"> | null | undefined;

function getSupabaseSecretKey() {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key || key.includes("replace_me")) {
    return null;
  }

  return key;
}

export function createSupabaseAdminClient() {
  if (adminClient !== undefined) {
    return adminClient;
  }

  const env = getSupabaseEnv();
  const secretKey = getSupabaseSecretKey();

  if (!env || !secretKey) {
    adminClient = null;
    return adminClient;
  }

  adminClient = createClient<StickyDatabase, "sticky", "sticky">(env.url, secretKey, {
    db: { schema: "sticky" },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return adminClient;
}
