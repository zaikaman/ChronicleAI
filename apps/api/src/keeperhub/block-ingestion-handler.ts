// KeeperHub block-trigger ingestion: analyze real chain data and feed qualified events

import type { ExecutionLogRepository } from "@chronicleai/db";
import { isAllowedSignalSourceChain } from "@chronicleai/config";
import type { BlockIngestionPayload, EventIngestionPayload } from "@chronicleai/schemas";
import type { OnChainBlockService } from "../monitoring/on-chain-block-service.ts";
import type { EventIngestionHandler, IngestionResult } from "./event-ingestion-handler.ts";

export interface BlockIngestionResult {
  accepted: boolean;
  statusCode: number;
  message: string;
  blockNumber?: number;
  chainId?: number;
  baseFeeGwei?: number | null;
  transactionCount?: number;
  volumeZScore?: number | null;
  emitted: Array<{
    eventType: string;
    sourceEventId: string;
    result: IngestionResult;
  }>;
}

export class BlockIngestionHandler {
  constructor(
    private readonly blockService: OnChainBlockService,
    private readonly eventHandler: EventIngestionHandler,
    private readonly execLogRepo: ExecutionLogRepository,
  ) {}

  async ingest(payload: BlockIngestionPayload): Promise<BlockIngestionResult> {
    const startedAt = Date.now();

    if (!isAllowedSignalSourceChain(payload.chainId)) {
      return {
        accepted: false,
        statusCode: 400,
        message: `Unsupported block signal source chain ${payload.chainId}; only Ethereum Mainnet and Ethereum Sepolia are allowed`,
        emitted: [],
      };
    }

    await this.execLogRepo.append({
      action_type: "monitor",
      entity_type: "monitored_event",
      entity_id: null,
      status: "started",
      message: `Block analysis started: chain ${payload.chainId} block ${payload.blockNumber}`,
      details: {
        chainId: payload.chainId,
        blockNumber: payload.blockNumber,
        sourceEventId: payload.sourceEventId ?? null,
      },
    });

    let analysis;
    try {
      analysis = await this.blockService.analyzeBlock(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Block analysis failed";
      await this.execLogRepo.append({
        action_type: "monitor",
        entity_type: "monitored_event",
        entity_id: null,
        status: "failed",
        message,
        details: {
          chainId: payload.chainId,
          blockNumber: payload.blockNumber,
          latencyMs: Date.now() - startedAt,
        },
      });
      return {
        accepted: false,
        statusCode: 502,
        message,
        emitted: [],
      };
    }

    const emitted: BlockIngestionResult["emitted"] = [];

    for (const event of analysis.events) {
      const result = await this.eventHandler.ingest(event, "keeperhub-block");
      emitted.push({
        eventType: event.eventType,
        sourceEventId: event.sourceEventId,
        result,
      });
    }

    await this.execLogRepo.append({
      action_type: "monitor",
      entity_type: "monitored_event",
      entity_id: null,
      status: "succeeded",
      message:
        analysis.events.length === 0
          ? `Block ${analysis.stats.blockNumber} analyzed — no thresholds crossed`
          : `Block ${analysis.stats.blockNumber} analyzed — ${analysis.events.length} event(s) emitted`,
      details: {
        chainId: analysis.stats.chainId,
        blockNumber: analysis.stats.blockNumber,
        baseFeeGwei: analysis.stats.baseFeeGwei,
        transactionCount: analysis.stats.transactionCount,
        volumeZScore: analysis.volumeZScore,
        createdContracts: analysis.stats.createdContracts.length,
        emittedEventTypes: analysis.events.map((e: EventIngestionPayload) => e.eventType),
        latencyMs: Date.now() - startedAt,
      },
    });

    return {
      accepted: true,
      statusCode: 202,
      message:
        analysis.events.length === 0
          ? "Block accepted; no gas/volume/deployment thresholds crossed"
          : `Block accepted; ${analysis.events.length} event(s) forwarded to ingestion`,
      blockNumber: analysis.stats.blockNumber,
      chainId: analysis.stats.chainId,
      baseFeeGwei: analysis.stats.baseFeeGwei,
      transactionCount: analysis.stats.transactionCount,
      volumeZScore: analysis.volumeZScore,
      emitted,
    };
  }
}
