import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppBaseUrl } from "@/lib/supabase/redirect";

function redirectWithAuthError(baseUrl: string, message: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("auth_error", message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const baseUrl = getAppBaseUrl(requestUrl.origin);
  const providerError =
    requestUrl.searchParams.get("error_description") ??
    requestUrl.searchParams.get("error");

  if (providerError) {
    return redirectWithAuthError(baseUrl, providerError);
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = (await supabase?.auth.exchangeCodeForSession(code)) ?? {};

    if (error) {
      return redirectWithAuthError(baseUrl, error.message);
    }
  }

  return NextResponse.redirect(baseUrl);
}
