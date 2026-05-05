import { NextResponse } from "next/server";

import { hasSupabaseEnv, ownerEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function getPanelUser() {
  if (!hasSupabaseEnv()) {
    return {
      user: null,
      email: null,
      isOwner: false,
      authConfigured: false,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase() ?? null;

  return {
    user,
    email,
    isOwner: email === ownerEmail,
    authConfigured: true,
  };
}

export async function requireSignedIn() {
  const panelUser = await getPanelUser();

  if (!panelUser.authConfigured) {
    return {
      panelUser,
      response: NextResponse.json({ error: "Supabase is not configured" }, { status: 503 }),
    };
  }

  if (!panelUser.user) {
    return {
      panelUser,
      response: NextResponse.json({ error: "Sign in required" }, { status: 401 }),
    };
  }

  return { panelUser, response: null };
}

export async function requireOwner() {
  const result = await requireSignedIn();

  if (result.response) {
    return result;
  }

  if (!result.panelUser.isOwner) {
    return {
      panelUser: result.panelUser,
      response: NextResponse.json({ error: "Owner access required" }, { status: 403 }),
    };
  }

  return result;
}
