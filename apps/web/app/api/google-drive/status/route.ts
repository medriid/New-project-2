import { NextResponse } from "next/server";

import { agentFetch } from "@/lib/agent";
import { apiError } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { hasGoogleDriveEnv } from "@/lib/env";
import type { DriveBackupStatus } from "@/types/panel";

export async function GET() {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const status = await agentFetch<DriveBackupStatus>("/drive/status");
    return NextResponse.json({
      ...status,
      credentialsConfigured: hasGoogleDriveEnv() && status.credentialsConfigured,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE() {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const status = await agentFetch<DriveBackupStatus>("/drive/disconnect", { method: "DELETE" });
    return NextResponse.json({
      ...status,
      credentialsConfigured: hasGoogleDriveEnv() && status.credentialsConfigured,
    });
  } catch (error) {
    return apiError(error);
  }
}

