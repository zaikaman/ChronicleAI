// Public alert repository: create, find by dedupe key, list newest-first, update delivery status

import type {
  AlertActionStatus,
  AlertKind,
  AlertSignalStatus,
  DeskPolicyVerdict,
  DeskSignalType,
  EventType,
} from "@chronicleai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import {
  type PaginatedResult,
  type PaginationParams,
  buildInsertPayload,
  buildPaginatedResult,
  buildUpdatePayload,
  expectRow,
  mapPostgrestError,
  normalizePagination,
} from "./repository-utils.ts";
import type { PublicAlertInsert, PublicAlertRow, PublicAlertUpdate } from "./types.ts";

/** Select alert columns plus joined monitored event metadata for public feeds. */
const ALERT_WITH_EVENT_SELECT = `
  *,
  monitored_events (
    source_event_id,
    event_type,
    chain_id,
    protocol,
    transaction_hash,
    raw_payload
  )
`;

interface MonitoredEventJoin {
  source_event_id?: string | null;
  event_type?: string | null;
  chain_id?: number | null;
  protocol?: string | null;
  transaction_hash?: string | null;
  raw_payload?: Record<string, unknown> | null;
}

function extractFlowContext(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const fc = raw.flowContext;
  if (!fc || typeof fc !== "object") return null;
  return fc as Record<string, unknown>;
}

function mapAlertWithEvent(row: Record<string, unknown>): PublicAlertRow {
  const joined = row.monitored_events as
    | MonitoredEventJoin
    | MonitoredEventJoin[]
    | null
    | undefined;
  const event = Array.isArray(joined) ? joined[0] : joined;

  const { monitored_events: _ignored, ...rest } = row;
  const rowChainId = typeof row.chain_id === "number" ? row.chain_id : null;
  const rowTransactionHash = typeof row.transaction_hash === "string" ? row.transaction_hash : null;

  return {
    ...(rest as unknown as PublicAlertRow),
    source_event_id: event?.source_event_id ?? null,
    event_type: (event?.event_type as EventType | null | undefined) ?? null,
    chain_id: rowChainId ?? (typeof event?.chain_id === "number" ? event.chain_id : null),
    protocol: event?.protocol ?? null,
    transaction_hash:
      rowTransactionHash ??
      (typeof event?.transaction_hash === "string" ? event.transaction_hash : null),
    flow_context: extractFlowContext(event?.raw_payload ?? null),
  };
}

/** Unified feed scope: mainnet market + Sepolia desk triggers, or a single kind. */
export type PublicAlertFeedScope = "all" | "market" | "desk";

export interface PublicAlertListFilters {
  chainId?: number;
  /** Multi-chain filter (OR). Takes precedence over chainId when set. */
  chainIds?: number[];
  alertKind?: AlertKind;
  /**
   * Unified product scope:
   * - all: Mainnet market_event + Sepolia desk_trigger
   * - market: market_event only
   * - desk: desk_trigger only
   */
  feedScope?: PublicAlertFeedScope;
  signalStatus?: AlertSignalStatus;
  eventType?: EventType;
  policyVerdict?: DeskPolicyVerdict;
  actionStatus?: AlertActionStatus;
}

export interface PublicAlertRepository {
  create(data: PublicAlertInsert): Promise<Result<PublicAlertRow>>;
  findById(id: string): Promise<Result<PublicAlertRow>>;
  findByDedupeKey(dedupeKey: string): Promise<PublicAlertRow | null>;
  /** Lookup by source_dedupe_key for Desk-trigger reuse. */
  findBySourceDedupeKey?(sourceDedupeKey: string): Promise<PublicAlertRow | null>;
  /** Lookup for execution callbacks when no Desk Signal exists. */
  findByIntentId?(intentId: string): Promise<PublicAlertRow | null>;
  findByTicketId?(ticketId: string): Promise<PublicAlertRow | null>;
  /** Newest-first; limit-only convenience for internal consumers. */
  list(limitParam?: number, filters?: PublicAlertListFilters): Promise<Result<PublicAlertRow[]>>;
  /** Page-based list with exact total for public feeds. */
  listPage(
    params?: PaginationParams & PublicAlertListFilters,
  ): Promise<Result<PaginatedResult<PublicAlertRow>>>;
  listByEventIds?(eventIds: string[]): Promise<Result<PublicAlertRow[]>>;
  updateDeliveryStatus(
    id: string,
    status: string,
    publishedAt?: string,
  ): Promise<Result<PublicAlertRow>>;
  updateGenerationMetadata(
    id: string,
    metadata: {
      generationProvider?: string;
      generationAttemptIds?: string[];
    },
  ): Promise<Result<PublicAlertRow>>;
  updateRegistryMetadata(
    id: string,
    metadata: {
      registryTxHash?: string;
      sourceEventHash?: string;
      contentUri?: string;
      contentHash?: string;
      gasUsed?: string;
      gasUsedWei?: string;
      keeperHubRunId?: string;
      explorerUrl?: string;
    },
  ): Promise<Result<PublicAlertRow>>;
  updateContent?(
    id: string,
    content: {
      title?: string;
      summary?: string;
      sourceReferences?: string[];
      confidence?: string | null;
      deterministicEvidence?: Record<string, unknown>;
    },
  ): Promise<Result<PublicAlertRow>>;
  updateCausalMetadata?(
    id: string,
    metadata: {
      deskSignalId?: string | null;
      signalType?: DeskSignalType | null;
      signalStatus?: AlertSignalStatus;
      policyVerdict?: DeskPolicyVerdict | null;
      actionStatus?: AlertActionStatus;
      intentId?: string | null;
      ticketId?: string | null;
      actionTransactionHash?: string | null;
      actionKeeperHubRunId?: string | null;
      actionExplorerUrl?: string | null;
    },
  ): Promise<Result<PublicAlertRow>>;
}

/** Primary (Mainnet) and active (Sepolia) chain IDs for unified feed scope. */
const PRIMARY_CHAIN_ID = 1;
const ACTIVE_CHAIN_ID = 11_155_111;

type FilterableQuery = {
  eq: (column: string, value: unknown) => FilterableQuery;
  in: (column: string, values: unknown[]) => FilterableQuery;
  or: (filters: string) => FilterableQuery;
  neq: (column: string, value: unknown) => FilterableQuery;
};

function applyAlertListFilters<T extends FilterableQuery>(
  query: T,
  filters?: PublicAlertListFilters,
): T {
  let q: FilterableQuery = query.neq("delivery_status", "queued");

  if (filters?.feedScope === "all") {
    // Mainnet market Alerts + Sepolia Desk-trigger Alerts (server-side union).
    q = q.or(
      `and(chain_id.eq.${PRIMARY_CHAIN_ID},alert_kind.eq.market_event),and(chain_id.eq.${ACTIVE_CHAIN_ID},alert_kind.eq.desk_trigger)`,
    );
  } else if (filters?.feedScope === "market") {
    q = q.eq("alert_kind", "market_event");
    if (filters.chainId !== undefined) q = q.eq("chain_id", filters.chainId);
    else if (filters.chainIds && filters.chainIds.length > 0) q = q.in("chain_id", filters.chainIds);
  } else if (filters?.feedScope === "desk") {
    q = q.eq("alert_kind", "desk_trigger");
    if (filters.chainId !== undefined) q = q.eq("chain_id", filters.chainId);
    else if (filters.chainIds && filters.chainIds.length > 0) q = q.in("chain_id", filters.chainIds);
  } else {
    if (filters?.chainIds && filters.chainIds.length > 0) {
      q = q.in("chain_id", filters.chainIds);
    } else if (filters?.chainId !== undefined) {
      q = q.eq("chain_id", filters.chainId);
    }
    if (filters?.alertKind) q = q.eq("alert_kind", filters.alertKind);
  }

  if (filters?.signalStatus) q = q.eq("signal_status", filters.signalStatus);
  if (filters?.eventType) q = q.eq("event_type", filters.eventType);
  if (filters?.policyVerdict) q = q.eq("policy_verdict", filters.policyVerdict);
  if (filters?.actionStatus) q = q.eq("action_status", filters.actionStatus);

  return q as T;
}

export function createPublicAlertRepository(supabase: SupabaseClient): PublicAlertRepository {
  const table = () => supabase.from("public_alerts");

  return {
    async create(data) {
      const payload = buildInsertPayload(data as unknown as Record<string, unknown>);
      const { data: rows, error } = await table().insert(payload).select().single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as PublicAlertRow);
    },

    async findById(id) {
      const { data: rows, error } = await table().select(ALERT_WITH_EVENT_SELECT).eq("id", id);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      const mapped = (rows ?? []).map((r) => mapAlertWithEvent(r as Record<string, unknown>));
      return expectRow(mapped, "PublicAlert", id);
    },

    async findByDedupeKey(dedupeKey) {
      const { data: rows, error } = await table().select("*").eq("dedupe_key", dedupeKey);

      if (error) {
        return null;
      }

      return (rows?.[0] as unknown as PublicAlertRow) ?? null;
    },

    async findBySourceDedupeKey(sourceDedupeKey) {
      const { data: rows, error } = await table()
        .select("*")
        .eq("source_dedupe_key", sourceDedupeKey)
        .limit(1);

      if (error) {
        return null;
      }

      return (rows?.[0] as unknown as PublicAlertRow) ?? null;
    },

    async findByIntentId(intentId) {
      const { data: rows, error } = await table()
        .select(ALERT_WITH_EVENT_SELECT)
        .eq("intent_id", intentId)
        .limit(1);

      if (error) {
        return null;
      }

      const mapped = (rows ?? []).map((r) => mapAlertWithEvent(r as Record<string, unknown>));
      return mapped[0] ?? null;
    },

    async findByTicketId(ticketId) {
      const { data: rows, error } = await table()
        .select(ALERT_WITH_EVENT_SELECT)
        .eq("ticket_id", ticketId)
        .limit(1);

      if (error) {
        return null;
      }

      const mapped = (rows ?? []).map((r) => mapAlertWithEvent(r as Record<string, unknown>));
      return mapped[0] ?? null;
    },

    async list(limitParam = 50, filters = {}) {
      const limit = Math.min(100, Math.max(1, limitParam));

      let query = table().select(ALERT_WITH_EVENT_SELECT);
      query = applyAlertListFilters(query as unknown as FilterableQuery, filters) as any;

      const { data: rows, error } = await query
        .order("published_at", { ascending: false })
        .limit(limit);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success((rows ?? []).map((r) => mapAlertWithEvent(r as Record<string, unknown>)));
    },

    async listPage(params) {
      const { page, limit, offset } = normalizePagination(params, {
        defaultLimit: 20,
        maxLimit: 100,
      });

      let query = table().select(ALERT_WITH_EVENT_SELECT, { count: "exact" });
      query = applyAlertListFilters(query as unknown as FilterableQuery, params) as any;

      const {
        data: rows,
        error,
        count,
      } = await query.order("published_at", { ascending: false }).range(offset, offset + limit - 1);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      const items = (rows ?? []).map((r) => mapAlertWithEvent(r as Record<string, unknown>));
      return success(buildPaginatedResult(items, page, limit, count ?? items.length));
    },

    async listByEventIds(eventIds) {
      if (eventIds.length === 0) return success([]);
      const { data: rows, error } = await table()
        .select(ALERT_WITH_EVENT_SELECT)
        .in("monitored_event_id", eventIds);
      if (error) return failure(mapPostgrestError(error));
      return success((rows ?? []).map((r) => mapAlertWithEvent(r as Record<string, unknown>)));
    },

    async updateDeliveryStatus(id, status, publishedAt?) {
      const update: PublicAlertUpdate = {
        delivery_status: status as PublicAlertRow["delivery_status"],
      };
      if (publishedAt) {
        update.published_at = publishedAt;
      }
      if (status === "published" && !publishedAt) {
        update.published_at = new Date().toISOString();
      }

      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      const { data: rows, error } = await table().update(payload).eq("id", id).select().single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as PublicAlertRow);
    },

    async updateGenerationMetadata(id, metadata) {
      const update: PublicAlertUpdate = {};
      if (metadata.generationProvider) {
        update.generation_provider = metadata.generationProvider;
      }
      if (metadata.generationAttemptIds) {
        update.generation_attempt_ids = metadata.generationAttemptIds;
      }

      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      const { data: rows, error } = await table().update(payload).eq("id", id).select().single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as PublicAlertRow);
    },

    async updateRegistryMetadata(id, metadata) {
      const update: PublicAlertUpdate = {};
      if (metadata.registryTxHash) {
        update.registry_tx_hash = metadata.registryTxHash;
      }
      if (metadata.sourceEventHash) {
        update.source_event_hash = metadata.sourceEventHash;
      }
      if (metadata.contentUri) {
        update.content_uri = metadata.contentUri;
      }
      if (metadata.contentHash) {
        update.content_hash = metadata.contentHash;
      }
      if (metadata.gasUsed) {
        update.gas_used = metadata.gasUsed;
      }
      if (metadata.gasUsedWei) {
        update.gas_used_wei = metadata.gasUsedWei;
      }
      if (metadata.keeperHubRunId) {
        update.keeper_hub_run_id = metadata.keeperHubRunId;
      }
      if (metadata.explorerUrl) {
        update.explorer_url = metadata.explorerUrl;
      }

      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      const { data: rows, error } = await table().update(payload).eq("id", id).select().single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as PublicAlertRow);
    },

    async updateContent(id, content) {
      const update: PublicAlertUpdate = {};
      if (content.title !== undefined) update.title = content.title;
      if (content.summary !== undefined) update.summary = content.summary;
      if (content.sourceReferences !== undefined) {
        update.source_references = content.sourceReferences;
      }
      if (content.confidence !== undefined) {
        update.confidence = content.confidence as PublicAlertRow["confidence"];
      }
      if (content.deterministicEvidence !== undefined) {
        update.deterministic_evidence = content.deterministicEvidence;
      }
      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      const { data: rows, error } = await table().update(payload).eq("id", id).select().single();
      if (error) return failure(mapPostgrestError(error));
      return success(rows as unknown as PublicAlertRow);
    },

    async updateCausalMetadata(id, metadata) {
      const update: PublicAlertUpdate = {};
      if (metadata.deskSignalId !== undefined) update.desk_signal_id = metadata.deskSignalId;
      if (metadata.signalType !== undefined) update.signal_type = metadata.signalType;
      if (metadata.signalStatus !== undefined) update.signal_status = metadata.signalStatus;
      if (metadata.policyVerdict !== undefined) update.policy_verdict = metadata.policyVerdict;
      if (metadata.actionStatus !== undefined) update.action_status = metadata.actionStatus;
      if (metadata.intentId !== undefined) update.intent_id = metadata.intentId;
      if (metadata.ticketId !== undefined) update.ticket_id = metadata.ticketId;
      if (metadata.actionTransactionHash !== undefined) {
        update.action_transaction_hash = metadata.actionTransactionHash;
      }
      if (metadata.actionKeeperHubRunId !== undefined) {
        update.action_keeper_hub_run_id = metadata.actionKeeperHubRunId;
      }
      if (metadata.actionExplorerUrl !== undefined) {
        update.action_explorer_url = metadata.actionExplorerUrl;
      }
      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      const { data: rows, error } = await table().update(payload).eq("id", id).select().single();
      if (error) return failure(mapPostgrestError(error));
      return success(rows as unknown as PublicAlertRow);
    },
  };
}
