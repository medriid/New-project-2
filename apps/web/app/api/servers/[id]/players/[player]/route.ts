import { NextResponse, type NextRequest } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireOwner, requireSignedIn } from "@/lib/auth";
import type { PlayerDetail } from "@/types/panel";

export async function GET(_request: Request, context: { params: Promise<{ id: string; player: string }> }) {
  const { response } = await requireSignedIn();
  if (response) {
    return response;
  }

  try {
    const { id, player } = await context.params;
    return NextResponse.json(
      await agentFetch<PlayerDetail>(
        `/servers/${encodeURIComponent(id)}/players/${encodeURIComponent(player)}`,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; player: string }> }) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const { id, player } = await context.params;
    const body = await request.json();
    return NextResponse.json(
      await agentFetch(`/servers/${encodeURIComponent(id)}/players/${encodeURIComponent(player)}`, {
        method: "POST",
        json: body,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
