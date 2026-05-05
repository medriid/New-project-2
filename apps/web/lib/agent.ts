const agentBaseUrl = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8787";
const agentToken = process.env.AGENT_TOKEN ?? "";

type AgentInit = RequestInit & {
  json?: unknown;
};

export async function agentFetch<T>(path: string, init: AgentInit = {}): Promise<T> {
  if (!agentToken) {
    throw new Error("AGENT_TOKEN is not configured");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${agentToken}`);

  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${agentBaseUrl}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload ? String(payload.error) : "Agent request failed";
    throw new Error(message);
  }

  return payload as T;
}

export async function agentStream(path: string) {
  if (!agentToken) {
    throw new Error("AGENT_TOKEN is not configured");
  }

  const response = await fetch(`${agentBaseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${agentToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    throw new Error(`Agent stream failed: ${response.status}`);
  }

  return response;
}
