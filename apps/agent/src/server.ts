import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";
import * as nbt from "prismarine-nbt";
import { ZipFile } from "yazl";

type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "crashed";
type ServerSoftware = "fabric" | "paper";
type AddonKind = "mod" | "plugin";
type PlayerAction = "heal" | "kill";

type MotdStyle = {
  text: string;
  color: MinecraftColor;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  obfuscated: boolean;
};

type ServerRecord = {
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

type FabricLatest = {
  latestStableGame: string;
  latestGame: string;
  latestLoader: string;
  latestInstaller: string;
};

type PaperLatest = {
  latestVersion: string;
  latestBuild: number;
  channel: string;
  fileName: string;
  downloadUrl: string;
  javaMinimum?: number;
};

type ModrinthVersion = {
  id: string;
  name: string;
  version_number: string;
  version_type: "release" | "beta" | "alpha";
  files: Array<{
    url: string;
    filename: string;
    primary: boolean;
    size: number;
  }>;
};

type PlayerCoordinates = {
  world: string;
  x: number;
  y: number;
  z: number;
};

type PlayerRecord = {
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

type PlayerDetail = PlayerRecord & {
  health: number | null;
  foodLevel: number | null;
  xpLevel: number | null;
  inventory: InventoryItem[];
};

type InventoryItem = {
  slot: number;
  id: string;
  count: number;
  customName?: string;
};

type PaperProject = {
  versions: Record<string, string[]>;
};

type PaperBuild = {
  id: number;
  channel: string;
  version?: {
    java?: {
      version?: {
        minimum?: number;
      };
    };
  };
  downloads: {
    "server:default"?: {
      name: string;
      size: number;
      url: string;
    };
  };
};

const fixedMemoryMb = 6144;
const host = process.env.AGENT_HOST ?? "127.0.0.1";
const port = Number(process.env.AGENT_PORT ?? "8787");
const agentToken = process.env.AGENT_TOKEN ?? "";
const dataDir = path.resolve(process.env.MC_PANEL_DATA_DIR ?? path.join(process.cwd(), ".data"));
const serversDir = path.join(dataDir, "servers");
const metadataFile = path.join(dataDir, "servers.json");
const userAgent =
  process.env.MODRINTH_USER_AGENT ?? "z7i-minecraft-panel/0.2.0 (logeshms.cbe@gmail.com)";

const minecraftColors = {
  black: "0",
  dark_blue: "1",
  dark_green: "2",
  dark_aqua: "3",
  dark_red: "4",
  dark_purple: "5",
  gold: "6",
  gray: "7",
  dark_gray: "8",
  blue: "9",
  green: "a",
  aqua: "b",
  red: "c",
  light_purple: "d",
  yellow: "e",
  white: "f",
} as const;

type MinecraftColor = keyof typeof minecraftColors;

const processes = new Map<string, ChildProcessWithoutNullStreams>();
const subscribers = new Map<string, Set<ServerResponse>>();
const intentionalStops = new Set<string>();
const restartAttempts = new Map<string, number>();

function now() {
  return new Date().toISOString();
}

function slugify(input: string) {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return slug || "server";
}

function defaultMotd(name = "Z7i Minecraft"): MotdStyle {
  return {
    text: name,
    color: "white",
    bold: true,
    italic: false,
    underline: false,
    strikethrough: false,
    obfuscated: false,
  };
}

function normalizeMotd(input: Partial<MotdStyle> | undefined, fallbackText: string): MotdStyle {
  const color = input?.color && input.color in minecraftColors ? input.color : "white";

  return {
    text: String(input?.text ?? fallbackText).slice(0, 120) || fallbackText,
    color,
    bold: Boolean(input?.bold),
    italic: Boolean(input?.italic),
    underline: Boolean(input?.underline),
    strikethrough: Boolean(input?.strikethrough),
    obfuscated: Boolean(input?.obfuscated),
  };
}

function minecraftCode(code: string) {
  return `\\u00A7${code}`;
}

function motdToProperty(motd: MotdStyle) {
  const codes = [
    minecraftColors[motd.color],
    motd.bold ? "l" : "",
    motd.italic ? "o" : "",
    motd.underline ? "n" : "",
    motd.strikethrough ? "m" : "",
    motd.obfuscated ? "k" : "",
  ].filter(Boolean);

  return `${codes.map(minecraftCode).join("")}${escapePropertiesValue(motd.text)}`;
}

function escapePropertiesValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, " ").replace(/\r/g, " ").replace(/([:=#!])/g, "\\$1");
}

async function ensureStorage() {
  await fs.mkdir(serversDir, { recursive: true });
  try {
    await fs.access(metadataFile);
  } catch {
    await fs.writeFile(metadataFile, "[]\n", "utf8");
  }
}

function normalizeServer(server: Partial<ServerRecord> & { id: string; name: string }): ServerRecord {
  const software = server.software === "paper" ? "paper" : "fabric";

  return {
    id: server.id,
    name: server.name,
    status: server.status ?? "stopped",
    software,
    minecraftVersion: server.minecraftVersion ?? "unknown",
    fabricLoaderVersion: server.fabricLoaderVersion,
    fabricInstallerVersion: server.fabricInstallerVersion,
    paperBuild: server.paperBuild,
    jarName: server.jarName ?? (software === "paper" ? "server.jar" : "fabric-server-launcher.jar"),
    port: server.port ?? 25565,
    memoryMb: fixedMemoryMb,
    motd: normalizeMotd(server.motd, server.name),
    crackedMode: server.crackedMode ?? true,
    alwaysOn: server.alwaysOn ?? true,
    createdAt: server.createdAt ?? now(),
    updatedAt: server.updatedAt ?? now(),
    relativePath: server.relativePath ?? server.id,
  };
}

async function readServers(): Promise<ServerRecord[]> {
  await ensureStorage();
  const raw = await fs.readFile(metadataFile, "utf8");
  const servers = JSON.parse(raw) as Array<Partial<ServerRecord> & { id: string; name: string }>;

  return servers.map((server) => {
    const normalized = normalizeServer(server);
    return {
      ...normalized,
      status: processes.has(normalized.id)
        ? "running"
        : normalized.status === "running"
          ? "stopped"
          : normalized.status,
    };
  });
}

async function writeServers(servers: ServerRecord[]) {
  await fs.writeFile(metadataFile, `${JSON.stringify(servers, null, 2)}\n`, "utf8");
}

async function updateServer(id: string, patch: Partial<ServerRecord>) {
  const servers = await readServers();
  const index = servers.findIndex((server) => server.id === id);
  if (index === -1) {
    throw Object.assign(new Error("Server not found"), { statusCode: 404 });
  }

  const current = servers[index];
  if (!current) {
    throw Object.assign(new Error("Server not found"), { statusCode: 404 });
  }

  const next = normalizeServer({ ...current, ...patch, updatedAt: now() });
  servers[index] = next;
  await writeServers(servers);
  return next;
}

async function getServer(id: string) {
  const servers = await readServers();
  const server = servers.find((item) => item.id === id);
  if (!server) {
    throw Object.assign(new Error("Server not found"), { statusCode: 404 });
  }
  return server;
}

function serverPath(server: ServerRecord) {
  return path.join(serversDir, server.relativePath);
}

function playersFile(server: ServerRecord) {
  return path.join(serverPath(server), "players.json");
}

function safeResolve(root: string, requestedPath = ".") {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, requestedPath || ".");
  const insideRoot =
    resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);

  if (!insideRoot) {
    throw Object.assign(new Error("Path escapes the server directory"), { statusCode: 400 });
  }

  return resolvedTarget;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {} as T;
  }

  return JSON.parse(raw) as T;
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendError(response: ServerResponse, error: unknown) {
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 500;

  const message = error instanceof Error ? error.message : "Unexpected agent error";
  sendJson(response, statusCode, { error: message });
}

function requireAgentToken(request: IncomingMessage) {
  if (!agentToken) {
    throw Object.assign(new Error("AGENT_TOKEN is not configured"), { statusCode: 500 });
  }

  const header = request.headers.authorization ?? "";
  if (header !== `Bearer ${agentToken}`) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function getFabricLatest(): Promise<FabricLatest> {
  const [games, loaders, installers] = await Promise.all([
    fetchJson<Array<{ version: string; stable: boolean }>>("https://meta.fabricmc.net/v2/versions/game"),
    fetchJson<Array<{ version: string }>>("https://meta.fabricmc.net/v2/versions/loader"),
    fetchJson<Array<{ version: string }>>("https://meta.fabricmc.net/v2/versions/installer"),
  ]);

  const latestStableGame = games.find((game) => game.stable)?.version ?? games[0]?.version;
  const latestGame = games[0]?.version;
  const latestLoader = loaders[0]?.version;
  const latestInstaller = installers[0]?.version;

  if (!latestStableGame || !latestGame || !latestLoader || !latestInstaller) {
    throw new Error("Fabric metadata did not return usable versions");
  }

  return { latestStableGame, latestGame, latestLoader, latestInstaller };
}

async function getPaperLatest(): Promise<PaperLatest> {
  const project = await fetchJson<PaperProject>("https://fill.papermc.io/v3/projects/paper");
  const versions = Object.values(project.versions).flat();

  for (const version of versions.slice(0, 8)) {
    const builds = await fetchJson<PaperBuild[]>(
      `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds`,
    );
    const build = builds.find((item) => item.channel === "STABLE" && item.downloads["server:default"]) ?? builds[0];
    const download = build?.downloads["server:default"];

    if (build && download) {
      return {
        latestVersion: version,
        latestBuild: build.id,
        channel: build.channel,
        fileName: download.name,
        downloadUrl: download.url,
        javaMinimum: build.version?.java?.version?.minimum,
      };
    }
  }

  throw new Error("Paper metadata did not return a downloadable build");
}

async function downloadFile(url: string, destination: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  const body = Readable.fromWeb(response.body);
  await pipeline(body, createWriteStream(destination));
}

async function writeServerProperties(server: ServerRecord) {
  const root = serverPath(server);
  const file = path.join(root, "server.properties");
  const current = await fs.readFile(file, "utf8").catch(() => "");
  const properties = new Map<string, string>();

  for (const line of current.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#") || !line.includes("=")) {
      continue;
    }
    const [key, ...rest] = line.split("=");
    if (key) {
      properties.set(key.trim(), rest.join("="));
    }
  }

  properties.set("server-port", String(server.port));
  properties.set("motd", motdToProperty(server.motd));
  properties.set("online-mode", server.crackedMode ? "false" : "true");
  properties.set("enforce-secure-profile", server.crackedMode ? "false" : "true");
  properties.set("prevent-proxy-connections", "false");
  properties.set("enable-command-block", properties.get("enable-command-block") ?? "false");
  properties.set("view-distance", properties.get("view-distance") ?? "10");
  properties.set("simulation-distance", properties.get("simulation-distance") ?? "8");
  properties.set("max-players", properties.get("max-players") ?? "20");
  properties.set("level-name", properties.get("level-name") ?? "world");

  const content = Array.from(properties.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  await fs.writeFile(file, `${content}\n`, "utf8");
}

async function createServer(body: {
  name?: string;
  software?: ServerSoftware;
  minecraftVersion?: string;
  port?: number;
  motd?: Partial<MotdStyle>;
}) {
  const servers = await readServers();
  if (servers.length >= 1) {
    throw Object.assign(new Error("Only one Minecraft server can be created in this panel"), { statusCode: 409 });
  }

  const software: ServerSoftware = body.software === "fabric" ? "fabric" : "paper";
  const name = String(body.name ?? "Z7i Minecraft").trim().slice(0, 64) || "Z7i Minecraft";
  const selectedPort =
    body.port && body.port >= 25565 && body.port <= 25600 ? body.port : 25565;
  const id = `${slugify(name)}-${crypto.randomBytes(3).toString("hex")}`;
  const relativePath = id;
  const root = path.join(serversDir, relativePath);
  const motd = normalizeMotd(body.motd ?? defaultMotd(name), name);

  await fs.mkdir(path.join(root, "mods"), { recursive: true });
  await fs.mkdir(path.join(root, "plugins"), { recursive: true });
  await fs.mkdir(path.join(root, "config"), { recursive: true });
  await fs.mkdir(path.join(root, "world", "playerdata"), { recursive: true });

  let record: ServerRecord;

  if (software === "fabric") {
    const latest = await getFabricLatest();
    const minecraftVersion = body.minecraftVersion || latest.latestStableGame;
    const fabricLoaderVersion = latest.latestLoader;
    const fabricInstallerVersion = latest.latestInstaller;
    const jarName = "fabric-server-launcher.jar";
    const launcherUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(
      minecraftVersion,
    )}/${encodeURIComponent(fabricLoaderVersion)}/${encodeURIComponent(fabricInstallerVersion)}/server/jar`;

    await downloadFile(launcherUrl, path.join(root, jarName));

    record = {
      id,
      name,
      status: "stopped",
      software,
      minecraftVersion,
      fabricLoaderVersion,
      fabricInstallerVersion,
      jarName,
      port: selectedPort,
      memoryMb: fixedMemoryMb,
      motd,
      crackedMode: true,
      alwaysOn: true,
      createdAt: now(),
      updatedAt: now(),
      relativePath,
    };
  } else {
    const latest = await getPaperLatest();
    const minecraftVersion = body.minecraftVersion || latest.latestVersion;
    const jarName = "server.jar";

    await downloadFile(latest.downloadUrl, path.join(root, jarName));

    record = {
      id,
      name,
      status: "stopped",
      software,
      minecraftVersion,
      paperBuild: latest.latestBuild,
      jarName,
      port: selectedPort,
      memoryMb: fixedMemoryMb,
      motd,
      crackedMode: true,
      alwaysOn: true,
      createdAt: now(),
      updatedAt: now(),
      relativePath,
    };
  }

  await fs.writeFile(path.join(root, "eula.txt"), "eula=true\n", "utf8");
  await fs.writeFile(path.join(root, "server.log"), "", "utf8");
  await fs.writeFile(playersFile(record), "[]\n", "utf8");
  await writeServerProperties(record);

  await writeServers([record]);
  await appendLog(id, `Created ${software} ${record.minecraftVersion} server with 6144 MB RAM`);
  void startServer(id).catch((error: unknown) => {
    void appendLog(id, `Initial always-on start failed: ${error instanceof Error ? error.message : "unknown error"}`);
  });

  return record;
}

async function updateServerSettings(
  id: string,
  body: {
    name?: string;
    motd?: Partial<MotdStyle>;
    alwaysOn?: boolean;
  },
) {
  const server = await getServer(id);
  const nextName = String(body.name ?? server.name).trim().slice(0, 64) || server.name;
  const next = await updateServer(id, {
    name: nextName,
    motd: normalizeMotd(body.motd ?? server.motd, nextName),
    alwaysOn: body.alwaysOn ?? server.alwaysOn,
  });

  await writeServerProperties(next);
  await appendLog(id, `Updated server settings for ${next.name}`);

  if (next.alwaysOn && !processes.has(id)) {
    void startServer(id);
  }

  return next;
}

async function appendLog(id: string, line: string) {
  const server = await getServer(id).catch(() => null);
  if (!server) {
    return;
  }

  const formatted = line.endsWith("\n") ? line : `${line}\n`;
  await fs.appendFile(path.join(serverPath(server), "server.log"), formatted, "utf8");
  void recordPlayerEvent(server, formatted.trimEnd());

  const set = subscribers.get(id);
  if (!set) {
    return;
  }

  const event = `data: ${JSON.stringify({ line: formatted.trimEnd(), time: now() })}\n\n`;
  for (const response of set) {
    response.write(event);
  }
}

async function tailLog(id: string, limit: number) {
  const server = await getServer(id);
  const logFile = path.join(serverPath(server), "server.log");
  const raw = await fs.readFile(logFile, "utf8").catch(() => "");
  return raw.split(/\r?\n/).filter(Boolean).slice(-limit);
}

async function startServer(id: string) {
  const server = await getServer(id);
  if (processes.has(id)) {
    return server;
  }

  intentionalStops.delete(id);
  if (!server.alwaysOn) {
    await updateServer(id, { alwaysOn: true });
  }

  await updateServer(id, { status: "starting" });
  const root = serverPath(server);
  const child = spawn(
    "java",
    [`-Xms${fixedMemoryMb}M`, `-Xmx${fixedMemoryMb}M`, "-jar", server.jarName, "nogui"],
    {
      cwd: root,
      stdio: "pipe",
    },
  );

  processes.set(id, child);
  await appendLog(id, `Starting ${server.name} on port ${server.port}`);
  await updateServer(id, { status: "running" });
  setTimeout(() => {
    if (processes.get(id) === child) {
      restartAttempts.delete(id);
    }
  }, 120_000).unref();

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) {
      void appendLog(id, line);
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) {
      void appendLog(id, line);
    }
  });

  let handledExit = false;
  child.on("exit", (code) => {
    if (handledExit) {
      return;
    }
    handledExit = true;
    processes.delete(id);
    void appendLog(id, `Process exited with code ${code ?? "unknown"}`);
    void handleProcessExit(id, code);
  });

  child.on("error", (error) => {
    if (handledExit) {
      return;
    }
    handledExit = true;
    processes.delete(id);
    void appendLog(id, `Process failed to start: ${error.message}`);
    void handleProcessExit(id, 1);
  });

  return getServer(id);
}

async function stopServer(id: string) {
  intentionalStops.add(id);
  restartAttempts.delete(id);
  const child = processes.get(id);
  if (!child) {
    return updateServer(id, { status: "stopped", alwaysOn: false });
  }

  await updateServer(id, { status: "stopping", alwaysOn: false });
  child.stdin.write("stop\n");
  setTimeout(() => {
    if (processes.has(id)) {
      child.kill("SIGTERM");
    }
  }, 20_000).unref();

  return getServer(id);
}

async function handleProcessExit(id: string, code: number | null) {
  const server = await getServer(id).catch(() => null);
  if (!server) {
    return;
  }

  if (intentionalStops.has(id) || !server.alwaysOn) {
    intentionalStops.delete(id);
    await updateServer(id, { status: "stopped", alwaysOn: false });
    return;
  }

  const attempt = (restartAttempts.get(id) ?? 0) + 1;
  restartAttempts.set(id, attempt);
  const delayMs = Math.min(300_000, 15_000 * 2 ** Math.min(attempt - 1, 5));
  await updateServer(id, { status: code === 0 ? "stopped" : "crashed" });
  await appendLog(id, `Always-on restart scheduled in ${Math.round(delayMs / 1000)} seconds`);

  setTimeout(() => {
    void startServer(id).catch((error: unknown) => {
      void appendLog(id, `Always-on restart failed: ${error instanceof Error ? error.message : "unknown error"}`);
    });
  }, delayMs).unref();
}

async function startAlwaysOnServers() {
  const servers = await readServers();
  for (const server of servers.filter((item) => item.alwaysOn)) {
    void startServer(server.id).catch((error: unknown) => {
      void appendLog(server.id, `Always-on boot start failed: ${error instanceof Error ? error.message : "unknown error"}`);
    });
  }
}

async function sendCommand(id: string, command: string) {
  const child = processes.get(id);
  if (!child) {
    throw Object.assign(new Error("Server is not running"), { statusCode: 409 });
  }

  child.stdin.write(`${command.replace(/\r?\n/g, " ")}\n`);
  await appendLog(id, `> ${command}`);
  return { ok: true };
}

async function listFiles(id: string, requestedPath: string) {
  const server = await getServer(id);
  const root = serverPath(server);
  const target = safeResolve(root, requestedPath);
  const stats = await fs.stat(target);

  if (!stats.isDirectory()) {
    throw Object.assign(new Error("Path is not a directory"), { statusCode: 400 });
  }

  const entries = await Promise.all(
    (await fs.readdir(target, { withFileTypes: true })).map(async (entry) => {
      const absolute = path.join(target, entry.name);
      const entryStats = await fs.stat(absolute);
      const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
      return {
        name: entry.name,
        path: relative || ".",
        type: entry.isDirectory() ? "directory" : "file",
        size: entryStats.size,
        modifiedAt: entryStats.mtime.toISOString(),
      };
    }),
  );

  return {
    path: path.relative(root, target).replaceAll(path.sep, "/") || ".",
    entries: entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1,
    ),
  };
}

async function addDirectoryToZip(zip: ZipFile, root: string, directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");

    if (entry.isDirectory()) {
      zip.addEmptyDirectory(relative);
      await addDirectoryToZip(zip, root, absolute);
      continue;
    }

    if (entry.isFile()) {
      zip.addFile(absolute, relative);
    }
  }
}

async function streamServerArchive(id: string, response: ServerResponse) {
  const server = await getServer(id);
  const root = serverPath(server);
  const zip = new ZipFile();
  const filename = `${slugify(server.name)}-${new Date().toISOString().slice(0, 10)}.zip`;

  response.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });

  zip.outputStream.pipe(response);
  zip.on("error", (error) => {
    response.destroy(error);
  });

  await addDirectoryToZip(zip, root, root);
  zip.end();
  await appendLog(id, `Exported server files as ${filename}`);
}

async function readFile(id: string, requestedPath: string) {
  const server = await getServer(id);
  const target = safeResolve(serverPath(server), requestedPath);
  const stats = await fs.stat(target);

  if (!stats.isFile()) {
    throw Object.assign(new Error("Path is not a file"), { statusCode: 400 });
  }

  if (stats.size > 1024 * 1024) {
    throw Object.assign(new Error("File is larger than the 1 MB editor limit"), { statusCode: 400 });
  }

  const content = await fs.readFile(target, "utf8");
  if (content.includes("\u0000")) {
    throw Object.assign(new Error("Binary files cannot be edited in the panel"), { statusCode: 400 });
  }

  return { path: requestedPath, content };
}

async function writeTextFile(id: string, requestedPath: string, content: string) {
  if (Buffer.byteLength(content, "utf8") > 1024 * 1024) {
    throw Object.assign(new Error("File content is larger than the 1 MB editor limit"), { statusCode: 400 });
  }

  const server = await getServer(id);
  const target = safeResolve(serverPath(server), requestedPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  await appendLog(id, `Edited file ${requestedPath}`);
  return { ok: true };
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._+ -]/g, "_").slice(0, 160);
}

function addonConfig(server: ServerRecord, kind: AddonKind) {
  if (kind === "mod") {
    if (server.software !== "fabric") {
      throw Object.assign(new Error("Fabric mods can only be installed on a Fabric server"), { statusCode: 400 });
    }
    return { folder: "mods", loaders: ["fabric"] };
  }

  if (server.software !== "paper") {
    throw Object.assign(new Error("Paper plugins can only be installed on a Paper server"), { statusCode: 400 });
  }
  return { folder: "plugins", loaders: ["paper", "spigot", "bukkit"] };
}

async function installModrinth(id: string, projectId: string, kind: AddonKind) {
  const server = await getServer(id);
  const config = addonConfig(server, kind);
  const query = new URLSearchParams({
    loaders: JSON.stringify(config.loaders),
    game_versions: JSON.stringify([server.minecraftVersion]),
    include_changelog: "false",
  });
  const versions = await fetchJson<ModrinthVersion[]>(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?${query.toString()}`,
  );
  const version = versions.find((item) => item.version_type === "release") ?? versions[0];
  const file = version?.files.find((item) => item.primary) ?? version?.files[0];

  if (!version || !file) {
    throw Object.assign(new Error("No compatible Modrinth file found"), { statusCode: 404 });
  }

  const downloadUrl = new URL(file.url);
  if (downloadUrl.hostname !== "cdn.modrinth.com" || !file.filename.endsWith(".jar")) {
    throw Object.assign(new Error("Unsupported Modrinth download target"), { statusCode: 400 });
  }

  const destination = path.join(serverPath(server), config.folder, safeFilename(file.filename));
  await downloadFile(file.url, destination);
  await appendLog(id, `Installed ${kind} ${file.filename}`);

  return {
    ok: true,
    kind,
    version: version.version_number,
    filename: file.filename,
    size: file.size,
  };
}

function offlineUuid(name: string) {
  const bytes = crypto.createHash("md5").update(`OfflinePlayer:${name}`, "utf8").digest();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x30;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function avatarUrl(name: string) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`;
}

function playerKey(record: Pick<PlayerRecord, "name" | "uuid">) {
  return `${record.uuid}:${record.name.toLowerCase()}`;
}

function createPlayer(name: string, uuid = offlineUuid(name)): PlayerRecord {
  return {
    name,
    uuid,
    firstSeen: now(),
    lastSeen: now(),
    lastJoin: null,
    lastQuit: null,
    online: false,
    lastIp: null,
    lastCoordinates: null,
    avatarUrl: avatarUrl(name),
    playerDataPath: null,
  };
}

async function readPlayersIndex(server: ServerRecord) {
  const file = playersFile(server);
  try {
    const raw = await fs.readFile(file, "utf8");
    const records = JSON.parse(raw) as PlayerRecord[];
    return records.map((record) => ({
      ...createPlayer(record.name, record.uuid),
      ...record,
      avatarUrl: record.avatarUrl || avatarUrl(record.name),
    }));
  } catch {
    return [] as PlayerRecord[];
  }
}

async function writePlayersIndex(server: ServerRecord, records: PlayerRecord[]) {
  const unique = new Map<string, PlayerRecord>();
  for (const record of records) {
    unique.set(playerKey(record), record);
  }
  await fs.writeFile(playersFile(server), `${JSON.stringify(Array.from(unique.values()), null, 2)}\n`, "utf8");
}

function upsertPlayer(records: PlayerRecord[], name: string, patch: Partial<PlayerRecord> = {}) {
  const uuid = patch.uuid ?? offlineUuid(name);
  const index = records.findIndex(
    (record) => record.uuid === uuid || record.name.toLowerCase() === name.toLowerCase(),
  );
  const current = index >= 0 && records[index] ? records[index] : createPlayer(name, uuid);
  const next: PlayerRecord = {
    ...current,
    ...patch,
    name,
    uuid,
    avatarUrl: avatarUrl(name),
    lastSeen: now(),
  };

  if (index >= 0) {
    records[index] = next;
  } else {
    records.push(next);
  }

  return next;
}

function parseCoordinates(input: string): PlayerCoordinates | null {
  const match = input.match(/\[([^\]]+)\](-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
    return null;
  }

  return {
    world: match[1],
    x: Number(match[2]),
    y: Number(match[3]),
    z: Number(match[4]),
  };
}

function applyPlayerLogLine(records: PlayerRecord[], line: string) {
  const uuidMatch = line.match(/UUID of player ([A-Za-z0-9_]{1,16}) is ([0-9a-fA-F-]{36})/);
  if (uuidMatch?.[1] && uuidMatch[2]) {
    upsertPlayer(records, uuidMatch[1], { uuid: uuidMatch[2].toLowerCase() });
    return;
  }

  const loginMatch = line.match(
    /([A-Za-z0-9_]{1,16})\[\/([^:\]]+)(?::\d+)?\] logged in with entity id \d+ at \((.+)\)/,
  );
  if (loginMatch?.[1]) {
    upsertPlayer(records, loginMatch[1], {
      online: true,
      lastJoin: now(),
      lastIp: loginMatch[2] ?? null,
      lastCoordinates: loginMatch[3] ? parseCoordinates(loginMatch[3]) : null,
    });
    return;
  }

  const joinedMatch = line.match(/([A-Za-z0-9_]{1,16}) joined the game/);
  if (joinedMatch?.[1]) {
    upsertPlayer(records, joinedMatch[1], { online: true, lastJoin: now() });
    return;
  }

  const quitMatch = line.match(/([A-Za-z0-9_]{1,16}) (left the game|lost connection:)/);
  if (quitMatch?.[1]) {
    upsertPlayer(records, quitMatch[1], { online: false, lastQuit: now() });
  }
}

async function recordPlayerEvent(server: ServerRecord, line: string) {
  const records = await readPlayersIndex(server);
  applyPlayerLogLine(records, line);
  await writePlayersIndex(server, records);
}

async function getLevelName(server: ServerRecord) {
  const properties = await fs.readFile(path.join(serverPath(server), "server.properties"), "utf8").catch(() => "");
  const line = properties.split(/\r?\n/).find((item) => item.startsWith("level-name="));
  return line?.split("=").slice(1).join("=") || "world";
}

async function playerDataDirectory(server: ServerRecord) {
  return path.join(serverPath(server), await getLevelName(server), "playerdata");
}

async function syncPlayersFromDisk(server: ServerRecord) {
  const records = await readPlayersIndex(server);
  if (records.length === 0) {
    const log = await fs.readFile(path.join(serverPath(server), "server.log"), "utf8").catch(() => "");
    for (const line of log.split(/\r?\n/).filter(Boolean)) {
      applyPlayerLogLine(records, line);
    }
  }

  const usercache = await fs.readFile(path.join(serverPath(server), "usercache.json"), "utf8").catch(() => "[]");
  for (const entry of JSON.parse(usercache) as Array<{ name?: string; uuid?: string }>) {
    if (entry.name) {
      upsertPlayer(records, entry.name, { uuid: entry.uuid?.toLowerCase() ?? offlineUuid(entry.name) });
    }
  }

  const playerdata = await playerDataDirectory(server);
  const files = await fs.readdir(playerdata).catch(() => [] as string[]);
  for (const filename of files.filter((item) => item.endsWith(".dat"))) {
    const uuid = filename.replace(/\.dat$/, "").toLowerCase();
    const existing = records.find((record) => record.uuid === uuid);
    if (existing) {
      existing.playerDataPath = path.relative(serverPath(server), path.join(playerdata, filename)).replaceAll(path.sep, "/");
      const detail = await readPlayerDat(server, existing).catch(() => null);
      if (detail?.lastCoordinates) {
        existing.lastCoordinates = detail.lastCoordinates;
      }
    } else {
      const name = uuid.slice(0, 8);
      records.push({
        ...createPlayer(name, uuid),
        playerDataPath: path.relative(serverPath(server), path.join(playerdata, filename)).replaceAll(path.sep, "/"),
      });
    }
  }

  await writePlayersIndex(server, records);
  return records.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

async function readPlayerDat(server: ServerRecord, player: PlayerRecord): Promise<PlayerDetail> {
  const playerdata = await playerDataDirectory(server);
  const file = path.join(playerdata, `${player.uuid}.dat`);
  const raw = await fs.readFile(file);
  const parsed = await nbt.parse(raw);
  const data = nbt.simplify(parsed.parsed) as Record<string, unknown>;
  const pos = Array.isArray(data.Pos) ? data.Pos.map(Number) : null;
  const inventory = Array.isArray(data.Inventory) ? data.Inventory : [];

  return {
    ...player,
    playerDataPath: path.relative(serverPath(server), file).replaceAll(path.sep, "/"),
    health: typeof data.Health === "number" ? data.Health : null,
    foodLevel: typeof data.foodLevel === "number" ? data.foodLevel : null,
    xpLevel: typeof data.XpLevel === "number" ? data.XpLevel : null,
    lastCoordinates:
      pos && pos.length >= 3
        ? {
            world: typeof data.Dimension === "string" ? data.Dimension : "world",
            x: Number(pos[0]),
            y: Number(pos[1]),
            z: Number(pos[2]),
          }
        : player.lastCoordinates,
    inventory: inventory
      .map((item) => item as Record<string, unknown>)
      .map((item) => ({
        slot: Number(item.Slot ?? 0),
        id: String(item.id ?? "unknown"),
        count: Number(item.Count ?? 0),
        customName:
          typeof item.tag === "object" && item.tag !== null
            ? JSON.stringify(item.tag).slice(0, 120)
            : undefined,
      }))
      .sort((a, b) => a.slot - b.slot),
  };
}

async function findPlayer(server: ServerRecord, key: string) {
  const records = await syncPlayersFromDisk(server);
  const decoded = decodeURIComponent(key).toLowerCase();
  const player = records.find(
    (record) => record.uuid.toLowerCase() === decoded || record.name.toLowerCase() === decoded,
  );

  if (!player) {
    throw Object.assign(new Error("Player not found"), { statusCode: 404 });
  }

  return player;
}

async function getPlayers(id: string) {
  const server = await getServer(id);
  const root = serverPath(server);
  const readJsonArray = async (filename: string) => {
    const raw = await fs.readFile(path.join(root, filename), "utf8").catch(() => "[]");
    return JSON.parse(raw) as unknown[];
  };

  return {
    players: await syncPlayersFromDisk(server),
    operators: await readJsonArray("ops.json"),
    whitelist: await readJsonArray("whitelist.json"),
    bannedPlayers: await readJsonArray("banned-players.json"),
  };
}

async function getPlayer(id: string, key: string) {
  const server = await getServer(id);
  const player = await findPlayer(server, key);
  return readPlayerDat(server, player).catch(() => ({
    ...player,
    health: null,
    foodLevel: null,
    xpLevel: null,
    inventory: [],
  }));
}

function safePlayerName(name: string) {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    throw Object.assign(new Error("Player name cannot be used safely in a command"), { statusCode: 400 });
  }
  return name;
}

async function mutatePlayerDat(server: ServerRecord, player: PlayerRecord, action: PlayerAction) {
  const playerdata = await playerDataDirectory(server);
  const file = path.join(playerdata, `${player.uuid}.dat`);
  const raw = await fs.readFile(file);
  const parsed = await nbt.parse(raw);
  const root = parsed.parsed.value as Record<string, nbt.Tags[nbt.TagType] | undefined>;

  if (action === "heal") {
    root.Health = nbt.float(20);
    root.foodLevel = nbt.int(20);
    root.foodSaturationLevel = nbt.float(20);
    root.fire = nbt.short(0);
  } else {
    root.Health = nbt.float(0);
    root.HurtTime = nbt.short(10);
  }

  await fs.writeFile(file, gzipSync(nbt.writeUncompressed(parsed.parsed)));
}

async function playerAction(id: string, key: string, action: PlayerAction) {
  const server = await getServer(id);
  const player = await findPlayer(server, key);
  const child = processes.get(id);
  const canCommand = child && player.online;

  if (canCommand) {
    const target = safePlayerName(player.name);
    if (action === "heal") {
      child.stdin.write(`effect give ${target} minecraft:instant_health 1 255 true\n`);
      child.stdin.write(`effect give ${target} minecraft:saturation 1 255 true\n`);
    } else {
      child.stdin.write(`kill ${target}\n`);
    }
  } else {
    await mutatePlayerDat(server, player, action);
  }

  await appendLog(id, `${action === "heal" ? "Healed" : "Killed"} ${player.name} from panel`);
  return { ok: true, player: await getPlayer(id, player.uuid) };
}

async function streamLogs(id: string, response: ServerResponse) {
  await getServer(id);
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
  });

  const set = subscribers.get(id) ?? new Set<ServerResponse>();
  set.add(response);
  subscribers.set(id, set);

  for (const line of await tailLog(id, 80)) {
    response.write(`data: ${JSON.stringify({ line, time: now() })}\n\n`);
  }

  response.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  response.on("close", () => {
    set.delete(response);
    if (set.size === 0) {
      subscribers.delete(id);
    }
  });
}

function methodNotAllowed(response: ServerResponse) {
  sendJson(response, 405, { error: "Method not allowed" });
}

async function route(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(response, 200, { ok: true, dataDir });
    return;
  }

  requireAgentToken(request);

  if (url.pathname === "/fabric/latest") {
    sendJson(response, 200, await getFabricLatest());
    return;
  }

  if (url.pathname === "/paper/latest") {
    sendJson(response, 200, await getPaperLatest());
    return;
  }

  if (url.pathname === "/servers") {
    if (request.method === "GET") {
      sendJson(response, 200, await readServers());
      return;
    }

    if (request.method === "POST") {
      sendJson(response, 201, await createServer(await readJsonBody(request)));
      return;
    }

    methodNotAllowed(response);
    return;
  }

  const playerMatch = url.pathname.match(/^\/servers\/([^/]+)\/players\/([^/]+)$/);
  if (playerMatch?.[1] && playerMatch[2]) {
    const id = decodeURIComponent(playerMatch[1]);
    const key = decodeURIComponent(playerMatch[2]);

    if (request.method === "GET") {
      sendJson(response, 200, await getPlayer(id, key));
      return;
    }

    if (request.method === "POST") {
      const body = await readJsonBody<{ action?: PlayerAction }>(request);
      if (body.action !== "heal" && body.action !== "kill") {
        sendJson(response, 400, { error: "Unknown player action" });
        return;
      }
      sendJson(response, 200, await playerAction(id, key, body.action));
      return;
    }
  }

  const match = url.pathname.match(/^\/servers\/([^/]+)(?:\/(.+))?$/);
  if (!match?.[1]) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const id = decodeURIComponent(match[1]);
  const action = match[2] ?? "";

  if (!action && request.method === "GET") {
    sendJson(response, 200, await getServer(id));
    return;
  }

  if (action === "settings" && request.method === "PATCH") {
    sendJson(response, 200, await updateServerSettings(id, await readJsonBody(request)));
    return;
  }

  if (action === "start" && request.method === "POST") {
    sendJson(response, 200, await startServer(id));
    return;
  }

  if (action === "stop" && request.method === "POST") {
    sendJson(response, 200, await stopServer(id));
    return;
  }

  if (action === "command" && request.method === "POST") {
    const body = await readJsonBody<{ command?: string }>(request);
    sendJson(response, 200, await sendCommand(id, String(body.command ?? "")));
    return;
  }

  if (action === "logs" && request.method === "GET") {
    sendJson(response, 200, { lines: await tailLog(id, Number(url.searchParams.get("tail") ?? "300")) });
    return;
  }

  if (action === "logs/stream" && request.method === "GET") {
    await streamLogs(id, response);
    return;
  }

  if (action === "files" && request.method === "GET") {
    sendJson(response, 200, await listFiles(id, url.searchParams.get("path") ?? "."));
    return;
  }

  if (action === "archive" && request.method === "GET") {
    await streamServerArchive(id, response);
    return;
  }

  if (action === "file" && request.method === "GET") {
    sendJson(response, 200, await readFile(id, url.searchParams.get("path") ?? "server.properties"));
    return;
  }

  if (action === "file" && request.method === "PUT") {
    const body = await readJsonBody<{ path?: string; content?: string }>(request);
    sendJson(response, 200, await writeTextFile(id, String(body.path ?? ""), String(body.content ?? "")));
    return;
  }

  if (action === "addons/modrinth" && request.method === "POST") {
    const body = await readJsonBody<{ projectId?: string; kind?: AddonKind }>(request);
    const kind = body.kind === "mod" ? "mod" : "plugin";
    sendJson(response, 200, await installModrinth(id, String(body.projectId ?? ""), kind));
    return;
  }

  if (action === "players" && request.method === "GET") {
    sendJson(response, 200, await getPlayers(id));
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

await ensureStorage();
const server = http.createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    sendError(response, error);
  });
});

server.listen(port, host, () => {
  console.log(`Z7i Minecraft agent listening on http://${host}:${port}`);
  void startAlwaysOnServers();
});
