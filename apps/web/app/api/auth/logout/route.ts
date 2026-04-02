import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { hasSupabaseAuthConfig } from "@/lib/supabase-shared";
import { getSupabaseRouteHandlerClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url));

  if (hasSupabaseAuthConfig()) {
    const supabase = getSupabaseRouteHandlerClient(request, response);
    if (supabase) {
      await supabase.auth.signOut();
    }
  }

  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0)
  });
  return response;
}
