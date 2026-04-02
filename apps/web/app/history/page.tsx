import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteShell } from "@/components/site-shell";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { listJobSummaries } from "@/lib/store";

export default async function HistoryPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    redirect("/login?next=/history");
  }

  const jobs = await listJobSummaries(user.id);

  return (
    <SiteShell>
      <section className="card">
        <div className="eyebrow">History</div>
        <h1 className="title-lg">Every generated briefing, in one place.</h1>
        <p className="subtitle">
          The MVP keeps this page intentionally simple: filter later, trust the latest work now.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Source</th>
              <th>Language</th>
              <th>Target</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.title}</td>
                <td>{job.status}</td>
                <td>{job.domain}</td>
                <td>{job.outputLanguage.toUpperCase()}</td>
                <td>{job.targetDurationMinutes} min</td>
                <td>
                  <Link href={`/jobs/${job.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </SiteShell>
  );
}
