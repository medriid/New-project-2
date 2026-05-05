import { NextResponse, type NextRequest } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireOwner } from "@/lib/auth";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const { id } = await context.params;
    const requestedPath = request.nextUrl.searchParams.get("path") ?? ".";
    const mode = request.nextUrl.searchParams.get("mode") ?? "list";
    const pathQuery = encodeURIComponent(requestedPath);
    const endpoint =
      mode === "read"
        ? `/servers/${encodeURIComponent(id)}/file?path=${pathQuery}`
        : `/servers/${encodeURIComponent(id)}/files?path=${pathQuery}`;

    return NextResponse.json(await agentFetch(endpoint));
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    return NextResponse.json(
      await agentFetch(`/servers/${encodeURIComponent(id)}/file`, {
        method: "PUT",
        json: body,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
