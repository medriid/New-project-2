export type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "crashed";

export type FabricLatest = {
  latestStableGame: string;
  latestGame: string;
  latestLoader: string;
  latestInstaller: string;
};

export type ServerRecord = {
  id: string;
  name: string;
  status: ServerStatus;
  minecraftVersion: string;
  fabricLoaderVersion: string;
  fabricInstallerVersion: string;
  port: number;
  memoryMb: number;
  createdAt: string;
  updatedAt: string;
  relativePath: string;
};

export type FileEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
  size: number;
  modifiedAt: string;
};

export type ModrinthSearchHit = {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  icon_url: string | null;
  categories: string[];
  versions: string[];
};
