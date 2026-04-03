import { SiteShell } from "@/components/site-shell";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { getUsageSummary, listUsageLedger } from "@/lib/store";

export default async function BillingPage() {
  const user = await getCurrentUserFromCookies();

  const [usage, ledger] = await Promise.all([getUsageSummary(user?.id), listUsageLedger(user?.id)]);

  return (
    <SiteShell>
      <section className="grid">
        <div className="card">
          <div className="eyebrow">Usage</div>
          <h1 className="title-lg">Three free runs, then bring your own model API key.</h1>
          <div className="kpi-row">
            <div className="card" style={{ padding: 18 }}>
              <div className="muted">Total</div>
              <div className="metric">{usage.freeTrialRunsTotal}</div>
            </div>
            <div className="card" style={{ padding: 18 }}>
              <div className="muted">Used</div>
              <div className="metric">{usage.trialRunsUsed}</div>
            </div>
            <div className="card" style={{ padding: 18 }}>
              <div className="muted">Remaining</div>
              <div className="metric">{usage.trialRunsRemaining}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="eyebrow">Ledger</div>
          <h2 className="title-lg">This device&apos;s trial and generation history.</h2>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Runs</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td>{entry.entryType}</td>
                  <td style={{ color: entry.minutesDelta < 0 ? "#ba4a1f" : "#1f7a5c" }}>
                    {entry.minutesDelta > 0 ? "+" : ""}
                    {entry.minutesDelta.toFixed(1)}
                  </td>
                  <td>{entry.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </SiteShell>
  );
}
