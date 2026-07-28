/**
 * KeeperHub MCP client — Streamable HTTP transport over @modelcontextprotocol/sdk.
 *
 * Connects ChronicleAI to KeeperHub's remote MCP endpoint (`/mcp`) with a
 * `kh_` org API key so LangChain ReAct agents can call list_workflows,
 * get_workflow, execute_workflow, and get_execution natively.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface KeeperHubMcpClientConfig {
  /** Full MCP endpoint URL, e.g. https://app.keeperhub.com/mcp */
  mcpUrl: string;
  /** Organization API key (`kh_…`). */
  apiKey: string;
  /** Optional client identity for MCP initialize. */
  clientName?: string;
  clientVersion?: string;
  /** Per-tool-call request timeout (ms). Default 60s. */
  requestTimeoutMs?: number;
}

export interface KeeperHubMcpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface KeeperHubMcpCallResult {
  /** Parsed JSON when the tool returned JSON text; otherwise raw text / structured. */
  data: unknown;
  /** True when the MCP tool reported isError. */
  isError: boolean;
  /** Raw text content joined from text parts. */
  text: string;
}

export interface KeeperHubMcpClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  isConnected(): boolean;
  listServerTools(): Promise<KeeperHubMcpToolInfo[]>;
  callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<KeeperHubMcpCallResult>;
}

/**
 * Derive the MCP endpoint from a KeeperHub API base URL.
 * `https://app.keeperhub.com` → `https://app.keeperhub.com/mcp`
 * Trailing `/api` segments are stripped first.
 */
export function resolveKeeperHubMcpUrl(
  apiBaseUrl: string,
  explicitMcpUrl?: string | undefined,
): string {
  const explicit = explicitMcpUrl?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const base = apiBaseUrl.trim().replace(/\/+$/, "").replace(/\/api$/i, "");
  return `${base}/mcp`;
}

export function isKeeperHubMcpConfigured(env: {
  keeperhubApiBaseUrl?: string | undefined;
  keeperhubApiKey?: string | undefined;
  keeperhubMcpEnabled?: boolean | undefined;
  keeperhubMcpUrl?: string | undefined;
}): boolean {
  if (env.keeperhubMcpEnabled === false) {
    return false;
  }
  const key = env.keeperhubApiKey?.trim();
  const base = env.keeperhubApiBaseUrl?.trim();
  if (!key || !base || !key.startsWith("kh_")) {
    return false;
  }
  return true;
}

function contentToText(content: unknown): string {
  if (!Array.isArray(content)) {
    if (typeof content === "string") return content;
    if (content == null) return "";
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.type === "text" && typeof rec.text === "string") {
      parts.push(rec.text);
    }
  }
  return parts.join("\n");
}

function parseToolPayload(text: string, structured?: unknown): unknown {
  if (structured !== undefined && structured !== null) {
    return structured;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Strip common "Error: " prefixes before JSON attempts.
  const candidate = trimmed.replace(/^Error:\s*/i, "");
  try {
    return JSON.parse(candidate);
  } catch {
    // Try first JSON object/array in mixed text.
    const objMatch = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (objMatch?.[1]) {
      try {
        return JSON.parse(objMatch[1]);
      } catch {
        /* fall through */
      }
    }
    return trimmed;
  }
}

export function createKeeperHubMcpClient(
  config: KeeperHubMcpClientConfig,
): KeeperHubMcpClient {
  const mcpUrl = config.mcpUrl.replace(/\/+$/, "");
  const requestTimeoutMs = config.requestTimeoutMs ?? 60_000;
  let client: Client | null = null;
  let transport: StreamableHTTPClientTransport | null = null;
  let connected = false;

  return {
    isConnected() {
      return connected;
    },

    async connect() {
      if (connected && client) return;

      const nextClient = new Client({
        name: config.clientName ?? "chronicleai-langchain",
        version: config.clientVersion ?? "0.1.0",
      });

      const nextTransport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            Accept: "application/json, text/event-stream",
          },
        },
      });

      await nextClient.connect(nextTransport);
      client = nextClient;
      transport = nextTransport;
      connected = true;
    },

    async close() {
      connected = false;
      const c = client;
      const t = transport;
      client = null;
      transport = null;
      try {
        await c?.close();
      } catch {
        /* best-effort */
      }
      try {
        await t?.close();
      } catch {
        /* best-effort */
      }
    },

    async listServerTools() {
      if (!client || !connected) {
        throw new Error("KeeperHub MCP client is not connected");
      }
      const listed = await client.listTools(
        undefined,
        { timeout: requestTimeoutMs },
      );
      return (listed.tools ?? []).map((tool) => {
        const info: KeeperHubMcpToolInfo = { name: tool.name };
        if (typeof tool.description === "string" && tool.description) {
          info.description = tool.description;
        }
        if (tool.inputSchema && typeof tool.inputSchema === "object") {
          info.inputSchema = tool.inputSchema as Record<string, unknown>;
        }
        return info;
      });
    },

    async callTool(name, args = {}) {
      if (!client || !connected) {
        throw new Error("KeeperHub MCP client is not connected");
      }

      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: requestTimeoutMs },
      );

      const text = contentToText(result.content);
      const isError = result.isError === true;
      const structured =
        "structuredContent" in result ? result.structuredContent : undefined;
      const data = parseToolPayload(text, structured);

      if (isError) {
        const message =
          typeof data === "string"
            ? data
            : data && typeof data === "object" && "error" in data
              ? String((data as { error: unknown }).error)
              : text || `KeeperHub MCP tool ${name} failed`;
        // Surface as structured result so agent tools can return the error
        // text to the LLM without throwing mid-ReAct (caller may still throw).
        return {
          data:
            typeof data === "object" && data !== null
              ? data
              : { error: message },
          isError: true,
          text: text || message,
        };
      }

      return { data, isError: false, text };
    },
  };
}

/**
 * Run work against a short-lived MCP session (connect → fn → close).
 */
export async function withKeeperHubMcpClient<T>(
  config: KeeperHubMcpClientConfig,
  fn: (client: KeeperHubMcpClient) => Promise<T>,
): Promise<T> {
  const client = createKeeperHubMcpClient(config);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}
