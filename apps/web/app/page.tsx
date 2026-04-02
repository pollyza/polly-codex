import Link from "next/link";
import { SiteShell } from "@/components/site-shell";

export default function HomePage() {
  return (
    <SiteShell>
      <section className="hero">
        <div className="card">
          <div className="eyebrow">Browser-first audio workflow</div>
          <h1 className="title-xl">Turn Feishu docs and web pages into spoken briefings.</h1>
          <p className="subtitle">
            Polly rewrites page content into a host-style audio script, then turns it into a
            podcast you can listen to on the move.
          </p>
          <div className="actions">
            <Link className="button" href="/install-extension">
              Install the extension
            </Link>
            <Link className="button secondary" href="/dashboard">
              Open dashboard
            </Link>
          </div>
        </div>
        <div className="card">
          <div className="eyebrow">Why it works</div>
          <h2 className="title-lg">Built for PMs and operators who need to understand fast.</h2>
          <ul className="list muted">
            <li>Not raw TTS. Polly rewrites source material into a spoken explanation.</li>
            <li>Supports both Chinese and English output from day one.</li>
            <li>Tracks free usage by audio minutes so the product stays easy to price.</li>
          </ul>
          <div className="metric">1-3 min</div>
          <div className="muted">Target generation time from click to playable audio.</div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="eyebrow">Three steps</div>
          <div className="kpi-row">
            <div>
              <h3 className="title-lg">1. Open the page</h3>
              <p className="muted">Feishu doc, strategy memo, launch page, or long-form article.</p>
            </div>
            <div>
              <h3 className="title-lg">2. Click the extension</h3>
              <p className="muted">Choose the language and target duration in a lightweight popup.</p>
            </div>
            <div>
              <h3 className="title-lg">3. Listen to the briefing</h3>
              <p className="muted">Polly writes a host-style script and delivers a shareable audio page.</p>
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
