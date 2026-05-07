import { NextResponse, type NextRequest } from "next/server";

import { agentFetch } from "@/lib/agent";
import { requireOwner } from "@/lib/auth";
import { getGoogleDriveEnv, getSiteUrl } from "@/lib/env";

const stateCookie = "google_drive_oauth_state";
const folderCookie = "google_drive_folder_id";

function redirectHome(search: string) {
  return NextResponse.redirect(`${getSiteUrl()}/${search}`);
}

export async function GET(request: NextRequest) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  const redirect = (search: string) => {
    const result = redirectHome(search);
    result.cookies.delete(stateCookie);
    result.cookies.delete(folderCookie);
    return result;
  };

  try {
    const { clientId, clientSecret } = getGoogleDriveEnv();
    const expectedState = request.cookies.get(stateCookie)?.value;
    const actualState = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    const oauthError = request.nextUrl.searchParams.get("error");

    if (oauthError) {
      return redirect(`?drive=error&message=${encodeURIComponent(oauthError)}`);
    }

    if (!expectedState || !actualState || expectedState !== actualState) {
      return redirect("?drive=error&message=Invalid%20Google%20Drive%20state");
    }

    if (!code) {
      return redirect("?drive=error&message=Missing%20Google%20Drive%20code");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${getSiteUrl()}/api/google-drive/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokenPayload = (await tokenResponse.json()) as {
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenResponse.ok || !tokenPayload.refresh_token) {
      return redirect(
        `?drive=error&message=${encodeURIComponent(
          tokenPayload.error_description ?? tokenPayload.error ?? "Google Drive did not return a refresh token",
        )}`,
      );
    }

    await agentFetch("/drive/connect", {
      method: "POST",
      json: {
        refreshToken: tokenPayload.refresh_token,
        folderId: request.cookies.get(folderCookie)?.value || null,
      },
    });

    return redirect("?drive=connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive connection failed";
    return redirect(`?drive=error&message=${encodeURIComponent(message)}`);
  }
}

