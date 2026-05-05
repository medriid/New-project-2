import { NextResponse } from "next/server";

import type { FabricLatest } from "@/types/panel";

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "minecraft-vps-panel/0.1.0 (logeshms.cbe@gmail.com)",
    },
    next: {
      revalidate: 3600,
    },
  });

  if (!response.ok) {
    throw new Error(`Fabric metadata failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function GET() {
  const [games, loaders, installers] = await Promise.all([
    fetchJson<Array<{ version: string; stable: boolean }>>("https://meta.fabricmc.net/v2/versions/game"),
    fetchJson<Array<{ version: string }>>("https://meta.fabricmc.net/v2/versions/loader"),
    fetchJson<Array<{ version: string }>>("https://meta.fabricmc.net/v2/versions/installer"),
  ]);

  const payload: FabricLatest = {
    latestStableGame: games.find((game) => game.stable)?.version ?? games[0]?.version ?? "",
    latestGame: games[0]?.version ?? "",
    latestLoader: loaders[0]?.version ?? "",
    latestInstaller: installers[0]?.version ?? "",
  };

  return NextResponse.json(payload);
}
