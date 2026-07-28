/**
 * Desk ticket service: build canonical ticket JSON, hash, persist, publish on-chain.
 */

import {
  buildDeskTicketV1,
  hashDeskCommitment,
  hashDeskTicket,
  type DeskTicketV1,
  type DeskTicketRepository,
  type DeskTicketRow,
  type DeskIntentRepository,
} from "@chronicleai/db";
import type { DeskStrategy } from "@chronicleai/schemas";
import type { ChronicleRegistryService } from "../services/chronicle-registry-service.ts";
import {
  assertProductionContentOrigin,
  buildDeskTicketContentUri,
  normalizeOrigin,
} from "../services/content-uri.ts";
import type { DeskIntentFill, DeskLeg, DeskTicketBuildInput } from "./types.ts";

export interface TicketPublishResult {
  ticket: DeskTicketRow;
  ticketHash: string;
  signalHash: string;
  intentHash: string;
  contentUri: string;
  summary: string;
  registryTxHash?: string | undefined;
  explorerUrl?: string | undefined;
  keeperHubRunId?: string | undefined;
  registryError?: string | undefined;
}

export interface TicketService {
  buildCanonical(input: DeskTicketBuildInput): {
    ticket: DeskTicketV1;
    ticketHash: string;
    signalHash: string;
    intentHash: string;
    summary: string;
  };

  /** Persist ticket row (without requiring registry write). */
  create(input: DeskTicketBuildInput & { contentUri?: string }): Promise<DeskTicketRow>;

  /**
   * Build → persist → publishTradeTicket on registry.
   * contentUri uses FRONTEND_ORIGIN /desk/tickets/:id after insert.
   */
  publish(input: DeskTicketBuildInput): Promise<TicketPublishResult>;

  findById(id: string): Promise<DeskTicketRow | null>;
  findByIntentId(intentId: string): Promise<DeskTicketRow | null>;
  findBySignalHash(signalHash: string): Promise<DeskTicketRow | null>;
  listRecent(limit?: number): Promise<DeskTicketRow[]>;
  listPage(params?: {
    page?: number;
    limit?: number;
  }): Promise<import("@chronicleai/db").PaginatedResult<DeskTicketRow>>;
  summarize(input: {
    strategy: DeskStrategy | string;
    notionalUsdc: number;
    legs: DeskLeg[];
    reasonCodes?: string[];
  }): string;
}

export function createTicketService(deps: {
  tickets: DeskTicketRepository;
  intents?: DeskIntentRepository | null;
  registry?: ChronicleRegistryService | null;
  frontendOrigin: string;
  /**
   * When true (NODE_ENV=production), refuse localhost / non-https contentUri
   * so historical localhost tickets cannot recur on-chain.
   */
  strictContentUri?: boolean;
}): TicketService {
  const { tickets, registry } = deps;
  const strict = deps.strictContentUri === true;

  function resolveFrontendOrigin(): string {
    if (strict) {
      return assertProductionContentOrigin(deps.frontendOrigin);
    }
    return normalizeOrigin(deps.frontendOrigin);
  }

  const frontendOrigin = (() => {
    try {
      return resolveFrontendOrigin();
    } catch (error) {
      if (strict) {
        // Defer hard failure to publish time with a clear registryError.
        console.error(
          "[desk.ticket] FRONTEND_ORIGIN invalid for production:",
          error instanceof Error ? error.message : error,
        );
      }
      return deps.frontendOrigin.replace(/\/+$/, "");
    }
  })();

  function summarize(input: {
    strategy: DeskStrategy | string;
    notionalUsdc: number;
    legs: DeskLeg[];
    reasonCodes?: string[] | undefined;
  }): string {
    const legSummary =
      input.legs.length === 0
        ? "no legs"
        : input.legs
            .map((l) => `${l.protocol}:${l.action}`)
            .slice(0, 4)
            .join(" → ");
    const reason =
      input.reasonCodes && input.reasonCodes.length > 0
        ? ` (${input.reasonCodes.slice(0, 3).join(", ")})`
        : "";
    return `Desk ${input.strategy} · ${input.notionalUsdc} USDC · ${legSummary}${reason}`;
  }

  function buildCanonical(input: DeskTicketBuildInput) {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const ticket = buildDeskTicketV1({
      intentId: input.intentId,
      strategy: input.strategy,
      signal: {
        type: input.signal.type,
        features: input.signal.features ?? {},
      },
      legs: input.legs as DeskTicketV1["legs"],
      fills: (input.fills ?? []) as DeskTicketV1["fills"],
      policy: input.policy ?? {},
      notionalUsdc: input.notionalUsdc,
      createdAt,
    });

    const ticketHash = hashDeskTicket(ticket);
    const signalHash = hashDeskCommitment(ticket.signal);
    const intentHash = hashDeskCommitment({
      intentId: ticket.intentId,
      strategy: ticket.strategy,
      legs: ticket.legs,
      notionalUsdc: ticket.notionalUsdc,
    });

    const summary =
      input.summary ??
      summarize({
        strategy: input.strategy,
        notionalUsdc: input.notionalUsdc,
        legs: input.legs,
        reasonCodes: Array.isArray(input.policy.reasonCodes)
          ? (input.policy.reasonCodes as string[])
          : undefined,
      });

    return { ticket, ticketHash, signalHash, intentHash, summary };
  }

  return {
    buildCanonical,
    summarize,

    async create(input) {
      const { ticket, ticketHash, signalHash, intentHash, summary } =
        buildCanonical(input);

      // Pre-insert with placeholder URI if none; publish path rewrites after id known.
      const contentUri =
        input.contentUri ??
        `${frontendOrigin.replace(/\/+$/, "")}/desk/tickets/pending`;

      const created = await tickets.create({
        intent_id: input.intentId,
        ticket_hash: ticketHash,
        signal_hash: signalHash,
        intent_hash: intentHash,
        content_uri: contentUri,
        summary,
        payload: ticket as unknown as Record<string, unknown>,
      });
      if (!created.ok) throw created.error;
      return created.value;
    },

    async publish(input) {
      const { ticket, ticketHash, signalHash, intentHash, summary } =
        buildCanonical(input);

      let originForUri: string;
      try {
        originForUri = resolveFrontendOrigin();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "FRONTEND_ORIGIN invalid for trade ticket contentUri";
        // Still persist the ticket row for UI, but refuse on-chain publish with localhost.
        const provisionalUri = `${frontendOrigin.replace(/\/+$/, "")}/desk/tickets/pending`;
        const created = await tickets.create({
          intent_id: input.intentId,
          ticket_hash: ticketHash,
          signal_hash: signalHash,
          intent_hash: intentHash,
          content_uri: provisionalUri,
          summary,
          payload: ticket as unknown as Record<string, unknown>,
        });
        if (!created.ok) throw created.error;
        return {
          ticket: created.value,
          ticketHash,
          signalHash,
          intentHash,
          contentUri: provisionalUri,
          summary,
          registryError: message,
        };
      }

      // Insert first to obtain stable ticket id for contentUri
      const provisionalUri = `${originForUri.replace(/\/+$/, "")}/desk/tickets/pending`;
      const created = await tickets.create({
        intent_id: input.intentId,
        ticket_hash: ticketHash,
        signal_hash: signalHash,
        intent_hash: intentHash,
        content_uri: provisionalUri,
        summary,
        payload: ticket as unknown as Record<string, unknown>,
      });
      if (!created.ok) throw created.error;

      let row = created.value;
      const contentUri = buildDeskTicketContentUri(originForUri, row.id);

      const updated = await tickets.update(row.id, { content_uri: contentUri });
      if (!updated.ok) throw updated.error;
      row = updated.value;

      if (!registry) {
        return {
          ticket: row,
          ticketHash,
          signalHash,
          intentHash,
          contentUri,
          summary,
          registryError: "Registry service not configured for publishTradeTicket",
        };
      }

      const published = await registry.publishTradeTicket(
        ticketHash,
        signalHash,
        intentHash,
        contentUri,
      );

      if (!published.success) {
        return {
          ticket: row,
          ticketHash,
          signalHash,
          intentHash,
          contentUri,
          summary,
          registryError: published.errorMessage ?? "publishTradeTicket failed",
        };
      }

      const withProof = await tickets.update(row.id, {
        tx_hash: published.txHash ?? null,
        explorer_url: published.explorerUrl ?? null,
        keeper_hub_run_id: published.keeperHubRunId ?? null,
      });
      if (!withProof.ok) throw withProof.error;

      return {
        ticket: withProof.value,
        ticketHash,
        signalHash,
        intentHash,
        contentUri,
        summary,
        registryTxHash: published.txHash,
        explorerUrl: published.explorerUrl,
        keeperHubRunId: published.keeperHubRunId,
      };
    },

    async findById(id) {
      const result = await tickets.findById(id);
      if (!result.ok) throw result.error;
      return result.value;
    },

    async findByIntentId(intentId) {
      const result = await tickets.findByIntentId(intentId);
      if (!result.ok) throw result.error;
      return result.value;
    },

    async findBySignalHash(signalHash) {
      const result = await tickets.findBySignalHash(signalHash);
      if (!result.ok) throw result.error;
      return result.value;
    },

    async listRecent(limit = 50) {
      const result = await tickets.listRecent(limit);
      if (!result.ok) throw result.error;
      return result.value;
    },

    async listPage(params) {
      const result = await tickets.listPage(params);
      if (!result.ok) throw result.error;
      return result.value;
    },
  };
}

/** Helper: map execution fills onto ticket publish input for a filled intent. */
export function ticketInputFromIntent(params: {
  intentId: string;
  strategy: DeskStrategy;
  signalType: string;
  signalFeatures: Record<string, unknown>;
  legs: DeskLeg[];
  fills: DeskIntentFill[];
  policy: Record<string, unknown>;
  notionalUsdc: number;
  createdAt?: string | undefined;
}): DeskTicketBuildInput {
  return {
    intentId: params.intentId,
    strategy: params.strategy,
    signal: { type: params.signalType, features: params.signalFeatures },
    legs: params.legs,
    fills: params.fills,
    policy: params.policy,
    notionalUsdc: params.notionalUsdc,
    createdAt: params.createdAt,
  };
}
