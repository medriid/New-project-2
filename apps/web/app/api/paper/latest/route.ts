import { NextResponse } from "next/server";

import type { PaperLatest } from "@/types/panel";

type PaperProject = {
  versions: Record<string, string[]>;
};

type PaperBuild = {
  id: number;
  channel: string;
  downloads: {
    "server:default"?: {
      name: string;
      size: number;
      url: string;
    };
  };
};

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "z7i-minecraft-panel/0.2.0 (logeshms.cbe@gmail.com)",
    },
    next: {
      revalidate: 3600,
    },
  });

  if (!response.ok) {
    throw new Error(`Paper metadata failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function GET() {
  const project = await fetchJson<PaperProject>("https://fill.papermc.io/v3/projects/paper");
  const versions = Object.values(project.versions).flat();

  for (const version of versions.slice(0, 8)) {
    const builds = await fetchJson<PaperBuild[]>(
      `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds`,
    );
    const build = builds.find((item) => item.channel === "STABLE" && item.downloads["server:default"]) ?? builds[0];
    const download = build?.downloads["server:default"];

    if (build && download) {
      const payload: PaperLatest = {
        latestVersion: version,
        latestBuild: build.id,
        channel: build.channel,
        fileName: download.name,
        downloadUrl: download.url,
      };
      return NextResponse.json(payload);
    }
  }

  return NextResponse.json({ error: "No Paper build found" }, { status: 404 });
}
