import { redirect } from "next/navigation";
import { SiteShell } from "@/components/site-shell";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { getUsageSummary } from "@/lib/store";

export default async function BillingPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    redirect("/login?next=/settings/billing");
  }

  const usage = await getUsageSummary(user.id);

  return (
    <SiteShell>
      <section className="grid">
        <div className="card">
          <div className="eyebrow">Usage</div>
          <h1 className="title-lg">Free audio minutes are the primary product limit in MVP.</h1>
          <div className="kpi-row">
            <div className="card" style={{ padding: 18 }}>
              <div className="muted">Total</div>
              <div className="metric">{usage.freeMinutesTotal}</div>
            </div>
            <div className="card" style={{ padding: 18 }}>
              <div className="muted">Used</div>
              <div className="metric">{usage.minutesUsed.toFixed(1)}</div>
            </div>
            <div className="card" style={{ padding: 18 }}>
              <div className="muted">Remaining</div>
              <div className="metric">{usage.minutesRemaining.toFixed(1)}</div>
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
