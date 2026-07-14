import { NextResponse, type NextRequest } from "next/server";
import { userFacingStickyMessage } from "@/lib/sticky/messages";
import { getAppBaseUrl, getAuthCallbackUrl } from "@/lib/supabase/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function redirectWithAuthError(baseUrl: string, message: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("auth_error", userFacingStickyMessage(message));
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const baseUrl = getAppBaseUrl(requestUrl.origin);
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return redirectWithAuthError(baseUrl, "Sticky sign-in is not connected in this environment.");
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getAuthCallbackUrl(requestUrl.origin),
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    return redirectWithAuthError(
      baseUrl,
      error?.message ?? "Sticky could not start Google sign-in. Please try again.",
    );
  }

  return NextResponse.redirect(data.url);
}
