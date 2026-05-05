import { NextResponse, type NextRequest } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireOwner } from "@/lib/auth";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const { id } = await context.params;
    const body = (await request.json()) as { action?: string; command?: string };
    const encodedId = encodeURIComponent(id);

    if (body.action === "start" || body.action === "stop") {
      return NextResponse.json(await agentFetch(`/servers/${encodedId}/${body.action}`, { method: "POST" }));
    }

    if (body.action === "command") {
      return NextResponse.json(
        await agentFetch(`/servers/${encodedId}/command`, {
          method: "POST",
          json: { command: body.command ?? "" },
        }),
      );
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
