import Dashboard from "@/components/dashboard";
import LoginCard from "@/components/login-card";
import { getPanelUser } from "@/lib/auth";
import { ownerEmail } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function Home() {
  const panelUser = await getPanelUser();

  if (!panelUser.user) {
    return <LoginCard authConfigured={panelUser.authConfigured} ownerEmail={ownerEmail} />;
  }

  return <Dashboard userEmail={panelUser.email ?? ""} isOwner={panelUser.isOwner} ownerEmail={ownerEmail} />;
}
