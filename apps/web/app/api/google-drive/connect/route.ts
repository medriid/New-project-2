import crypto from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { apiError } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { getGoogleDriveEnv, getSiteUrl } from "@/lib/env";

const stateCookie = "google_drive_oauth_state";
const folderCookie = "google_drive_folder_id";

export async function GET(request: NextRequest) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  try {
    const { clientId } = getGoogleDriveEnv();
    const siteUrl = getSiteUrl();
    const state = crypto.randomBytes(24).toString("base64url");
    const folderId = request.nextUrl.searchParams.get("folderId")?.trim() ?? "";
    const redirectUri = `${siteUrl}/api/google-drive/callback`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
    authUrl.searchParams.set("state", state);

    const redirect = NextResponse.redirect(authUrl);
    const secure = siteUrl.startsWith("https://");
    redirect.cookies.set(stateCookie, state, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: 10 * 60,
      path: "/",
    });
    redirect.cookies.set(folderCookie, folderId, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: 10 * 60,
      path: "/",
    });

    return redirect;
  } catch (error) {
    return apiError(error);
  }
}

