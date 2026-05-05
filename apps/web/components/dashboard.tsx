"use client";

import {
  Activity,
  Circle,
  Download,
  FileText,
  Folder,
  FolderTree,
  Gauge,
  ListRestart,
  LogOut,
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
  Square,
  Terminal,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import type { FabricLatest, FileEntry, ModrinthSearchHit, ServerRecord } from "@/types/panel";

type DashboardProps = {
  userEmail: string;
  isOwner: boolean;
  ownerEmail: string;
};

type Tab = "overview" | "console" | "files" | "addons" | "players" | "settings";

type PlayerSummary = {
  operators: unknown[];
  whitelist: unknown[];
  bannedPlayers: unknown[];
  lastListLine: string | null;
};

const tabs: Array<{ id: Tab; label: string; icon: typeof Gauge }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "console", label: "Console", icon: Terminal },
  { id: "files", label: "Files", icon: FolderTree },
  { id: "addons", label: "Add-ons", icon: PackageSearch },
  { id: "players", label: "Players", icon: Users },
  { id: "settings", label: "Settings", icon: Settings },
];

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

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function StatusDot({ status }: { status: ServerRecord["status"] }) {
  return (
    <span className={`status-dot ${status}`}>
      <Circle size={10} fill="currentColor" />
      {status}
    </span>
  );
}

export default function Dashboard({ userEmail, isOwner, ownerEmail }: DashboardProps) {
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [latest, setLatest] = useState<FabricLatest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("Fabric Survival");
  const [newMemory, setNewMemory] = useState(4096);
  const [newPort, setNewPort] = useState(25565);

  const [logLines, setLogLines] = useState<string[]>([]);
  const [command, setCommand] = useState("");

  const [currentDir, setCurrentDir] = useState(".");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [filePath, setFilePath] = useState("server.properties");
  const [fileContent, setFileContent] = useState("");

  const [addonQuery, setAddonQuery] = useState("");
  const [addonHits, setAddonHits] = useState<ModrinthSearchHit[]>([]);
  const [players, setPlayers] = useState<PlayerSummary | null>(null);

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedId) ?? servers[0] ?? null,
    [selectedId, servers],
  );

  async function refreshServers() {
    const data = await requestJson<ServerRecord[]>("/api/servers");
    setServers(data);
    setSelectedId((current) => current ?? data[0]?.id ?? null);
  }

  async function refreshLatest() {
    const data = await requestJson<FabricLatest>("/api/fabric/latest");
    setLatest(data);
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
    if (!selectedServer) {
      setLogLines([]);
      return;
    }

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

  async function createServer(event: FormEvent) {
    event.preventDefault();
    await runTask(async () => {
      const created = await requestJson<ServerRecord>("/api/servers", {
        method: "POST",
        body: JSON.stringify({
          name: newName,
          memoryMb: newMemory,
          port: newPort,
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

  async function searchAddons(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedServer) {
      return;
    }

    await runTask(async () => {
      const data = await requestJson<{ hits: ModrinthSearchHit[] }>(
        `/api/addons/search?q=${encodeURIComponent(addonQuery)}&gameVersion=${encodeURIComponent(
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
      await requestJson("/api/addons/install", {
        method: "POST",
        body: JSON.stringify({ serverId: selectedServer.id, projectId }),
      });
      await loadFiles("mods");
    }, "Add-on installed");
  }

  async function refreshPlayers() {
    if (!selectedServer) {
      return;
    }

    await runTask(async () => {
      setPlayers(await requestJson<PlayerSummary>(`/api/servers/${selectedServer.id}/players`));
    });
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
            <strong>VPS Panel</strong>
            <span>Fabric</span>
          </div>
        </div>

        <div className="server-stack">
          <div className="sidebar-label">Servers</div>
          {servers.length === 0 ? (
            <div className="empty-line">No servers yet</div>
          ) : (
            servers.map((server) => (
              <button
                key={server.id}
                className={`server-button ${selectedServer?.id === server.id ? "active" : ""}`}
                onClick={() => setSelectedId(server.id)}
              >
                <span>{server.name}</span>
                <StatusDot status={server.status} />
              </button>
            ))
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
            <p className="eyebrow">{selectedServer ? selectedServer.id : "No server selected"}</p>
            <h1>{selectedServer ? selectedServer.name : "Minecraft control panel"}</h1>
          </div>
          <div className="top-actions">
            {selectedServer ? <StatusDot status={selectedServer.status} /> : null}
            <button className="icon-button" onClick={() => void runTask(refreshServers)} title="Refresh servers">
              <RefreshCw size={18} />
            </button>
            {isOwner && selectedServer ? (
              <>
                <button className="tool-button" onClick={() => void serverAction("start")} disabled={busy}>
                  <Play size={17} />
                  <span>Start</span>
                </button>
                <button className="tool-button" onClick={() => void serverAction("stop")} disabled={busy}>
                  <Square size={17} />
                  <span>Stop</span>
                </button>
              </>
            ) : null}
          </div>
        </header>

        {notice ? <div className="notice">{notice}</div> : null}

        <div className="content-grid">
          <section className="main-panel">
            {activeTab === "overview" ? (
              <div className="overview-grid">
                <Metric icon={Activity} label="Status" value={selectedServer?.status ?? "none"} />
                <Metric icon={ListRestart} label="Minecraft" value={selectedServer?.minecraftVersion ?? "-"} />
                <Metric icon={PackageSearch} label="Fabric Loader" value={selectedServer?.fabricLoaderVersion ?? "-"} />
                <Metric icon={Shield} label="Owner" value={ownerEmail} />

                {selectedServer ? (
                  <div className="detail-table">
                    <div>
                      <span>Port</span>
                      <strong>{selectedServer.port}</strong>
                    </div>
                    <div>
                      <span>Memory</span>
                      <strong>{selectedServer.memoryMb} MB</strong>
                    </div>
                    <div>
                      <span>Path</span>
                      <strong>{selectedServer.relativePath}</strong>
                    </div>
                    <div>
                      <span>Updated</span>
                      <strong>{new Date(selectedServer.updatedAt).toLocaleString()}</strong>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === "console" ? (
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
                    <button className="icon-button" disabled={!selectedServer || !command.trim()} title="Send command">
                      <Send size={18} />
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}

            {activeTab === "files" ? (
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
                    </div>
                    <div className="file-layout">
                      <div className="file-list">
                        <div className="sidebar-label">{currentDir}</div>
                        {entries.map((entry) => (
                          <button
                            key={entry.path}
                            onClick={() =>
                              entry.type === "directory" ? void loadFiles(entry.path) : void openFile(entry.path)
                            }
                          >
                            {entry.type === "directory" ? <Folder size={16} /> : <FileText size={16} />}
                            <span>{entry.name}</span>
                            <small>{entry.type === "file" ? formatBytes(entry.size) : ""}</small>
                          </button>
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

            {activeTab === "addons" ? (
              <div className="addons-view">
                <form className="search-row" onSubmit={searchAddons}>
                  <Search size={18} />
                  <input
                    value={addonQuery}
                    onChange={(event) => setAddonQuery(event.target.value)}
                    placeholder="sodium, lithium, fabric api"
                  />
                  <button className="tool-button">
                    <Search size={17} />
                    <span>Search</span>
                  </button>
                </form>
                <div className="addon-list">
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

            {activeTab === "players" ? (
              <div className="players-view">
                <div className="section-head">
                  <h2>Players</h2>
                  <button className="tool-button" onClick={() => void refreshPlayers()}>
                    <RefreshCw size={17} />
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="player-grid">
                  <Metric icon={Users} label="Operators" value={String(players?.operators.length ?? 0)} />
                  <Metric icon={Shield} label="Whitelist" value={String(players?.whitelist.length ?? 0)} />
                  <Metric icon={Square} label="Banned" value={String(players?.bannedPlayers.length ?? 0)} />
                </div>
                <pre className="players-line">{players?.lastListLine ?? "No player list yet"}</pre>
              </div>
            ) : null}

            {activeTab === "settings" ? (
              <div className="settings-view">
                {!isOwner ? <LockedPanel /> : null}
                {isOwner && selectedServer ? (
                  <div className="action-grid">
                    <button onClick={() => void serverAction("start")}>
                      <Play size={18} />
                      <span>Start server</span>
                    </button>
                    <button onClick={() => void serverAction("stop")}>
                      <Square size={18} />
                      <span>Stop server</span>
                    </button>
                    <button onClick={() => void openFile("server.properties")}>
                      <FileText size={18} />
                      <span>Open properties</span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {isOwner ? (
            <aside className="side-panel">
              <div className="section-head">
                <h2>Create server</h2>
                <Plus size={18} />
              </div>
              <form className="create-form" onSubmit={createServer}>
                <label>
                  Name
                  <input value={newName} onChange={(event) => setNewName(event.target.value)} />
                </label>
                <label>
                  Memory MB
                  <input
                    type="number"
                    min={1024}
                    max={32768}
                    step={512}
                    value={newMemory}
                    onChange={(event) => setNewMemory(Number(event.target.value))}
                  />
                </label>
                <label>
                  Port
                  <input
                    type="number"
                    min={25565}
                    max={25600}
                    value={newPort}
                    onChange={(event) => setNewPort(Number(event.target.value))}
                  />
                </label>
                <div className="version-strip">
                  <span>{latest?.latestStableGame ?? "-"}</span>
                  <span>{latest?.latestLoader ?? "-"}</span>
                  <span>{latest?.latestInstaller ?? "-"}</span>
                </div>
                <button className="primary-action" disabled={busy}>
                  <Plus size={18} />
                  <span>Create Fabric server</span>
                </button>
              </form>
            </aside>
          ) : null}
        </div>
      </section>
    </main>
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

function LockedPanel() {
  return (
    <div className="locked-panel">
      <Shield size={24} />
      <strong>Owner access required</strong>
    </div>
  );
}
