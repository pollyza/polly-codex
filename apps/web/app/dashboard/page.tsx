import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteShell } from "@/components/site-shell";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { getUsageSummary, listJobSummaries } from "@/lib/store";

export default async function DashboardPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    redirect("/login?next=/dashboard");
  }

  const [jobs, usage] = await Promise.all([listJobSummaries(user.id), getUsageSummary(user.id)]);

  return (
    <SiteShell>
      <div className="grid">
        <section className="hero">
          <div className="card">
            <div className="eyebrow">Dashboard</div>
            <h1 className="title-lg">Send new pages from the extension, then come back here to listen.</h1>
            <p className="subtitle">
              This is the first operator view for Polly. It gives users one place to check quota,
              watch jobs move through the pipeline, and jump into finished audio.
            </p>
            <div className="actions">
              <Link className="button" href="/install-extension">
                Install extension
              </Link>
              <Link className="button secondary" href="/history">
                View full history
              </Link>
            </div>
          </div>

          <div className="card">
            <div className="eyebrow">Free usage</div>
            <div className="metric">{usage.minutesRemaining.toFixed(1)} min</div>
            <p className="muted">Remaining in {usage.periodKey}</p>
            <div className="progress" style={{ marginTop: 18 }}>
              <span style={{ width: `${(usage.minutesUsed / usage.freeMinutesTotal) * 100}%` }} />
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              {usage.minutesUsed.toFixed(1)} of {usage.freeMinutesTotal} minutes used this month.
            </p>
            {usage.minutesRemaining < 8 ? (
              <p className="muted" style={{ marginTop: 12, color: "#ba4a1f" }}>
                You are running low on free minutes. Longer briefings may be blocked soon.
              </p>
            ) : null}
          </div>
        </section>

        <section className="card">
          <div className="eyebrow">Recent jobs</div>
          <ul className="list">
            {jobs.map((job) => (
              <li className="list-item" key={job.id}>
                <div>
                  <div className="pill">
                    {job.sourceType === "feishu_doc" ? "Feishu" : "Web"} · {job.outputLanguage.toUpperCase()}
                  </div>
                  <h3 style={{ marginBottom: 6 }}>{job.title}</h3>
                  <p className="muted" style={{ margin: 0 }}>
                    {job.summary}
                  </p>
                </div>
                <div style={{ minWidth: 180, textAlign: "right" }}>
                  <div className="status" style={{ justifyContent: "flex-end" }}>
                    <span className={`dot${job.status === "succeeded" ? " success" : ""}`} />
                    <span>{job.status}</span>
                  </div>
                  <p className="muted">{job.targetDurationMinutes} min target</p>
                  <Link href={`/jobs/${job.id}`} className="button secondary">
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </SiteShell>
  );
}
