import Link from "next/link";
import { redirect } from "next/navigation";
import { JobAutoRefresh } from "@/components/job-auto-refresh";
import { SiteShell } from "@/components/site-shell";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { getJobDetail } from "@/lib/store";

export default async function JobDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/jobs/${(await params).id}`)}`);
  }
  const { id } = await params;
  const detail = await getJobDetail(id, user.id);

  if (!detail) {
    return (
      <SiteShell>
        <section className="card">
          <div className="eyebrow">Job detail</div>
          <h1 className="title-lg">Job not found.</h1>
          <div className="actions">
            <Link className="button" href="/history">
              Back to history
            </Link>
          </div>
        </section>
      </SiteShell>
    );
  }

  const { job, source, script, audio } = detail;
  const isDone = job.status === "succeeded";

  return (
    <SiteShell>
      <JobAutoRefresh status={job.status} />
      <div className="two-col">
        <section className="grid">
          <div className="card">
            <div className="eyebrow">Job detail</div>
            <h1 className="title-lg">{job.title}</h1>
            <p className="subtitle">{job.summary}</p>
            <div className="actions">
              <span className="pill">{source.sourceType === "feishu_doc" ? "Feishu doc" : "Web page"}</span>
              <span className="pill">{job.outputLanguage.toUpperCase()}</span>
              <span className="pill">{job.targetDurationMinutes} min</span>
            </div>
          </div>

          <div className="card">
            <div className="eyebrow">Playback</div>
            {isDone ? (
              <div className="audio-player">
                <div className="muted">
                  Duration: {audio?.durationSeconds ?? 0} sec
                </div>
                {audio?.publicUrl ? (
                  <audio controls src={audio.publicUrl} style={{ width: "100%" }}>
                    Your browser does not support audio playback.
                  </audio>
                ) : null}
                {audio?.publicUrl ? (
                  <div className="actions">
                    <a className="button secondary" download={`${job.id}.mp3`} href={audio.publicUrl}>
                      Download MP3
                    </a>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="status">
                  <span className="dot" />
                  <span>{job.status}</span>
                </div>
                <p className="muted" style={{ marginTop: 12 }}>
                  The job is still moving through extraction, writing, and synthesis. This page is
                  where we will later attach polling and realtime status updates.
                </p>
              </>
            )}
          </div>

          <div className="card">
            <div className="eyebrow">Script preview</div>
            <div className="code">{script?.scriptText ?? "Script will appear here after writing completes."}</div>
          </div>
        </section>

        <aside className="grid">
          <div className="card">
            <div className="eyebrow">Source</div>
            <p style={{ marginBottom: 6 }}>Domain</p>
            <strong>{source.domain}</strong>
            <p className="muted" style={{ marginTop: 18 }}>
              Created at {new Date(job.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="card">
            <div className="eyebrow">Actions</div>
            <div className="actions">
              <Link className="button" href="/history">
                Back to history
              </Link>
              <button className="button secondary">Retry job</button>
            </div>
          </div>
        </aside>
      </div>
    </SiteShell>
  );
}
