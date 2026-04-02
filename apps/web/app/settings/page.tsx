import { redirect } from "next/navigation";
import { SiteShell } from "@/components/site-shell";
import { getCurrentUserFromCookies } from "@/lib/auth";

export default async function SettingsPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    redirect("/login?next=/settings");
  }

  return (
    <SiteShell>
      <section className="card">
        <div className="eyebrow">Settings</div>
        <h1 className="title-lg">Keep the first version focused.</h1>
        <div className="two-col">
          <div className="field">
            <label htmlFor="language">Default output language</label>
            <select id="language" defaultValue="zh">
              <option value="zh">Chinese</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="duration">Default target duration</label>
            <select id="duration" defaultValue="5">
              <option value="3">3 minutes</option>
              <option value="5">5 minutes</option>
              <option value="8">8 minutes</option>
            </select>
          </div>
        </div>
        <div className="actions">
          <button className="button">Save preferences</button>
        </div>
      </section>
    </SiteShell>
  );
}
