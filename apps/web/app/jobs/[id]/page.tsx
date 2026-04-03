import Link from "next/link";
import { JobAutoRefresh } from "@/components/job-auto-refresh";
import { SiteShell } from "@/components/site-shell";
import { createDeviceUser, getCurrentUserFromCookies } from "@/lib/auth";
import { getJobDetail } from "@/lib/store";

export default async function JobDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ device_id?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const user = (await getCurrentUserFromCookies()) || (search.device_id ? createDeviceUser(search.device_id) : null);
  let detail = null;
  let loadError: string | null = null;

  try {
    detail = await getJobDetail(id, user?.id);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unknown server error";
  }

  if (loadError) {
    return (
      <SiteShell deviceId={search.device_id}>
        <section className="card">
          <div className="eyebrow">Job detail</div>
          <h1 className="title-lg">This job page hit a temporary server error.</h1>
          <p className="subtitle">{loadError}</p>
          <div className="actions">
            <Link className="button" href={`/jobs/${id}${search.device_id ? `?device_id=${encodeURIComponent(search.device_id)}` : ""}`}>
              Reload
            </Link>
            <Link className="button secondary" href={search.device_id ? `/history?device_id=${encodeURIComponent(search.device_id)}` : "/history"}>
              Back to history
            </Link>
          </div>
        </section>
      </SiteShell>
    );
  }

  if (!detail) {
    return (
      <SiteShell deviceId={search.device_id}>
        <section className="card">
          <div className="eyebrow">Job detail</div>
          <h1 className="title-lg">Job not found.</h1>
          <div className="actions">
            <Link className="button" href={search.device_id ? `/history?device_id=${encodeURIComponent(search.device_id)}` : "/history"}>
              Back to history
            </Link>
          </div>
        </section>
      </SiteShell>
    );
  }

  const { job, source, script, audio } = detail;
  const isDone = job.status === "succeeded";
  const statusCopy =
    job.status === "extracting"
      ? "Cleaning and structuring the page content."
      : job.status === "writing"
        ? "Writing the host-style script."
        : job.status === "synthesizing"
          ? "Generating speech audio. This can take longer on Gemini."
          : "The job is still moving through extraction, writing, and synthesis. This page will keep refreshing automatically.";

  return (
    <SiteShell deviceId={search.device_id}>
      <JobAutoRefresh status={job.status} jobId={job.id} />
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
                {job.errorCode === "STORAGE_FALLBACK" ? (
                  <p className="muted" style={{ color: "#b7791f", margin: "8px 0 0" }}>
                    Storage upload fell back to an inline audio URL. Playback works, but persistence is degraded.
                  </p>
                ) : null}
                {job.errorCode === "TRIAL_PROVIDER_FALLBACK" ? (
                  <p className="muted" style={{ color: "#1f5fbf", margin: "8px 0 0" }}>
                    Polly trial OpenAI quota was exhausted, so this run automatically switched to Gemini.
                  </p>
                ) : null}
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
                  {job.status === "failed"
                    ? job.errorMessage || "The generation failed before audio was produced."
                    : statusCopy}
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
              <Link className="button" href={search.device_id ? `/history?device_id=${encodeURIComponent(search.device_id)}` : "/history"}>
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
