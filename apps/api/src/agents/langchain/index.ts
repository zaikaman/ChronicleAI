/**
 * ChronicleAI LangChain agent framework surface.
 * All production LLM orchestration should go through createAgent helpers here.
 */

export {
  createChatModel,
  createChatModelsInOrder,
  orderedProviders,
  messageContentToText,
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
  alertContentSchema,
  digestContentSchema,
  premiumNarrativeSchema,
  deskProposalSchema,
  failureClassificationSchema,
  signalFusionSchema,
  ticketNarrativeSchema,
} from "./schemas.ts";
