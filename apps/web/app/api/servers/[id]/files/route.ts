import { NextResponse, type NextRequest } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import type { AddonKind } from "@/types/panel";

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

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");
    const requestedPath = String(formData.get("path") ?? ".");
    const rawKind = formData.get("kind");
    const kind: AddonKind | undefined =
      rawKind === "mod" || rawKind === "plugin" || rawKind === "datapack" ? rawKind : undefined;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A file upload is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    return NextResponse.json(
      await agentFetch(`/servers/${encodeURIComponent(id)}/upload`, {
        method: "POST",
        json: {
          path: requestedPath,
          filename: file.name,
          contentBase64: buffer.toString("base64"),
          kind,
        },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { path?: string };
    const requestedPath = body.path ?? request.nextUrl.searchParams.get("path") ?? "";

    return NextResponse.json(
      await agentFetch(`/servers/${encodeURIComponent(id)}/file`, {
        method: "DELETE",
        json: { path: requestedPath },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
