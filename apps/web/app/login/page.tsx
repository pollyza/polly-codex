import { redirect } from "next/navigation";
import { SiteShell } from "@/components/site-shell";
import { SupabaseLoginForm } from "@/components/supabase-login-form";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { hasSupabaseAuthConfig } from "@/lib/supabase-shared";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const user = await getCurrentUserFromCookies();
  const params = await searchParams;

  if (user) {
    redirect("/dashboard");
  }

  return (
    <SiteShell>
      <section className="card" style={{ maxWidth: 680 }}>
        <div className="eyebrow">Login</div>
        <h1 className="title-lg">Web login is the single auth entrypoint for the MVP.</h1>
        <p className="subtitle">
          {hasSupabaseAuthConfig()
            ? "Sign in with a Supabase magic link. Open the email link in this browser to finish the extension flow."
            : "Enter any work email to create a local session. This keeps the auth flow real enough for the extension bridge while Supabase is not configured."}
        </p>
        {hasSupabaseAuthConfig() ? (
          <SupabaseLoginForm nextPath={params.next || "/dashboard"} />
        ) : (
          <form action="/api/auth/login" method="post" className="grid" style={{ marginTop: 20 }}>
            <input name="next" type="hidden" value={params.next || "/dashboard"} />
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input id="email" name="email" type="email" placeholder="you@company.com" required />
            </div>
            {params.error ? <p className="muted">Please enter a valid email.</p> : null}
            <div className="actions">
              <button className="button" type="submit">
                Log in
              </button>
            </div>
          </form>
        )}
      </section>
    </SiteShell>
  );
}
