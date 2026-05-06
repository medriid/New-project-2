import { NextResponse } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireSignedIn } from "@/lib/auth";
import type { PlayerSummary } from "@/types/panel";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireSignedIn();
  if (response) {
    return response;
  }

  try {
    const { id } = await context.params;
    return NextResponse.json(await agentFetch<PlayerSummary>(`/servers/${encodeURIComponent(id)}/players`));
  } catch (error) {
    return apiError(error);
  }
}
