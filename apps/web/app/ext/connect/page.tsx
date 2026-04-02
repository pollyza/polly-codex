import { redirect } from "next/navigation";
import { ExtensionConnectCard } from "@/components/extension-connect-card";
import { getCurrentUserFromCookies } from "@/lib/auth";

export default async function ExtensionConnectPage({
  searchParams
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const user = await getCurrentUserFromCookies();
  const params = await searchParams;

  if (!user) {
    const next = params.state ? `/ext/connect?state=${encodeURIComponent(params.state)}` : "/ext/connect";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  return (
    <main className="shell">
      <ExtensionConnectCard state={params.state || ""} userEmail={user.email} />
    </main>
  );
}
