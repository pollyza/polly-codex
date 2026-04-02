import { NextResponse } from "next/server";
import { createAuthUser, createWebSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getSupabaseServerClient, hasSupabaseAuthConfig } from "@/lib/supabase-shared";

export async function POST(request: Request) {
  if (hasSupabaseAuthConfig()) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const next = String(formData.get("next") || "/dashboard");

  if (!email || !email.includes("@")) {
    return NextResponse.redirect(new URL("/login?error=invalid_email", request.url));
  }

  const user = createAuthUser(email);
  const token = createWebSessionToken(user);
  const supabase = getSupabaseServerClient();

  if (supabase) {
    await supabase.from("users").upsert({
      id: user.id,
      email: user.email,
      name: user.name
    });
  }

  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });

  return response;
}
