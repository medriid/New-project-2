import { NextResponse, type NextRequest } from "next/server";

import { apiError } from "@/lib/api";
import { requireSignedIn } from "@/lib/auth";
import type { AddonKind, ModrinthSearchHit } from "@/types/panel";

type ModrinthSearchResponse = {
  hits: ModrinthSearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
};

export async function GET(request: NextRequest) {
  const { response } = await requireSignedIn();
  if (response) {
    return response;
  }

  try {
    const query = request.nextUrl.searchParams.get("q") ?? "";
    const gameVersion = request.nextUrl.searchParams.get("gameVersion") ?? "";
    const rawKind = request.nextUrl.searchParams.get("kind");
    const kind: AddonKind = rawKind === "mod" || rawKind === "datapack" ? rawKind : "plugin";
    const facets =
      kind === "mod"
        ? [["project_type:mod"], ["categories:fabric"]]
        : kind === "datapack"
          ? [["project_type:datapack"]]
          : [["categories:paper"], ["server_side:required"]];

    if (gameVersion) {
      facets.push([`versions:${gameVersion}`]);
    }

    const url = new URL("https://api.modrinth.com/v2/search");
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "20");
    url.searchParams.set("index", "relevance");
    url.searchParams.set("facets", JSON.stringify(facets));

    const modrinthResponse = await fetch(url, {
      headers: {
        "User-Agent": "minecraft-vps-panel/0.1.0 (logeshms.cbe@gmail.com)",
      },
      cache: "no-store",
    });

    if (!modrinthResponse.ok) {
      throw new Error(`Modrinth search failed: ${modrinthResponse.status}`);
    }

    return NextResponse.json((await modrinthResponse.json()) as ModrinthSearchResponse);
  } catch (error) {
    return apiError(error);
  }
}
