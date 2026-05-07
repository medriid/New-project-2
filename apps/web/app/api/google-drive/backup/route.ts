import { NextResponse, type NextRequest } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireOwner } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const body = (await request.json()) as { serverId?: string };
    if (!body.serverId) {
      return NextResponse.json({ error: "serverId is required" }, { status: 400 });
    }

    return NextResponse.json(
      await agentFetch(`/servers/${encodeURIComponent(body.serverId)}/drive/backup`, { method: "POST" }),
    );
  } catch (error) {
    return apiError(error);
  }
}
