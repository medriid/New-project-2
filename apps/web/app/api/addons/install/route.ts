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
    const body = (await request.json()) as { serverId?: string; projectId?: string };
    if (!body.serverId || !body.projectId) {
      return NextResponse.json({ error: "serverId and projectId are required" }, { status: 400 });
    }

    return NextResponse.json(
      await agentFetch(`/servers/${encodeURIComponent(body.serverId)}/addons/modrinth`, {
        method: "POST",
        json: { projectId: body.projectId },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
