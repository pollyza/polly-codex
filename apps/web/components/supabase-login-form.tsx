"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function SupabaseLoginForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage("Sending magic link...");

    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        throw new Error("Supabase auth is not configured.");
      }

      const redirectTo = new URL("/auth/callback", window.location.origin);
      redirectTo.searchParams.set("next", nextPath);

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo.toString()
        }
      });

      if (error) {
        throw error;
      }

      setStatus("sent");
      setMessage("Magic link sent. Open it in this browser to finish sign-in.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Failed to send magic link.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid" style={{ marginTop: 20 }}>
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="you@company.com"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {message ? <p className="muted">{message}</p> : null}
      <div className="actions">
        <button className="button" disabled={status === "submitting"} type="submit">
          {status === "submitting" ? "Sending..." : "Send magic link"}
        </button>
      </div>
    </form>
  );
}
