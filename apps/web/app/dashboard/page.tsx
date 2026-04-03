import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { createDeviceUser, getCurrentUserFromCookies } from "@/lib/auth";
import { getUsageSummary, listJobSummaries } from "@/lib/store";

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<{ device_id?: string }>;
}) {
  const search = await searchParams;
  const user = (await getCurrentUserFromCookies()) || (search.device_id ? createDeviceUser(search.device_id) : null);

  const [jobs, usage] = await Promise.all([listJobSummaries(user?.id), getUsageSummary(user?.id)]);

  return (
    <SiteShell deviceId={search.device_id}>
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
              <Link className="button" href={search.device_id ? `/install-extension?device_id=${encodeURIComponent(search.device_id)}` : "/install-extension"}>
                Install extension
              </Link>
              <Link className="button secondary" href={search.device_id ? `/history?device_id=${encodeURIComponent(search.device_id)}` : "/history"}>
                View full history
              </Link>
            </div>
          </div>

          <div className="card">
            <div className="eyebrow">Free trial</div>
            <div className="metric">{usage.trialRunsRemaining}</div>
            <p className="muted">Remaining in {usage.periodKey}</p>
            <div className="progress" style={{ marginTop: 18 }}>
              <span style={{ width: `${(usage.trialRunsUsed / usage.freeTrialRunsTotal) * 100}%` }} />
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              {usage.trialRunsUsed} of {usage.freeTrialRunsTotal} free runs used on this device.
            </p>
            {usage.trialRunsRemaining < 1 ? (
              <p className="muted" style={{ marginTop: 12, color: "#ba4a1f" }}>
                Free trial is used up. Add your own OpenAI or Gemini API key in the extension to continue.
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
                  <Link href={`/jobs/${job.id}${search.device_id ? `?device_id=${encodeURIComponent(search.device_id)}` : ""}`} className="button secondary">
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
