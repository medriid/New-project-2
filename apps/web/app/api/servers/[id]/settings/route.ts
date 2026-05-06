import { NextResponse, type NextRequest } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import type { ServerRecord } from "@/types/panel";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    return NextResponse.json(
      await agentFetch<ServerRecord>(`/servers/${encodeURIComponent(id)}/settings`, {
        method: "PATCH",
        json: body,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
