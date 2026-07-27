// Legacy export — prefer useAgentActivity from features/activity
export {
  useAgentActivity as useOperatorAudit,
  type AgentActivityData as OperatorAuditData,
  type AgentActivityState as OperatorAuditState,
} from "../activity/use-agent-activity.ts";
