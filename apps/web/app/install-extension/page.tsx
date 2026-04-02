import { SiteShell } from "@/components/site-shell";

export default function InstallExtensionPage() {
  return (
    <SiteShell>
      <section className="card">
        <div className="eyebrow">Install extension</div>
        <h1 className="title-lg">Load the Chrome extension from the local `apps/extension` folder.</h1>
        <ol className="muted" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
          <li>Open Chrome and go to `chrome://extensions`.</li>
          <li>Enable Developer Mode.</li>
          <li>Click Load unpacked and choose `apps/extension`.</li>
          <li>Pin Polly, then connect your account from the popup.</li>
        </ol>
      </section>
    </SiteShell>
  );
}
