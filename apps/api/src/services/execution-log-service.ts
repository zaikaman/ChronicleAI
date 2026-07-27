// Structured execution logger service that writes to execution_logs

import type { ExecutionLogActionType, ExecutionLogStatus } from "@chronicleai/schemas";

// ── ExecutionLogInsert inline type ─────────────────────
interface ExecutionLogInsert {
  action_type: ExecutionLogActionType;
  entity_type: string | null;
  entity_id: string | null;
  status: ExecutionLogStatus;
  message: string | null;
  details: unknown;
  started_at: string;
  completed_at: string | null;
}

export interface ExecutionLogService {
  append(
    actionType: ExecutionLogActionType,
    status: ExecutionLogStatus,
    params?: {
      entityType?: string;
      entityId?: string;
      message?: string;
      details?: unknown;
    },
  ): Promise<void>;
}

export function createExecutionLogService(supabase: {
  from: (table: string) => {
    insert: (data: ExecutionLogInsert) => Promise<{ error: { message: string } | null }>;
  };
}): ExecutionLogService {
  return {
    async append(actionType, status, params?) {
      const insert: ExecutionLogInsert = {
        action_type: actionType,
        entity_type: params?.entityType ?? null,
        entity_id: params?.entityId ?? null,
        status,
        message: params?.message ?? null,
        details: params?.details ?? {},
        started_at: new Date().toISOString(),
        completed_at:
          status === "succeeded" || status === "failed" ? new Date().toISOString() : null,
      };

      const { error } = await supabase.from("execution_logs").insert(insert);

      if (error) {
        console.error("Failed to write execution log:", error.message);
      }
    },
  };
}
