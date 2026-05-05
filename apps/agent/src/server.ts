import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "crashed";

type ServerRecord = {
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

type FabricLatest = {
  latestStableGame: string;
  latestGame: string;
  latestLoader: string;
  latestInstaller: string;
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

const host = process.env.AGENT_HOST ?? "127.0.0.1";
const port = Number(process.env.AGENT_PORT ?? "8787");
const agentToken = process.env.AGENT_TOKEN ?? "";
const dataDir = path.resolve(process.env.MC_PANEL_DATA_DIR ?? path.join(process.cwd(), ".data"));
const serversDir = path.join(dataDir, "servers");
const metadataFile = path.join(dataDir, "servers.json");
const userAgent =
  process.env.MODRINTH_USER_AGENT ?? "minecraft-vps-panel/0.1.0 (logeshms.cbe@gmail.com)";

const processes = new Map<string, ChildProcessWithoutNullStreams>();
const subscribers = new Map<string, Set<ServerResponse>>();

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

async function ensureStorage() {
  await fs.mkdir(serversDir, { recursive: true });
  try {
    await fs.access(metadataFile);
  } catch {
    await fs.writeFile(metadataFile, "[]\n", "utf8");
  }
}

async function readServers(): Promise<ServerRecord[]> {
  await ensureStorage();
  const raw = await fs.readFile(metadataFile, "utf8");
  const servers = JSON.parse(raw) as ServerRecord[];

  return servers.map((server) => ({
    ...server,
    status: processes.has(server.id) ? "running" : server.status === "running" ? "stopped" : server.status,
  }));
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

  const next = { ...current, ...patch, updatedAt: now() };
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

async function createServer(body: {
  name?: string;
  minecraftVersion?: string;
  fabricLoaderVersion?: string;
  fabricInstallerVersion?: string;
  port?: number;
  memoryMb?: number;
}) {
  const latest = await getFabricLatest();
  const name = String(body.name ?? "Fabric Server").trim().slice(0, 64) || "Fabric Server";
  const minecraftVersion = body.minecraftVersion || latest.latestStableGame;
  const fabricLoaderVersion = body.fabricLoaderVersion || latest.latestLoader;
  const fabricInstallerVersion = body.fabricInstallerVersion || latest.latestInstaller;
  const servers = await readServers();
  const usedPorts = new Set(servers.map((server) => server.port));
  const selectedPort =
    body.port && body.port >= 25565 && body.port <= 25600
      ? body.port
      : Array.from({ length: 36 }, (_, index) => 25565 + index).find((candidate) => !usedPorts.has(candidate));

  if (!selectedPort) {
    throw Object.assign(new Error("No free Minecraft port found in 25565-25600"), { statusCode: 400 });
  }

  if (usedPorts.has(selectedPort)) {
    throw Object.assign(new Error(`Port ${selectedPort} is already assigned`), { statusCode: 400 });
  }

  const memoryMb = Math.min(Math.max(Number(body.memoryMb ?? 4096), 1024), 32768);
  const id = `${slugify(name)}-${crypto.randomBytes(3).toString("hex")}`;
  const relativePath = id;
  const root = path.join(serversDir, relativePath);
  const launcherJar = path.join(root, "fabric-server-launcher.jar");
  const launcherUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(
    minecraftVersion,
  )}/${encodeURIComponent(fabricLoaderVersion)}/${encodeURIComponent(fabricInstallerVersion)}/server/jar`;

  await fs.mkdir(path.join(root, "mods"), { recursive: true });
  await fs.mkdir(path.join(root, "config"), { recursive: true });
  await downloadFile(launcherUrl, launcherJar);
  await fs.writeFile(path.join(root, "eula.txt"), "eula=true\n", "utf8");
  await fs.writeFile(
    path.join(root, "server.properties"),
    [
      `server-port=${selectedPort}`,
      `motd=${name}`,
      "online-mode=true",
      "enable-command-block=false",
      "view-distance=10",
      "simulation-distance=8",
      "max-players=20",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(root, "server.log"), "", "utf8");

  const record: ServerRecord = {
    id,
    name,
    status: "stopped",
    minecraftVersion,
    fabricLoaderVersion,
    fabricInstallerVersion,
    port: selectedPort,
    memoryMb,
    createdAt: now(),
    updatedAt: now(),
    relativePath,
  };

  servers.push(record);
  await writeServers(servers);
  await appendLog(id, `Created Fabric ${minecraftVersion} server with loader ${fabricLoaderVersion}`);

  return record;
}

async function appendLog(id: string, line: string) {
  const server = await getServer(id).catch(() => null);
  if (!server) {
    return;
  }

  const formatted = line.endsWith("\n") ? line : `${line}\n`;
  await fs.appendFile(path.join(serverPath(server), "server.log"), formatted, "utf8");

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

  await updateServer(id, { status: "starting" });
  const root = serverPath(server);
  const child = spawn(
    "java",
    [`-Xms${Math.min(1024, server.memoryMb)}M`, `-Xmx${server.memoryMb}M`, "-jar", "fabric-server-launcher.jar", "nogui"],
    {
      cwd: root,
      stdio: "pipe",
    },
  );

  processes.set(id, child);
  await appendLog(id, `Starting ${server.name} on port ${server.port}`);
  await updateServer(id, { status: "running" });

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

  child.on("exit", (code) => {
    processes.delete(id);
    void appendLog(id, `Process exited with code ${code ?? "unknown"}`);
    void updateServer(id, { status: code === 0 ? "stopped" : "crashed" });
  });

  return getServer(id);
}

async function stopServer(id: string) {
  const child = processes.get(id);
  if (!child) {
    return updateServer(id, { status: "stopped" });
  }

  await updateServer(id, { status: "stopping" });
  child.stdin.write("stop\n");
  setTimeout(() => {
    if (processes.has(id)) {
      child.kill("SIGTERM");
    }
  }, 20_000).unref();

  return getServer(id);
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
    entries: entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1)),
  };
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

async function installModrinth(id: string, projectId: string) {
  const server = await getServer(id);
  const query = new URLSearchParams({
    loaders: JSON.stringify(["fabric"]),
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

  const destination = path.join(serverPath(server), "mods", safeFilename(file.filename));
  await downloadFile(file.url, destination);
  await appendLog(id, `Installed Modrinth add-on ${file.filename}`);

  return {
    ok: true,
    version: version.version_number,
    filename: file.filename,
    size: file.size,
  };
}

async function getPlayers(id: string) {
  const server = await getServer(id);
  const root = serverPath(server);
  const readJsonArray = async (filename: string) => {
    const raw = await fs.readFile(path.join(root, filename), "utf8").catch(() => "[]");
    return JSON.parse(raw) as unknown[];
  };
  const lines = await tailLog(id, 200);
  const lastListLine = [...lines].reverse().find((line) => line.includes("players online"));

  return {
    operators: await readJsonArray("ops.json"),
    whitelist: await readJsonArray("whitelist.json"),
    bannedPlayers: await readJsonArray("banned-players.json"),
    lastListLine: lastListLine ?? null,
  };
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
    const body = await readJsonBody<{ projectId?: string }>(request);
    sendJson(response, 200, await installModrinth(id, String(body.projectId ?? "")));
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
  console.log(`Minecraft panel agent listening on http://${host}:${port}`);
});
