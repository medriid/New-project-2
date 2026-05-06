"use client";

import { ArrowRight, KeyRound, Server } from "lucide-react";
import { useState } from "react";

import { createClient } from "@/lib/supabase/browser";

type LoginCardProps = {
  authConfigured: boolean;
  ownerEmail: string;
};

export default function LoginCard({ authConfigured, ownerEmail }: LoginCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin).replace(/\/$/, "");
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${siteUrl}/auth/callback`,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });

      if (signInError) {
        setError(signInError.message);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start Google sign-in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-mark" aria-hidden="true">
          <Server size={28} />
        </div>
        <div>
          <p className="eyebrow">Z7i Minecraft</p>
          <h1>Own the server from one clean panel.</h1>
        </div>

        <div className="login-grid">
          <div>
            <span>Owner</span>
            <strong>{ownerEmail}</strong>
          </div>
          <div>
            <span>Auth</span>
            <strong>{authConfigured ? "Supabase Google" : "Needs setup"}</strong>
          </div>
        </div>

        {!authConfigured ? (
          <div className="setup-warning">
            <KeyRound size={18} />
            <span>Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.</span>
          </div>
        ) : null}

        {error ? <p className="error-line">{error}</p> : null}

        <button className="primary-action" onClick={signIn} disabled={!authConfigured || loading}>
          <span>{loading ? "Opening Google" : "Continue with Google"}</span>
          <ArrowRight size={18} />
        </button>
      </section>
    </main>
  );
}
