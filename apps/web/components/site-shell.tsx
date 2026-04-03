import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

function withDeviceId(path: string, deviceId?: string | null) {
  if (!deviceId) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}device_id=${encodeURIComponent(deviceId)}`;
}

export async function SiteShell({ children, deviceId }: { children: ReactNode; deviceId?: string | null }) {
  const user = await getCurrentUserFromCookies();

  return (
    <div className="shell">
      <header className="site-nav">
        <Link href={withDeviceId("/", deviceId) as never} className="brand">
          Polly
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <nav className="nav-links">
            <Link href={withDeviceId("/dashboard", deviceId) as never}>Dashboard</Link>
            <Link href={withDeviceId("/history", deviceId) as never}>History</Link>
            <Link href={withDeviceId("/settings/billing", deviceId) as never}>Usage</Link>
            <Link href={withDeviceId("/install-extension", deviceId) as never}>Install</Link>
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
