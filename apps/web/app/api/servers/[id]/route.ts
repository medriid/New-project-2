import { NextResponse } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireSignedIn } from "@/lib/auth";
import type { ServerRecord } from "@/types/panel";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireSignedIn();
  if (response) {
    return response;
  }

  try {
    const { id } = await context.params;
    return NextResponse.json(await agentFetch<ServerRecord>(`/servers/${encodeURIComponent(id)}`));
  } catch (error) {
    return apiError(error);
  }
}
