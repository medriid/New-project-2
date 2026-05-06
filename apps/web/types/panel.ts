export type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "crashed";
export type ServerSoftware = "fabric" | "paper";
export type AddonKind = "mod" | "plugin";
export type MinecraftColor =
  | "black"
  | "dark_blue"
  | "dark_green"
  | "dark_aqua"
  | "dark_red"
  | "dark_purple"
  | "gold"
  | "gray"
  | "dark_gray"
  | "blue"
  | "green"
  | "aqua"
  | "red"
  | "light_purple"
  | "yellow"
  | "white";

export type MotdStyle = {
  text: string;
  color: MinecraftColor;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  obfuscated: boolean;
};

export type FabricLatest = {
  latestStableGame: string;
  latestGame: string;
  latestLoader: string;
  latestInstaller: string;
};

export type PaperLatest = {
  latestVersion: string;
  latestBuild: number;
  channel: string;
  fileName: string;
  downloadUrl: string;
  javaMinimum?: number;
};

export type ServerRecord = {
  id: string;
  name: string;
  status: ServerStatus;
  software: ServerSoftware;
  minecraftVersion: string;
  fabricLoaderVersion?: string;
  fabricInstallerVersion?: string;
  paperBuild?: number;
  jarName: string;
  port: number;
  memoryMb: number;
  motd: MotdStyle;
  crackedMode: boolean;
  alwaysOn: boolean;
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

export type PlayerCoordinates = {
  world: string;
  x: number;
  y: number;
  z: number;
};

export type PlayerRecord = {
  name: string;
  uuid: string;
  firstSeen: string;
  lastSeen: string;
  lastJoin: string | null;
  lastQuit: string | null;
  online: boolean;
  lastIp: string | null;
  lastCoordinates: PlayerCoordinates | null;
  avatarUrl: string;
  playerDataPath: string | null;
};

export type InventoryItem = {
  slot: number;
  id: string;
  count: number;
  customName?: string;
};

export type PlayerDetail = PlayerRecord & {
  health: number | null;
  foodLevel: number | null;
  xpLevel: number | null;
  inventory: InventoryItem[];
};

export type PlayerSummary = {
  players: PlayerRecord[];
  operators: unknown[];
  whitelist: unknown[];
  bannedPlayers: unknown[];
};
