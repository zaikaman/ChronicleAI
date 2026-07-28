/**
 * Emit first-class Activity / execution_log rows for CCTP rebalance lifecycle.
 *
 * Prefer explicit activity writes over pure DB derivation so the public Activity
 * feed shows burn/mint transitions with explorer links during demos.
 */

import type { ExecutionLogStatus } from "@chronicleai/schemas";
import { cctpExplorerUrls } from "./explorers.ts";
import { cctpLog } from "./log.ts";

export type CctpActivityPhase =
  | "created"
  | "approving"
  | "burned"
  | "awaiting_attestation"
  | "minting"
  | "minted"
  | "failed"
  | "stuck";

export interface CctpActivityEvent {
  phase: CctpActivityPhase;
  transferId: string;
  amountUsdc?: number | undefined;
  mode?: string | undefined;
  status?: string | undefined;
  burnTxHash?: string | null | undefined;
  mintTxHash?: string | null | undefined;
  errorMessage?: string | null | undefined;
  errorClass?: string | undefined;
  force?: boolean | undefined;
}

export interface CctpActivityLogger {
  append(
    actionType: "cctp_rebalance",
    status: ExecutionLogStatus,
    params?: {
      entityType?: string;
      entityId?: string;
      message?: string;
      details?: unknown;
    },
  ): Promise<void>;
}

function phaseToLogStatus(phase: CctpActivityPhase): ExecutionLogStatus {
  switch (phase) {
    case "minted":
      return "succeeded";
    case "failed":
      return "failed";
    case "stuck":
      return "retrying";
    default:
      return "started";
  }
}

function phaseMessage(event: CctpActivityEvent): string {
  const amount =
    event.amountUsdc != null && Number.isFinite(event.amountUsdc)
      ? `${event.amountUsdc} USDC`
      : "USDC";
  switch (event.phase) {
    case "created":
      return `CCTP rebalance started: burn ${amount} on Base Sepolia → mint on Ethereum Sepolia`;
    case "approving":
      return `CCTP approving USDC for TokenMessenger (${amount})`;
    case "burned":
      return `CCTP burn confirmed on Base Sepolia (${amount}) — awaiting Circle attestation`;
    case "awaiting_attestation":
      return `CCTP awaiting Iris attestation for ${amount}`;
    case "minting":
      return `CCTP minting ${amount} on Ethereum Sepolia (direct receiveMessage)`;
    case "minted":
      return `CCTP rebalance complete: ${amount} minted to treasury on Ethereum Sepolia`;
    case "failed":
      return `CCTP rebalance failed${event.errorMessage ? `: ${event.errorMessage}` : ""}`;
    case "stuck":
      return `CCTP rebalance stuck${event.errorMessage ? `: ${event.errorMessage}` : " — will resume"}`;
    default:
      return `CCTP rebalance ${event.phase}`;
  }
}

/**
 * Best-effort activity write. Never throws into the rebalance state machine.
 */
export async function emitCctpActivityEvent(
  logger: CctpActivityLogger | null | undefined,
  event: CctpActivityEvent,
): Promise<void> {
  if (!logger) return;

  const explorers = cctpExplorerUrls({
    burnTxHash: event.burnTxHash,
    mintTxHash: event.mintTxHash,
  });

  const details: Record<string, unknown> = {
    phase: event.phase,
    transferId: event.transferId,
    direction: "base_to_sepolia",
    sourceChainId: 84532,
    destinationChainId: 11155111,
  };
  if (event.amountUsdc != null) details.amountUsdc = event.amountUsdc;
  if (event.mode) details.mode = event.mode;
  if (event.status) details.status = event.status;
  if (event.burnTxHash) {
    details.burnTxHash = event.burnTxHash;
    details.burn_tx_hash = event.burnTxHash;
  }
  if (event.mintTxHash) {
    details.mintTxHash = event.mintTxHash;
    details.mint_tx_hash = event.mintTxHash;
  }
  if (explorers.burnExplorerUrl) {
    details.burnExplorerUrl = explorers.burnExplorerUrl;
    details.explorer_url = explorers.burnExplorerUrl;
  }
  if (explorers.mintExplorerUrl) {
    details.mintExplorerUrl = explorers.mintExplorerUrl;
    // Prefer mint explorer when both exist for the "primary" proof link.
    if (event.phase === "minted" || event.phase === "minting") {
      details.explorer_url = explorers.mintExplorerUrl;
    }
  }
  if (event.errorMessage) details.errorMessage = event.errorMessage;
  if (event.errorClass) details.errorClass = event.errorClass;
  if (event.force === true) details.force = true;

  try {
    await logger.append("cctp_rebalance", phaseToLogStatus(event.phase), {
      entityType: "cctp_rebalance_transfer",
      entityId: event.transferId,
      message: phaseMessage(event),
      details,
    });
  } catch (error) {
    cctpLog("warn", "activity_emit_failed", {
      transferId: event.transferId,
      phase: event.phase,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
