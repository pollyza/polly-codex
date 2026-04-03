import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export async function SiteShell({ children }: { children: ReactNode }) {
  const user = await getCurrentUserFromCookies();

  return (
    <div className="shell">
      <header className="site-nav">
        <Link href="/" className="brand">
          Polly
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <nav className="nav-links">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/history">History</Link>
            <Link href="/settings/billing">Usage</Link>
            <Link href="/install-extension">Install</Link>
          </nav>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="muted" style={{ fontSize: 14 }}>
                {user.email}
              </span>
              <LogoutButton />
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 14 }}>
              3 free runs, then BYO key
            </span>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
