"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type CommandResult = { data: unknown; error: { message: string } | null };
type TableAction = "insert" | "update" | "delete";
type Filter = { field: "id" | "user_id" | "task_id" | "list_id"; value: string | number | boolean };
type StickyBrowserClient = NonNullable<ReturnType<typeof createSupabaseBrowserClient>>;

async function apiRequest<T>(supabase: StickyBrowserClient, path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Your Sticky session has expired. Sign in again.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Content-Type", "application/json");
  if (init.method && init.method !== "GET") headers.set("Idempotency-Key", crypto.randomUUID());
  const response = await fetch(path, { ...init, headers });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? "Sticky could not save that change.");
  return payload.data as T;
}

class ApiTableCommand implements PromiseLike<CommandResult> {
  private action: TableAction | null = null;
  private payload: unknown;
  private readonly filters: Filter[] = [];

  constructor(private readonly supabase: StickyBrowserClient, private readonly table: string) {}

  insert(payload: unknown) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(field: Filter["field"], value: Filter["value"]) {
    this.filters.push({ field, value });
    return this;
  }

  then<TResult1 = CommandResult, TResult2 = never>(
    onfulfilled?: ((value: CommandResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<CommandResult> {
    if (!this.action) throw new Error("Sticky save command is incomplete.");
    const response = await apiRequest<{ result: CommandResult }>(this.supabase, "/api/v1/web-command", {
      method: "POST",
      body: JSON.stringify({ kind: "table", table: this.table, action: this.action, payload: this.payload, filters: this.filters }),
    });
    return response.result;
  }
}

export function createStickyPlatformClient() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  return {
    auth: supabase.auth,
    realtime: supabase,
    async authenticateRealtime() {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your Sticky session has expired. Sign in again.");
      await supabase.realtime.setAuth(accessToken);
    },
    from(table: string) {
      return new ApiTableCommand(supabase, table);
    },
    async rpc(name: string, args: Record<string, unknown>): Promise<CommandResult> {
      const response = await apiRequest<{ result: CommandResult }>(supabase, "/api/v1/web-command", {
        method: "POST",
        body: JSON.stringify({ kind: "rpc", name, args }),
      });
      return response.result;
    },
    request<T>(path: string, init?: RequestInit) {
      return apiRequest<T>(supabase, path, init);
    },
  };
}

export type StickyPlatformClient = NonNullable<ReturnType<typeof createStickyPlatformClient>>;
