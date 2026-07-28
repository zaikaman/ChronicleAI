// Public alert repository: create, find by dedupe key, list newest-first, update delivery status

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import {
  buildInsertPayload,
  buildUpdatePayload,
  expectRow,
  mapPostgrestError,
} from "./repository-utils.ts";
import type { EventType } from "@chronicleai/schemas";
import type { PublicAlertInsert, PublicAlertRow, PublicAlertUpdate } from "./types.ts";

/** Select alert columns plus joined monitored event metadata for public feeds. */
const ALERT_WITH_EVENT_SELECT = `
  *,
  monitored_events (
    event_type,
    chain_id,
    protocol
  )
`;

interface MonitoredEventJoin {
  event_type?: string | null;
  chain_id?: number | null;
  protocol?: string | null;
}

function mapAlertWithEvent(row: Record<string, unknown>): PublicAlertRow {
  const joined = row.monitored_events as MonitoredEventJoin | MonitoredEventJoin[] | null | undefined;
  const event = Array.isArray(joined) ? joined[0] : joined;

  const { monitored_events: _ignored, ...rest } = row;

  return {
    ...(rest as unknown as PublicAlertRow),
    event_type: (event?.event_type as EventType | null | undefined) ?? null,
    chain_id: typeof event?.chain_id === "number" ? event.chain_id : null,
    protocol: event?.protocol ?? null,
  };
}

export interface PublicAlertRepository {
  create(data: PublicAlertInsert): Promise<Result<PublicAlertRow>>;
  findById(id: string): Promise<Result<PublicAlertRow>>;
  findByDedupeKey(dedupeKey: string): Promise<PublicAlertRow | null>;
  list(limitParam?: number): Promise<Result<PublicAlertRow[]>>;
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
      keeperHubRunId?: string;
      explorerUrl?: string;
    },
  ): Promise<Result<PublicAlertRow>>;
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
      const { data: rows, error } = await table()
        .select(ALERT_WITH_EVENT_SELECT)
        .eq("id", id);

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

    async list(limitParam = 50) {
      const limit = Math.min(100, Math.max(1, limitParam));

      const { data: rows, error } = await table()
        .select(ALERT_WITH_EVENT_SELECT)
        .order("published_at", { ascending: false })
        .limit(limit);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(
        (rows ?? []).map((r) => mapAlertWithEvent(r as Record<string, unknown>)),
      );
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
  };
}
