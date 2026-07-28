/**
 * ChronicleAI LangChain agent framework surface.
 * All production LLM orchestration should go through createAgent helpers here.
 */

export {
  createChatModel,
  createChatModelsInOrder,
  orderedProviders,
  messageContentToText,
  normalizeGeminiBaseUrl,
  type ChronicleChatModel,
  type CreateChatModelOptions,
} from "./models.ts";

export {
  invokeStructuredAgent,
  invokeStructuredAgentWithFallback,
  createStructuredAgent,
  type StructuredAgentInvokeParams,
  type StructuredAgentResult,
  type ProviderStructuredAttempt,
} from "./structured-agent.ts";

export {
  invokeToolAgent,
  type ToolAgentMessage,
  type ToolAgentToolCall,
  type InvokeToolAgentParams,
  type ToolAgentResult,
} from "./tool-agent.ts";

export {
  createKeeperHubMcpLangChainTools,
  KEEPERHUB_MCP_TOOL_NAMES,
  type KeeperHubMcpToolName,
  type KeeperHubMcpToolCallRecord,
} from "./keeperhub-mcp-tools.ts";

export {
  publishViaKeeperHubMcp,
  publishViaDeterministicMcp,
  buildMcpPublicationConfig,
  extractExecutionId,
  extractTxFromExecutionPayload,
  type McpPublicationAction,
  type KeeperHubMcpPublicationReceipt,
  type PublishViaKeeperHubMcpParams,
} from "./keeperhub-mcp-publication-agent.ts";

export {
  alertContentSchema,
  digestContentSchema,
  digestSectionsSchema,
  premiumNarrativeSchema,
  deskProposalSchema,
  failureClassificationSchema,
  signalFusionSchema,
  ticketNarrativeSchema,
} from "./schemas.ts";
