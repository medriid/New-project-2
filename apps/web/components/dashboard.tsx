"use client";

import {
  Activity,
  Badge,
  Circle,
  Cloud,
  Crosshair,
  Download,
  FileText,
  Folder,
  FolderTree,
  Gauge,
  HeartPulse,
  ListRestart,
  LogOut,
  Package,
  PackageSearch,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  Skull,
  Square,
  Terminal,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import type {
  AddonKind,
  DriveBackupStatus,
  FabricLatest,
  FileEntry,
  MinecraftColor,
  ModrinthSearchHit,
  MotdStyle,
  PaperLatest,
  PlayerDetail,
  PlayerRecord,
  PlayerSummary,
  ServerRecord,
  ServerSoftware,
} from "@/types/panel";

type DashboardProps = {
  userEmail: string;
  isOwner: boolean;
  ownerEmail: string;
};

type Tab =
  | "overview"
  | "console"
  | "files"
  | "mods"
  | "plugins"
  | "datapacks"
  | "players"
  | "backups"
  | "settings";

const tabs: Array<{ id: Tab; label: string; icon: typeof Gauge }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "console", label: "Console", icon: Terminal },
  { id: "files", label: "Files", icon: FolderTree },
  { id: "mods", label: "Mods", icon: Package },
  { id: "plugins", label: "Plugins", icon: PackageSearch },
  { id: "datapacks", label: "Datapacks", icon: Download },
  { id: "players", label: "Players", icon: Users },
  { id: "backups", label: "Backups", icon: Cloud },
  { id: "settings", label: "Settings", icon: Settings },
];

const colors: MinecraftColor[] = [
  "white",
  "gray",
  "dark_gray",
  "black",
  "red",
  "gold",
  "yellow",
  "green",
  "aqua",
  "blue",
  "light_purple",
  "dark_purple",
];

const defaultMotd: MotdStyle = {
  text: "Z7i Minecraft",
  color: "white",
  bold: true,
  italic: false,
  underline: false,
  strikethrough: false,
  obfuscated: false,
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const payload = (await response.json()) as T | { error?: string };

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload && payload.error
        ? payload.error
        : "Request failed";
    throw new Error(message);
  }

  return payload as T;
}

async function requestForm<T>(url: string, formData: FormData): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json()) as T | { error?: string };

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload && payload.error
        ? payload.error
        : "Upload failed";
    throw new Error(message);
  }

  return payload as T;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function coordinateLine(player: PlayerRecord | PlayerDetail | null) {
  const coordinates = player?.lastCoordinates;
  if (!coordinates) {
    return "Unknown";
  }

  return `${coordinates.world} ${coordinates.x.toFixed(1)}, ${coordinates.y.toFixed(1)}, ${coordinates.z.toFixed(1)}`;
}

function statValue(value: number | null | undefined, suffix = "") {
  if (value === null || typeof value === "undefined" || Number.isNaN(value)) {
    return "Unavailable";
  }

  return `${value}${suffix}`;
}

function StatusDot({ status }: { status: ServerRecord["status"] }) {
  const isOnline = status === "running" || status === "starting";
  return (
    <span className={`status-dot ${isOnline ? "online" : "offline"}`}>
      <Circle size={10} fill={isOnline ? "#22c55e" : "#ef4444"} />
      {status}
    </span>
  );
}

export default function Dashboard({ userEmail, isOwner, ownerEmail }: DashboardProps) {
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [fabricLatest, setFabricLatest] = useState<FabricLatest | null>(null);
  const [paperLatest, setPaperLatest] = useState<PaperLatest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("Z7i Minecraft");
  const [newSoftware, setNewSoftware] = useState<ServerSoftware>("paper");
  const [newPort, setNewPort] = useState(25565);

  const [logLines, setLogLines] = useState<string[]>([]);
  const [command, setCommand] = useState("");

  const [currentDir, setCurrentDir] = useState(".");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [filePath, setFilePath] = useState("server.properties");
  const [fileContent, setFileContent] = useState("");

  const [addonQuery, setAddonQuery] = useState("");
  const [addonHits, setAddonHits] = useState<ModrinthSearchHit[]>([]);

  const [playerSummary, setPlayerSummary] = useState<PlayerSummary | null>(null);
  const [selectedPlayerKey, setSelectedPlayerKey] = useState<string | null>(null);
  const [playerDetail, setPlayerDetail] = useState<PlayerDetail | null>(null);

  const [settingsName, setSettingsName] = useState("Z7i Minecraft");
  const [settingsMotd, setSettingsMotd] = useState<MotdStyle>(defaultMotd);
  const [settingsAlwaysOn, setSettingsAlwaysOn] = useState(true);
  const [driveStatus, setDriveStatus] = useState<DriveBackupStatus | null>(null);
  const [driveFolderId, setDriveFolderId] = useState("");

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedId) ?? servers[0] ?? null,
    [selectedId, servers],
  );

  const addonKind: AddonKind =
    activeTab === "mods" ? "mod" : activeTab === "datapacks" ? "datapack" : "plugin";
  const onlinePlayers = playerSummary?.players.filter((player) => player.online).length ?? 0;

  async function refreshServers() {
    const data = await requestJson<ServerRecord[]>("/api/servers");
    setServers(data);
    setSelectedId((current) => current ?? data[0]?.id ?? null);
  }

  async function refreshLatest() {
    const [fabric, paper] = await Promise.all([
      requestJson<FabricLatest>("/api/fabric/latest"),
      requestJson<PaperLatest>("/api/paper/latest"),
    ]);
    setFabricLatest(fabric);
    setPaperLatest(paper);
  }

  async function runTask(task: () => Promise<void>, success?: string) {
    setNotice(null);
    setBusy(true);

    try {
      await task();
      if (success) {
        setNotice(success);
      }
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Something failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void runTask(async () => {
      await Promise.all([refreshServers(), refreshLatest()]);
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const drive = params.get("drive");
    if (!drive) {
      return;
    }

    setActiveTab("backups");
    setNotice(drive === "connected" ? "Google Drive connected" : (params.get("message") ?? "Google Drive failed"));
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!selectedServer) {
      setLogLines([]);
      return;
    }

    setSettingsName(selectedServer.name);
    setSettingsMotd(selectedServer.motd ?? defaultMotd);
    setSettingsAlwaysOn(selectedServer.alwaysOn);
    setLogLines([]);
    const source = new EventSource(`/api/servers/${selectedServer.id}/logs/stream`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { line: string };
      setLogLines((current) => [...current.slice(-399), payload.line]);
    };
    source.onerror = () => {
      source.close();
    };

    return () => source.close();
  }, [selectedServer?.id]);

  useEffect(() => {
    if (!selectedServer || !isOwner) {
      return;
    }

    void loadFiles(".");
  }, [selectedServer?.id, isOwner]);

  useEffect(() => {
    if (activeTab === "players" && selectedServer) {
      void refreshPlayers();
    }
  }, [activeTab, selectedServer?.id]);

  useEffect(() => {
    if (activeTab === "backups" && selectedServer && isOwner) {
      void refreshDriveStatus();
    }
  }, [activeTab, selectedServer?.id, isOwner]);

  useEffect(() => {
    setAddonHits([]);
    setAddonQuery("");
  }, [activeTab]);

  async function createServer(event: FormEvent) {
    event.preventDefault();
    await runTask(async () => {
      const created = await requestJson<ServerRecord>("/api/servers", {
        method: "POST",
        body: JSON.stringify({
          name: newName,
          software: newSoftware,
          port: newPort,
          motd: { ...defaultMotd, text: newName },
        }),
      });
      await refreshServers();
      setSelectedId(created.id);
      setActiveTab("console");
    }, "Server created");
  }

  async function serverAction(action: "start" | "stop") {
    if (!selectedServer) {
      return;
    }

    await runTask(async () => {
      await requestJson(`/api/servers/${selectedServer.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      await refreshServers();
    }, action === "start" ? "Start requested" : "Stop requested");
  }

  async function sendConsoleCommand(event: FormEvent) {
    event.preventDefault();
    if (!selectedServer || !command.trim()) {
      return;
    }

    await runTask(async () => {
      await requestJson(`/api/servers/${selectedServer.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "command", command }),
      });
      setCommand("");
    });
  }

  async function loadFiles(pathValue: string) {
    if (!selectedServer || !isOwner) {
      return;
    }

    const data = await requestJson<{ path: string; entries: FileEntry[] }>(
      `/api/servers/${selectedServer.id}/files?path=${encodeURIComponent(pathValue)}`,
    );
    setCurrentDir(data.path);
    setEntries(data.entries);
  }

  async function openFile(pathValue: string) {
    if (!selectedServer || !isOwner) {
      return;
    }

    await runTask(async () => {
      const data = await requestJson<{ path: string; content: string }>(
        `/api/servers/${selectedServer.id}/files?mode=read&path=${encodeURIComponent(pathValue)}`,
      );
      setFilePath(data.path);
      setFileContent(data.content);
    });
  }

  async function saveFile() {
    if (!selectedServer || !isOwner) {
      return;
    }

    await runTask(async () => {
      await requestJson(`/api/servers/${selectedServer.id}/files`, {
        method: "PUT",
        body: JSON.stringify({ path: filePath, content: fileContent }),
      });
      await loadFiles(currentDir);
    }, "File saved");
  }

  async function uploadFile(file: File, options: { path?: string; kind?: AddonKind } = {}) {
    if (!selectedServer || !isOwner) {
      return;
    }

    await runTask(async () => {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("path", options.path ?? currentDir);
      if (options.kind) {
        formData.set("kind", options.kind);
      }

      const result = await requestForm<{ folder?: string; path: string }>(
        `/api/servers/${selectedServer.id}/files`,
        formData,
      );
      await loadFiles(result.folder ?? currentDir);
    }, "File uploaded");
  }

  async function deleteFile(pathValue: string) {
    if (!selectedServer || !isOwner || !window.confirm(`Delete ${pathValue}?`)) {
      return;
    }

    await runTask(async () => {
      await requestJson(`/api/servers/${selectedServer.id}/files`, {
        method: "DELETE",
        body: JSON.stringify({ path: pathValue }),
      });
      if (filePath === pathValue) {
        setFileContent("");
      }
      await loadFiles(currentDir);
    }, "File deleted");
  }

  function downloadServerZip() {
    if (!selectedServer || !isOwner) {
      return;
    }

    window.location.href = `/api/servers/${selectedServer.id}/archive`;
  }

  async function searchAddons(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedServer) {
      return;
    }

    await runTask(async () => {
      const data = await requestJson<{ hits: ModrinthSearchHit[] }>(
        `/api/addons/search?kind=${addonKind}&q=${encodeURIComponent(addonQuery)}&gameVersion=${encodeURIComponent(
          selectedServer.minecraftVersion,
        )}`,
      );
      setAddonHits(data.hits);
    });
  }

  async function installAddon(projectId: string) {
    if (!selectedServer || !isOwner) {
      return;
    }

    await runTask(async () => {
      const result = await requestJson<{ folder?: string }>("/api/addons/install", {
        method: "POST",
        body: JSON.stringify({ serverId: selectedServer.id, projectId, kind: addonKind }),
      });
      await loadFiles(result.folder ?? (addonKind === "mod" ? "mods" : addonKind === "datapack" ? "world/datapacks" : "plugins"));
    }, addonKind === "mod" ? "Mod installed" : addonKind === "datapack" ? "Datapack installed" : "Plugin installed");
  }

  async function refreshPlayers() {
    if (!selectedServer) {
      return;
    }

    await runTask(async () => {
      const summary = await requestJson<PlayerSummary>(`/api/servers/${selectedServer.id}/players`);
      setPlayerSummary(summary);
      const key = selectedPlayerKey ?? summary.players[0]?.uuid ?? null;
      setSelectedPlayerKey(key);
      if (key) {
        await loadPlayer(key);
      }
    });
  }

  async function loadPlayer(key: string) {
    if (!selectedServer) {
      return;
    }

    const detail = await requestJson<PlayerDetail>(
      `/api/servers/${selectedServer.id}/players/${encodeURIComponent(key)}`,
    );
    setSelectedPlayerKey(detail.uuid);
    setPlayerDetail(detail);
  }

  async function playerAction(action: "heal" | "kill") {
    if (!selectedServer || !playerDetail) {
      return;
    }

    await runTask(async () => {
      const result = await requestJson<{ player: PlayerDetail }>(
        `/api/servers/${selectedServer.id}/players/${encodeURIComponent(playerDetail.uuid)}`,
        {
          method: "POST",
          body: JSON.stringify({ action }),
        },
      );
      setPlayerDetail(result.player);
      await refreshPlayers();
    }, action === "heal" ? "Player healed" : "Player killed");
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!selectedServer || !isOwner) {
      return;
    }

    await runTask(async () => {
      const updated = await requestJson<ServerRecord>(`/api/servers/${selectedServer.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ name: settingsName, motd: settingsMotd, alwaysOn: settingsAlwaysOn }),
      });
      setServers((current) => current.map((server) => (server.id === updated.id ? updated : server)));
    }, "Settings saved");
  }

  async function refreshDriveStatus() {
    if (!isOwner) {
      return;
    }

    try {
      const status = await requestJson<DriveBackupStatus>("/api/google-drive/status");
      setDriveStatus(status);
      setDriveFolderId(status.folderId ?? "");
    } catch (caught) {
      setDriveStatus({
        credentialsConfigured: false,
        connected: false,
        folderId: null,
        intervalHours: 10,
        lastBackupAt: null,
        lastBackupFileId: null,
        lastBackupFileName: null,
        lastError: caught instanceof Error ? caught.message : "Google Drive status unavailable",
        inProgress: false,
      });
    }
  }

  function connectGoogleDrive() {
    const folderQuery = driveFolderId.trim() ? `?folderId=${encodeURIComponent(driveFolderId.trim())}` : "";
    window.location.href = `/api/google-drive/connect${folderQuery}`;
  }

  async function backupToDrive() {
    if (!selectedServer || !isOwner) {
      return;
    }

    await runTask(async () => {
      const result = await requestJson<{ status: DriveBackupStatus }>("/api/google-drive/backup", {
        method: "POST",
        body: JSON.stringify({ serverId: selectedServer.id }),
      });
      setDriveStatus(result.status);
    }, "Google Drive backup finished");
  }

  async function disconnectGoogleDrive() {
    if (!isOwner || !window.confirm("Disconnect Google Drive backups?")) {
      return;
    }

    await runTask(async () => {
      const status = await requestJson<DriveBackupStatus>("/api/google-drive/status", { method: "DELETE" });
      setDriveStatus(status);
      setDriveFolderId("");
    }, "Google Drive disconnected");
  }

  async function signOut() {
    await requestJson("/api/auth/signout", { method: "POST" });
    window.location.href = "/";
  }

  const parentDir =
    currentDir === "."
      ? "."
      : currentDir
          .split("/")
          .slice(0, -1)
          .join("/") || ".";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-icon" aria-hidden="true">
            <Server size={21} />
          </div>
          <div>
            <strong>Z7i Minecraft</strong>
            <span>{selectedServer ? selectedServer.software : "panel"}</span>
          </div>
        </div>

        <div className="server-stack">
          <div className="sidebar-label">Server</div>
          {selectedServer ? (
            <button className="server-button active" onClick={() => setActiveTab("overview")}>
              <span>{selectedServer.name}</span>
              <StatusDot status={selectedServer.status} />
            </button>
          ) : (
            <div className="empty-line">Not created</div>
          )}
        </div>

        <nav className="nav-stack" aria-label="Panel sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                disabled={!selectedServer && tab.id !== "overview"}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="user-box">
          <div>
            <span>{isOwner ? "Owner" : "Observer"}</span>
            <strong>{userEmail}</strong>
          </div>
          <button className="icon-button" onClick={signOut} title="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{selectedServer ? selectedServer.id : "single server"}</p>
            <h1>{selectedServer ? selectedServer.name : "Z7i Minecraft"}</h1>
          </div>
          <div className="top-actions">
            {selectedServer ? <StatusDot status={selectedServer.status} /> : null}
            <button className="icon-button" onClick={() => void runTask(refreshServers)} title="Refresh">
              <RefreshCw size={18} />
            </button>
            {isOwner && selectedServer ? (
              <>
                <button
                  className="tool-button"
                  onClick={() => void serverAction("start")}
                  disabled={busy || selectedServer.status === "running" || selectedServer.status === "starting"}
                >
                  <Play size={17} />
                  <span>Start</span>
                </button>
                <button
                  className="tool-button"
                  onClick={() => void serverAction("stop")}
                  disabled={busy || selectedServer.status === "stopped"}
                >
                  <Square size={17} />
                  <span>Stop</span>
                </button>
              </>
            ) : null}
          </div>
        </header>

        {notice ? <div className="notice">{notice}</div> : null}

        <section className="main-panel">
          {!selectedServer ? (
            <CreateServerPanel
              isOwner={isOwner}
              busy={busy}
              newName={newName}
              newPort={newPort}
              newSoftware={newSoftware}
              fabricLatest={fabricLatest}
              paperLatest={paperLatest}
              onName={setNewName}
              onPort={setNewPort}
              onSoftware={setNewSoftware}
              onSubmit={createServer}
            />
          ) : null}

          {selectedServer && activeTab === "overview" ? (
            <div className="overview-grid panel-scroll">
              <Metric icon={Activity} label="Status" value={selectedServer.status} />
              <Metric icon={ListRestart} label="Minecraft" value={selectedServer.minecraftVersion} />
              <Metric icon={Badge} label="Software" value={selectedServer.software} />
              <Metric icon={Users} label="Online" value={String(onlinePlayers)} />
              <div className="detail-table">
                <div>
                  <span>Port</span>
                  <strong>{selectedServer.port}</strong>
                </div>
                <div>
                  <span>Memory</span>
                  <strong>6144 MB</strong>
                </div>
                <div>
                  <span>Mode</span>
                  <strong>{selectedServer.crackedMode ? "Cracked" : "Premium"}</strong>
                </div>
                <div>
                  <span>Always on</span>
                  <strong>{selectedServer.alwaysOn ? "Enabled" : "Disabled"}</strong>
                </div>
              </div>
            </div>
          ) : null}

          {selectedServer && activeTab === "console" ? (
            <div className="console-view">
              <div className="console-output">
                {logLines.length === 0 ? (
                  <span className="muted-text">Waiting for logs</span>
                ) : (
                  logLines.map((line, index) => <pre key={`${line}-${index}`}>{line}</pre>)
                )}
              </div>
              {isOwner ? (
                <form className="command-row" onSubmit={sendConsoleCommand}>
                  <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="say Hello" />
                  <button className="icon-button" disabled={!command.trim()} title="Send">
                    <Send size={18} />
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}

          {selectedServer && activeTab === "files" ? (
            <div className="files-view">
              {!isOwner ? (
                <LockedPanel />
              ) : (
                <>
                  <div className="file-toolbar">
                    <button className="tool-button" onClick={() => void loadFiles(parentDir)}>
                      <Folder size={17} />
                      <span>Up</span>
                    </button>
                    <input value={filePath} onChange={(event) => setFilePath(event.target.value)} />
                    <button className="tool-button" onClick={() => void openFile(filePath)}>
                      <FileText size={17} />
                      <span>Open</span>
                    </button>
                    <button className="tool-button" onClick={() => void saveFile()}>
                      <Save size={17} />
                      <span>Save</span>
                    </button>
                    <label className="tool-button upload-control">
                      <Upload size={17} />
                      <span>Upload</span>
                      <input
                        type="file"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          if (file) {
                            void uploadFile(file);
                          }
                        }}
                      />
                    </label>
                    <button className="tool-button" onClick={downloadServerZip} type="button">
                      <Download size={17} />
                      <span>ZIP</span>
                    </button>
                  </div>
                  <div className="file-layout">
                    <div className="file-list">
                      <div className="sidebar-label">{currentDir}</div>
                      {entries.map((entry) => (
                        <div key={entry.path} className="file-row">
                          <button
                            className="file-open"
                            onClick={() =>
                              entry.type === "directory" ? void loadFiles(entry.path) : void openFile(entry.path)
                            }
                          >
                            {entry.type === "directory" ? <Folder size={16} /> : <FileText size={16} />}
                            <span>{entry.name}</span>
                            <small>{entry.type === "file" ? formatBytes(entry.size) : ""}</small>
                          </button>
                          {entry.type === "file" ? (
                            <button
                              className="file-delete"
                              onClick={() => void deleteFile(entry.path)}
                              title="Delete file"
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <textarea
                      className="file-editor"
                      value={fileContent}
                      onChange={(event) => setFileContent(event.target.value)}
                      spellCheck={false}
                    />
                  </div>
                </>
              )}
            </div>
          ) : null}

          {selectedServer && (activeTab === "mods" || activeTab === "plugins" || activeTab === "datapacks") ? (
            <div className="addons-view">
              <form className="search-row" onSubmit={searchAddons}>
                <Search size={18} />
                <input
                  value={addonQuery}
                  onChange={(event) => setAddonQuery(event.target.value)}
                  placeholder={
                    addonKind === "mod"
                      ? "sodium, lithium, fabric api"
                      : addonKind === "datapack"
                        ? "vanilla tweaks, terralith, blazeandcave"
                        : "luckperms, geyser, vault"
                  }
                />
                <button className="tool-button">
                  <Search size={17} />
                  <span>Search</span>
                </button>
                {isOwner ? (
                  <label className="tool-button upload-control">
                    <Upload size={17} />
                    <span>Upload</span>
                    <input
                      type="file"
                      accept={addonKind === "datapack" ? ".zip" : ".jar"}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (file) {
                          void uploadFile(file, { kind: addonKind });
                        }
                      }}
                    />
                  </label>
                ) : null}
              </form>
              <div className="addon-list panel-scroll">
                {addonHits.map((hit) => (
                  <article key={hit.project_id} className="addon-row">
                    <div>
                      <strong>{hit.title}</strong>
                      <span>{hit.description}</span>
                      <small>{hit.downloads.toLocaleString()} downloads</small>
                    </div>
                    {isOwner ? (
                      <button className="icon-button" onClick={() => void installAddon(hit.project_id)} title="Install">
                        <Download size={18} />
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {selectedServer && activeTab === "players" ? (
            <div className="players-view">
              <div className="section-head">
                <h2>Players</h2>
                <button className="tool-button" onClick={() => void refreshPlayers()}>
                  <RefreshCw size={17} />
                  <span>Refresh</span>
                </button>
              </div>
              <div className="players-layout">
                <div className="player-list">
                  {(playerSummary?.players ?? []).map((player) => (
                    <button
                      key={player.uuid}
                      className={selectedPlayerKey === player.uuid ? "active" : ""}
                      onClick={() => void loadPlayer(player.uuid)}
                    >
                      <img src={player.avatarUrl} alt="" />
                      <span>{player.name}</span>
                      <span className={`status-dot ${player.online ? "running" : "stopped"}`}>
                        <Circle size={10} fill="currentColor" />
                        {player.online ? "online" : "offline"}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="player-detail">
                  {playerDetail ? (
                    <>
                      <div className="player-hero">
                        <img src={playerDetail.avatarUrl} alt="" />
                        <div>
                          <h2>{playerDetail.name}</h2>
                          <span>{playerDetail.uuid}</span>
                        </div>
                      </div>
                      <div className="player-grid">
                        <Metric icon={HeartPulse} label="HP" value={statValue(playerDetail.health)} />
                        <Metric icon={Gauge} label="Food" value={statValue(playerDetail.foodLevel)} />
                        <Metric icon={Badge} label="XP" value={statValue(playerDetail.xpLevel)} />
                        <Metric icon={Crosshair} label="Coords" value={coordinateLine(playerDetail)} />
                      </div>
                      {isOwner ? (
                        <div className="player-actions">
                          <button className="tool-button" onClick={() => void playerAction("heal")}>
                            <HeartPulse size={17} />
                            <span>Heal</span>
                          </button>
                          <button className="tool-button" onClick={() => void playerAction("kill")}>
                            <Skull size={17} />
                            <span>Kill</span>
                          </button>
                        </div>
                      ) : null}
                      <div className="inventory-list">
                        {playerDetail.inventory.length === 0 ? (
                          <span className="muted-text">Inventory unavailable</span>
                        ) : (
                          playerDetail.inventory.map((item) => (
                            <div key={`${item.slot}-${item.id}`}>
                              <strong>{item.slot}</strong>
                              <span>{item.id}</span>
                              <small>x{item.count}</small>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <LockedPanel label="No player selected" />
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {selectedServer && activeTab === "settings" ? (
            <div className="settings-view panel-scroll">
              {!isOwner ? <LockedPanel /> : null}
              {isOwner ? (
                <form className="settings-form" onSubmit={saveSettings}>
                  <label>
                    Server name
                    <input value={settingsName} onChange={(event) => setSettingsName(event.target.value)} />
                  </label>
                  <label>
                    Description
                    <input
                      value={settingsMotd.text}
                      onChange={(event) => setSettingsMotd((current) => ({ ...current, text: event.target.value }))}
                    />
                  </label>
                  <label>
                    Colour
                    <select
                      value={settingsMotd.color}
                      onChange={(event) =>
                        setSettingsMotd((current) => ({
                          ...current,
                          color: event.target.value as MinecraftColor,
                        }))
                      }
                    >
                      {colors.map((color) => (
                        <option key={color} value={color}>
                          {color.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="toggle-grid">
                    <Toggle label="Bold" value={settingsMotd.bold} onChange={(value) => setSettingsMotd((current) => ({ ...current, bold: value }))} />
                    <Toggle label="Italic" value={settingsMotd.italic} onChange={(value) => setSettingsMotd((current) => ({ ...current, italic: value }))} />
                    <Toggle label="Underline" value={settingsMotd.underline} onChange={(value) => setSettingsMotd((current) => ({ ...current, underline: value }))} />
                    <Toggle label="Strike" value={settingsMotd.strikethrough} onChange={(value) => setSettingsMotd((current) => ({ ...current, strikethrough: value }))} />
                    <Toggle label="Magic" value={settingsMotd.obfuscated} onChange={(value) => setSettingsMotd((current) => ({ ...current, obfuscated: value }))} />
                  </div>
                  <Toggle label="Keep server online 24/7" value={settingsAlwaysOn} onChange={setSettingsAlwaysOn} />
                  <div className={`motd-preview mc-${settingsMotd.color} ${settingsMotd.bold ? "bold" : ""} ${settingsMotd.italic ? "italic" : ""} ${settingsMotd.underline ? "underline" : ""} ${settingsMotd.strikethrough ? "strike" : ""}`}>
                    {settingsMotd.text}
                  </div>
                  <button className="primary-action" disabled={busy}>
                    <Save size={18} />
                    <span>Save settings</span>
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}

          {selectedServer && activeTab === "backups" ? (
            <div className="settings-view panel-scroll">
              {!isOwner ? <LockedPanel /> : null}
              {isOwner ? (
                <div className="backup-panel">
                  <div className="section-head">
                    <h2>Google Drive backups</h2>
                    <button className="icon-button" type="button" onClick={() => void refreshDriveStatus()} title="Refresh">
                      <RefreshCw size={17} />
                    </button>
                  </div>
                  <div className="backup-grid">
                    <label>
                      Folder ID
                      <input value={driveFolderId} onChange={(event) => setDriveFolderId(event.target.value)} />
                    </label>
                    <Metric
                      icon={Cloud}
                      label="Drive"
                      value={
                        !driveStatus?.credentialsConfigured
                          ? "Not configured"
                          : driveStatus.connected
                            ? "Connected"
                            : "Disconnected"
                      }
                    />
                    <Metric
                      icon={Download}
                      label="Last backup"
                      value={driveStatus?.lastBackupAt ? new Date(driveStatus.lastBackupAt).toLocaleString() : "Never"}
                    />
                    <Metric icon={ListRestart} label="Interval" value={`${driveStatus?.intervalHours ?? 10}h`} />
                  </div>
                  {driveStatus?.lastError ? <span className="error-line">{driveStatus.lastError}</span> : null}
                  <div className="player-actions">
                    <button
                      className="tool-button"
                      type="button"
                      onClick={connectGoogleDrive}
                      disabled={!driveStatus?.credentialsConfigured}
                    >
                      <Cloud size={17} />
                      <span>{driveStatus?.connected ? "Reconnect" : "Connect"}</span>
                    </button>
                    <button
                      className="tool-button"
                      type="button"
                      onClick={() => void backupToDrive()}
                      disabled={!driveStatus?.connected || driveStatus.inProgress}
                    >
                      <Upload size={17} />
                      <span>Backup now</span>
                    </button>
                    <button
                      className="tool-button danger-button"
                      type="button"
                      onClick={() => void disconnectGoogleDrive()}
                      disabled={!driveStatus?.connected}
                    >
                      <Trash2 size={17} />
                      <span>Disconnect</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function CreateServerPanel({
  isOwner,
  busy,
  newName,
  newSoftware,
  newPort,
  fabricLatest,
  paperLatest,
  onName,
  onSoftware,
  onPort,
  onSubmit,
}: {
  isOwner: boolean;
  busy: boolean;
  newName: string;
  newSoftware: ServerSoftware;
  newPort: number;
  fabricLatest: FabricLatest | null;
  paperLatest: PaperLatest | null;
  onName: (value: string) => void;
  onSoftware: (value: ServerSoftware) => void;
  onPort: (value: number) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  if (!isOwner) {
    return <LockedPanel />;
  }

  return (
    <form className="create-single" onSubmit={onSubmit}>
      <div>
        <p className="eyebrow">Create</p>
        <h2>Z7i Minecraft</h2>
      </div>
      <div className="create-grid">
        <label>
          Name
          <input value={newName} onChange={(event) => onName(event.target.value)} />
        </label>
        <label>
          Port
          <input
            type="number"
            min={25565}
            max={25600}
            value={newPort}
            onChange={(event) => onPort(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="software-switch">
        <button type="button" className={newSoftware === "paper" ? "active" : ""} onClick={() => onSoftware("paper")}>
          Paper
        </button>
        <button type="button" className={newSoftware === "fabric" ? "active" : ""} onClick={() => onSoftware("fabric")}>
          Fabric
        </button>
      </div>
      <div className="version-strip">
        <span>{newSoftware === "paper" ? (paperLatest?.latestVersion ?? "-") : (fabricLatest?.latestStableGame ?? "-")}</span>
        <span>{newSoftware === "paper" ? `build ${paperLatest?.latestBuild ?? "-"}` : (fabricLatest?.latestLoader ?? "-")}</span>
        <span>6144 MB</span>
      </div>
      <button className="primary-action" disabled={busy}>
        <Plus size={18} />
        <span>Create server</span>
      </button>
    </form>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
}) {
  return (
    <div className="metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function LockedPanel({ label = "Owner access required" }: { label?: string }) {
  return (
    <div className="locked-panel">
      <Shield size={24} />
      <strong>{label}</strong>
    </div>
  );
}
