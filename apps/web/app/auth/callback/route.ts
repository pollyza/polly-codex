import { NextResponse } from "next/server";
import { getSupabaseServerClient, hasSupabaseAuthConfig } from "@/lib/supabase-shared";
import { getSupabaseRouteHandlerClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/dashboard";

  if (!hasSupabaseAuthConfig()) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const response = NextResponse.redirect(new URL(next, request.url));
  const supabase = getSupabaseRouteHandlerClient(request, response);

  if (!supabase || !code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", request.url));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    const db = getSupabaseServerClient();
    if (db) {
      await db.from("users").upsert({
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name || user.email?.split("@")[0] || "Polly user"
      });
    }
  }

  return response;
}
