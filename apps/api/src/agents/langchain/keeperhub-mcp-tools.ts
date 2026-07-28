/**
 * LangChain StructuredTools wrapping KeeperHub MCP execution surface.
 *
 * Tools map 1:1 to KeeperHub MCP server capabilities used by ChronicleAI
 * Loop 1 (alerts) and Loop 2 (digests):
 *   list_workflows / get_workflow  — discover execution routes
 *   execute_workflow               — post publishAlert / publishDigest
 *   get_execution                  — combined status + logs (current KH API)
 *   get_execution_status / logs    — compatibility aliases over get_execution
 */

import { tool } from "langchain";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { KeeperHubMcpClient } from "../../services/keeperhub-mcp-client.ts";

export const KEEPERHUB_MCP_TOOL_NAMES = [
  "list_workflows",
  "get_workflow",
  "execute_workflow",
  "get_execution",
  "get_execution_status",
  "get_execution_logs",
] as const;

export type KeeperHubMcpToolName = (typeof KEEPERHUB_MCP_TOOL_NAMES)[number];

export interface KeeperHubMcpToolCallRecord {
  name: KeeperHubMcpToolName | string;
  arguments: Record<string, unknown>;
  result: unknown;
  isError?: boolean;
}

function stringifyResult(payload: unknown): string {
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

/**
 * Build LangChain tools bound to a live KeeperHub MCP client session.
 * Optional `onToolCall` captures every invocation for audit / tests.
 */
export function createKeeperHubMcpLangChainTools(
  client: KeeperHubMcpClient,
  options?: {
    onToolCall?: (record: KeeperHubMcpToolCallRecord) => void;
  },
): StructuredToolInterface[] {
  const track = (
    name: string,
    args: Record<string, unknown>,
    result: unknown,
    isError?: boolean,
  ) => {
    options?.onToolCall?.({
      name,
      arguments: args,
      result,
      ...(isError !== undefined ? { isError } : {}),
    });
  };

  const invoke = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const res = await client.callTool(name, args);
    track(name, args, res.data, res.isError);
    if (res.isError) {
      return stringifyResult({
        ok: false,
        error: res.text || "MCP tool error",
        data: res.data,
      });
    }
    return stringifyResult(res.data ?? res.text);
  };

  return [
    tool(
      async ({ projectId, tagId }) => {
        const args: Record<string, unknown> = {};
        if (projectId) args.projectId = projectId;
        if (tagId) args.tagId = tagId;
        return invoke("list_workflows", args);
      },
      {
        name: "list_workflows",
        description:
          "List all KeeperHub workflows for the authenticated organization. " +
          "Use this to discover the publishAlert / publishDigest registry write routes " +
          "before executing. Optionally filter by projectId or tagId.",
        schema: z.object({
          projectId: z
            .string()
            .optional()
            .describe("Optional project ID to filter workflows"),
          tagId: z
            .string()
            .optional()
            .describe("Optional tag ID to filter workflows"),
        }),
      },
    ),

    tool(
      async ({ workflowId }) =>
        invoke("get_workflow", { workflowId }),
      {
        name: "get_workflow",
        description:
          "Get a single KeeperHub workflow by ID, including nodes, edges, and configuration. " +
          "Use after list_workflows to confirm the chosen publishAlert or publishDigest route.",
        schema: z.object({
          workflowId: z.string().describe("The workflow ID"),
        }),
      },
    ),

    tool(
      async ({ workflowId, input, idempotency_key }) => {
        const args: Record<string, unknown> = { workflowId };
        if (input && typeof input === "object") {
          args.input = input;
        }
        if (idempotency_key) {
          args.idempotency_key = idempotency_key;
        }
        return invoke("execute_workflow", args);
      },
      {
        name: "execute_workflow",
        description:
          "Trigger a manual KeeperHub workflow execution (on-chain registry write). " +
          "Returns an execution ID for status polling via get_execution / get_execution_status. " +
          "Pass workflow input fields such as contentHash, sourceEventHash/sourceEventRoot, contentUri, " +
          "contractAddress, and network.",
        schema: z.object({
          workflowId: z.string().describe("The workflow ID to execute"),
          input: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("Input data for the workflow trigger / write-contract step"),
          idempotency_key: z
            .string()
            .optional()
            .describe("Optional idempotency key to dedupe retries"),
        }),
      },
    ),

    tool(
      async ({ executionId, includeData, nodeIds, truncateData }) => {
        const args: Record<string, unknown> = { executionId };
        if (includeData !== undefined) args.includeData = includeData;
        if (nodeIds !== undefined) args.nodeIds = nodeIds;
        if (truncateData !== undefined) args.truncateData = truncateData;
        return invoke("get_execution", args);
      },
      {
        name: "get_execution",
        description:
          "Get combined status and step-by-step logs for a KeeperHub workflow execution. " +
          "Poll until status is success/completed (or failed). Extract transactionHash / " +
          "transactionHashes from the status payload to confirm on-chain confirmation.",
        schema: z.object({
          executionId: z
            .string()
            .describe("The execution ID returned by execute_workflow"),
          includeData: z
            .boolean()
            .optional()
            .describe(
              "Include input/output blobs on log entries. Prefer false while polling status.",
            ),
          nodeIds: z
            .array(z.string())
            .optional()
            .describe("Optional node IDs to restrict full data to"),
          truncateData: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Per-field byte cap for input/output payloads"),
        }),
      },
    ),

    // Compatibility aliases — KeeperHub v1.11 split status/logs; current server
    // exposes get_execution. Agents that still reason about the old names work.
    tool(
      async ({ executionId }) =>
        invoke("get_execution", { executionId, includeData: false }),
      {
        name: "get_execution_status",
        description:
          "Get workflow execution status only (compact). Alias over get_execution with " +
          "includeData=false. Poll until completed and read transactionHash.",
        schema: z.object({
          executionId: z
            .string()
            .describe("The execution ID returned by execute_workflow"),
        }),
      },
    ),

    tool(
      async ({ executionId }) =>
        invoke("get_execution", { executionId, includeData: true }),
      {
        name: "get_execution_logs",
        description:
          "Get workflow execution logs (step-by-step node I/O). Alias over get_execution " +
          "with includeData=true. Use after status shows success to verify on-chain write details.",
        schema: z.object({
          executionId: z
            .string()
            .describe("The execution ID returned by execute_workflow"),
        }),
      },
    ),
  ];
}
