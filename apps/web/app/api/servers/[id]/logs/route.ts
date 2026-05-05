import { NextResponse, type NextRequest } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireSignedIn } from "@/lib/auth";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireSignedIn();
  if (response) {
    return response;
  }

  try {
    const { id } = await context.params;
    const tail = request.nextUrl.searchParams.get("tail") ?? "300";
    return NextResponse.json(await agentFetch(`/servers/${encodeURIComponent(id)}/logs?tail=${encodeURIComponent(tail)}`));
  } catch (error) {
    return apiError(error);
  }
}
