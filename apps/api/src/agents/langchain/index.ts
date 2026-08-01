/**
 * ChronicleAI LangChain agent framework surface.
 * All production LLM orchestration should go through createAgent helpers here.
 */

export {
  createChatModel,
  createChatModelsInOrder,
  orderedProviders,
  messageContentToText,
  isAzureOpenAIEndpoint,
  normalizeGeminiBaseUrl,
  type ChronicleChatModel,
  type CreateChatModelOptions,
} from "./models.ts";

export {
  invokeStructuredAgent,
  invokeStructuredAgentWithFallback,
  createStructuredAgent,
  estimateTokens,
  fitPromptToTokenBudget,
  MAX_SAFE_INPUT_TOKENS,
  GROQ_EFFECTIVE_INPUT_BUDGET,
  GROQ_MAX_INPUT_TOKENS,
  type StructuredAgentInvokeParams,
  type StructuredAgentResult,
  type ProviderStructuredAttempt,
} from "./structured-agent.ts";

export {
  fitSystemAndUserToTokenBudget,
  fitTextToTokenBudget,
  fitMessageArrayToTokenBudget,
  capModelInputToGroqBudget,
  exceedsGroqInputLimit,
  GROQ_INPUT_SAFETY_MARGIN,
} from "./token-budget.ts";

export { withGroqInputTokenCap } from "./models.ts";

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
  isAlreadyPublishedError,
  type McpPublicationAction,
  type KeeperHubMcpPublicationReceipt,
  type PublishViaKeeperHubMcpParams,
} from "./keeperhub-mcp-publication-agent.ts";

export {
  executeViaKeeperHubMcp,
  executeViaDeterministicMcp,
  pollExecutionViaMcp,
  summarizeMcpToolCalls,
  mcpActionFromDeskAction,
  mcpActionFromWriteMethod,
  type McpWriteAction,
  type ExecuteViaKeeperHubMcpParams,
  type KeeperHubMcpExecuteReceipt,
} from "../../services/keeperhub-mcp-execute.ts";

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
