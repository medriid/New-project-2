import { NextResponse } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireSignedIn } from "@/lib/auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireSignedIn();
  if (response) {
    return response;
  }

  try {
    const { id } = await context.params;
    return NextResponse.json(await agentFetch(`/servers/${encodeURIComponent(id)}/players`));
  } catch (error) {
    return apiError(error);
  }
}
