/**
 * Wire a production CCTP rebalance service from server env.
 *
 * Signer preference (hardening):
 * 1. **Para MPC treasury** — burn Base USDC + mint Sepolia USDC from the
 *    treasury pocket (same address both chains). Preferred production path.
 * 2. **CCTP_OPERATOR_PRIVATE_KEY** — legacy multi-chain EOA fallback when
 *    Para is not configured. Mint recipient remains treasury.
 *
 * Mint policy: as soon as Iris is complete, mint via receiveMessage (no long
 * Forwarding Service wait). Opportunistic forwardTxHash still accepted.
 */

import type { ServerEnv } from "@chronicleai/config";
import {
  createCctpRebalanceRepository,
  createServerSupabaseClient,
  type CctpRebalanceRepository,
} from "@chronicleai/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CctpActivityLogger } from "./activity-events.ts";
import { createIrisClient, type IrisClient } from "./iris-client.ts";
import { createOperatorChainExecutor } from "./multi-chain-executor.ts";
import {
  createParaChainExecutorFromEnv,
  isParaChainExecutorConfigured,
} from "./para-chain-executor.ts";
import {
  createCctpRebalanceService,
  cctpServiceConfigFromEnv,
  type CctpRebalanceService,
} from "./rebalance-service.ts";
import type { CctpChainExecutor } from "./types.ts";

export type CctpStackFromEnv = {
  service: CctpRebalanceService;
  repo: CctpRebalanceRepository;
  iris: IrisClient;
  executor: CctpChainExecutor;
  /** Which multi-chain signer path was selected. */
  executorBackend: "para" | "operator";
};

export type CctpStackUnavailable = {
  service: null;
  reason: string;
};

export type CreateCctpStackOptions = {
  env: ServerEnv;
  /**
   * Prefer injecting the shared server Supabase client so CCTP uses the same
   * connection pool as the rest of the API.
   */
  supabase?: SupabaseClient;
  repo?: CctpRebalanceRepository;
  /** Activity / execution_log writer for rebalance lifecycle events. */
  activityLogger?: CctpActivityLogger | null;
  /**
   * Desk-starvation probe for CCTP_FORCE_ON_DESK_STARVATION.
   * May close over late-bound desk control plane state.
   */
  getDeskStarved?: () => Promise<boolean> | boolean;
};

/**
 * Attempt to build the full CCTP stack. Returns reason when prerequisites
 * are missing (does not throw).
 */
export function tryCreateCctpRebalanceStackFromEnv(
  options: CreateCctpStackOptions,
): CctpStackFromEnv | CctpStackUnavailable {
  const { env } = options;
  const treasury = env.treasuryWalletAddress?.trim();
  if (!treasury) {
    return {
      service: null,
      reason: "TREASURY_WALLET_ADDRESS is not set",
    };
  }

  const baseRpc = env.x402RpcUrl?.trim();
  if (!baseRpc) {
    return {
      service: null,
      reason:
        "X402_RPC_URL or BASE_SEPOLIA_RPC_URL is required for Base Sepolia CCTP burns",
    };
  }

  const sepoliaRpc = env.rpcUrl?.trim();
  if (!sepoliaRpc) {
    return {
      service: null,
      reason:
        "RPC_URL is required for Ethereum Sepolia CCTP mints and balance reads",
    };
  }

  let executor: CctpChainExecutor;
  let executorBackend: "para" | "operator";

  if (isParaChainExecutorConfigured(env)) {
    try {
      executor = createParaChainExecutorFromEnv(env);
      executorBackend = "para";
    } catch (error) {
      return {
        service: null,
        reason: `Para CCTP executor failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  } else {
    const operatorKey = env.cctpOperatorPrivateKey?.trim();
    if (!operatorKey) {
      return {
        service: null,
        reason:
          "CCTP requires PARA_API_KEY (preferred: burn from Para treasury) or CCTP_OPERATOR_PRIVATE_KEY (legacy multi-chain signer)",
      };
    }
    executor = createOperatorChainExecutor({
      privateKey: operatorKey,
      baseRpcUrl: baseRpc,
      sepoliaRpcUrl: sepoliaRpc,
      tokenMessenger: env.cctpTokenMessenger,
      messageTransmitter: env.cctpMessageTransmitter,
      baseUsdc: env.x402UsdcAddress,
      sepoliaUsdc: env.deskUsdcAddress,
    });
    executorBackend = "operator";
  }

  let repo: CctpRebalanceRepository;
  if (options.repo) {
    repo = options.repo;
  } else {
    try {
      const supabase =
        options.supabase ??
        createServerSupabaseClient({
          supabaseUrl: env.supabaseUrl,
          supabaseServiceRoleKey: env.supabaseServiceRoleKey,
        });
      repo = createCctpRebalanceRepository(supabase);
    } catch (error) {
      return {
        service: null,
        reason: `Supabase client for CCTP repo failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  const iris = createIrisClient({
    baseUrl: env.cctpIrisBaseUrl,
    pollIntervalMs: env.cctpPollIntervalMs,
    pollTimeoutMs: env.cctpPollTimeoutMs,
  });

  const config = cctpServiceConfigFromEnv(env);
  const service = createCctpRebalanceService({
    config,
    repo,
    iris,
    executor,
    // Scheduler/worker resumes asynchronously; do not block ticks on Iris.
    awaitAttestationInTick: false,
    ...(options.activityLogger != null
      ? { activityLogger: options.activityLogger }
      : {}),
    ...(options.getDeskStarved != null
      ? { getDeskStarved: options.getDeskStarved }
      : {}),
  });

  return { service, repo, iris, executor, executorBackend };
}
