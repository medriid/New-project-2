import { NextResponse, type NextRequest } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireOwner, requireSignedIn } from "@/lib/auth";
import type { ServerRecord } from "@/types/panel";

export async function GET() {
  const { response } = await requireSignedIn();
  if (response) {
    return response;
  }

  try {
    return NextResponse.json(await agentFetch<ServerRecord[]>("/servers"));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const body = await request.json();
    return NextResponse.json(await agentFetch<ServerRecord>("/servers", { method: "POST", json: body }), {
      status: 201,
    });
  } catch (error) {
    return apiError(error);
  }
}
