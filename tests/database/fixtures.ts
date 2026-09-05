import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export function testEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (process.env.STICKY_DATABASE_TEST !== "true" || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "55321") {
    throw new Error("Database tests only run against the disposable local stack on 127.0.0.1:55321.");
  }
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const secret = process.env.SUPABASE_SECRET_KEY!;
  const options = { db: { schema: "sticky" }, auth: { persistSession: false, autoRefreshToken: false } };
  return { url, key, admin: createClient(url, secret, options), anonymous: createClient(url, key, options) };
}

export async function createTestOwner() {
  const { url, key, admin } = testEnvironment();
  const email = `sticky-test-${randomUUID()}@example.invalid`;
  const password = randomUUID();
  const allowed = await admin.from("allowed_emails").insert({ email, role: "owner", is_active: true });
  if (allowed.error) throw allowed.error;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, key, { db: { schema: "sticky" }, auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const bootstrap = await client.rpc("bootstrap_current_user", { display_name: "Verification Owner" });
  if (bootstrap.error) throw bootstrap.error;
  const lists = await client.from("lists").select("id");
  if (lists.error || !lists.data?.length) throw new Error("Test owner did not receive a default list.");
  const userId = created.data.user.id;
  return {
    userId, email, client, session: signedIn.data.session, listId: lists.data[0].id as string,
    cleanup: async () => {
      // Delete business rows while the owner still exists so delete-outbox
      // triggers can retain their owner foreign key during fixture cleanup.
      const listsRemoved = await admin.from("lists").delete().eq("user_id", userId);
      if (listsRemoved.error) throw listsRemoved.error;
      const result = await admin.auth.admin.deleteUser(userId);
      if (result.error) throw result.error;
      const removed = await admin.from("allowed_emails").delete().eq("email", email);
      if (removed.error) throw removed.error;
    },
  };
}
