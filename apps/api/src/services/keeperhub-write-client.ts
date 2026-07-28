// KeeperHub write client: sole production path for material on-chain writes.
// Uses Direct Execution API (contract-call / transfer) and/or workflow trigger
// (API key), then polls run status for keeperHubRunId, txHash, and explorer URL.

import { ethers } from "ethers";

export interface KeeperHubWriteReceipt {
  keeperHubRunId: string;
  txHash: string;
  explorerUrl: string;
  /** Decoded return value when available (e.g. createSponsoredWatch watchId). */
  result?: unknown;
}

export interface KeeperHubWorkflowIds {
  publishAlert?: string;
  publishDigest?: string;
  createSponsoredWatch?: string;
  publishSponsoredReport?: string;
  recordPayout?: string;
  transfer?: string;
}

export interface KeeperHubWriteClientConfig {
  apiBaseUrl: string;
  apiKey: string;
  network: string;
  registryAddress: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  workflowIds?: KeeperHubWorkflowIds;
}

export interface KeeperHubWriteClient {
  publishAlert(alertHash: string, ipfsUri: string): Promise<KeeperHubWriteReceipt>;
  publishDigest(
    digestHash: string,
    sourceEventRoot: string,
    ipfsUri: string,
  ): Promise<KeeperHubWriteReceipt>;
  createSponsoredWatch(
    targetContract: string,
    watchSpecHash: string,
    startsAt: number,
    endsAt: number,
  ): Promise<KeeperHubWriteReceipt & { watchId: number }>;
  publishSponsoredReport(
    watchId: number,
    reportContentHash: string,
    sourceEventRoot: string,
    reportUri: string,
  ): Promise<KeeperHubWriteReceipt>;
  recordPayout(
    payoutPeriodHash: string,
    recipient: string,
    amount: number,
    reasonHash: string,
  ): Promise<KeeperHubWriteReceipt>;
  sendTransfer(to: string, amountEth: number): Promise<KeeperHubWriteReceipt>;
}

const REGISTRY_ABI = [
  "function publishAlert(bytes32 alertHash, string calldata ipfsUri) external",
  "function publishDigest(bytes32 digestHash, bytes32 sourceEventRoot, string calldata ipfsUri) external",
  "function createSponsoredWatch(address targetContract, bytes32 watchSpecHash, uint256 startsAt, uint256 endsAt) external returns (uint256 watchId)",
  "function publishSponsoredReport(uint256 watchId, bytes32 reportContentHash, bytes32 sourceEventRoot, string calldata reportUri) external",
  "function recordPayout(bytes32 payoutPeriodHash, address recipient, uint256 amount, bytes32 reasonHash) external",
] as const;

function hashString(input: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(input));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ExecuteStartResponse {
  executionId?: string;
  status?: string;
  error?: string;
  message?: string;
}

interface ExecuteStatusResponse {
  executionId?: string;
  status?: string;
  transactionHash?: string;
  transactionLink?: string;
  transactionHashes?: Array<{ hash?: string; transactionLink?: string }>;
  result?: unknown;
  error?: string | null;
  completed?: boolean;
  output?: unknown;
}

function extractTx(status: ExecuteStatusResponse): { txHash?: string; explorerUrl?: string } {
  if (typeof status.transactionHash === "string" && status.transactionHash.length > 0) {
    return {
      txHash: status.transactionHash,
      explorerUrl:
        typeof status.transactionLink === "string" && status.transactionLink.length > 0
          ? status.transactionLink
          : undefined,
    };
  }

  const first = status.transactionHashes?.[0];
  if (first && typeof first.hash === "string" && first.hash.length > 0) {
    return {
      txHash: first.hash,
      explorerUrl:
        typeof first.transactionLink === "string" && first.transactionLink.length > 0
          ? first.transactionLink
          : undefined,
    };
  }

  return {};
}

function parseWatchId(result: unknown): number | undefined {
  if (typeof result === "number" && Number.isFinite(result)) {
    return result;
  }
  if (typeof result === "string" && /^\d+$/.test(result)) {
    return Number(result);
  }
  if (typeof result === "bigint") {
    return Number(result);
  }
  if (Array.isArray(result) && result.length > 0) {
    return parseWatchId(result[0]);
  }
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if ("watchId" in record) {
      return parseWatchId(record.watchId);
    }
    if ("result" in record) {
      return parseWatchId(record.result);
    }
  }
  return undefined;
}

export function createKeeperHubWriteClient(
  config: KeeperHubWriteClientConfig,
): KeeperHubWriteClient {
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, "");
  const pollIntervalMs = config.pollIntervalMs ?? 2_000;
  const pollTimeoutMs = config.pollTimeoutMs ?? 120_000;
  const workflowIds = config.workflowIds ?? {};

  async function authorizedFetch(
    path: string,
    init: RequestInit & { idempotencyKey?: string } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${config.apiKey}`);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    if (init.idempotencyKey) {
      headers.set("Idempotency-Key", init.idempotencyKey);
    }

    const { idempotencyKey: _key, ...rest } = init;
    return fetch(`${baseUrl}${path}`, {
      ...rest,
      headers,
    });
  }

  async function pollUntilComplete(executionId: string): Promise<KeeperHubWriteReceipt> {
    const started = Date.now();
    let lastError: string | undefined;

    while (Date.now() - started < pollTimeoutMs) {
      // Prefer workflow wait endpoint when execution id looks like a workflow run;
      // always fall back to direct-execution status.
      const waitRes = await authorizedFetch(
        `/api/workflows/executions/${encodeURIComponent(executionId)}/wait?timeoutMs=25000`,
        { method: "GET" },
      );

      if (waitRes.ok) {
        const body = (await waitRes.json()) as ExecuteStatusResponse;
        if (body.completed === true || body.status === "success" || body.status === "completed") {
          const { txHash, explorerUrl } = extractTx(body);
          if (!txHash) {
            throw new Error(
              `KeeperHub execution ${executionId} completed without a transaction hash`,
            );
          }
          return {
            keeperHubRunId: executionId,
            txHash,
            explorerUrl: explorerUrl ?? buildFallbackExplorerUrl(txHash, config.network),
            result: body.result ?? body.output,
          };
        }
        if (body.status === "error" || body.status === "failed" || body.status === "cancelled") {
          throw new Error(
            body.error ?? `KeeperHub execution ${executionId} ended with status ${body.status}`,
          );
        }
      }

      const statusRes = await authorizedFetch(
        `/api/execute/${encodeURIComponent(executionId)}/status`,
        { method: "GET" },
      );

      if (statusRes.ok) {
        const body = (await statusRes.json()) as ExecuteStatusResponse;
        const status = body.status ?? "";
        if (status === "completed" || status === "success") {
          const { txHash, explorerUrl } = extractTx(body);
          if (!txHash) {
            throw new Error(
              `KeeperHub execution ${executionId} completed without a transaction hash`,
            );
          }
          return {
            keeperHubRunId: executionId,
            txHash,
            explorerUrl: explorerUrl ?? buildFallbackExplorerUrl(txHash, config.network),
            result: body.result,
          };
        }
        if (status === "failed" || status === "error" || status === "cancelled") {
          throw new Error(
            body.error ?? `KeeperHub execution ${executionId} ended with status ${status}`,
          );
        }

        const hintHeader = statusRes.headers.get("X-Poll-Interval-Hint");
        const hintSeconds = hintHeader ? Number(hintHeader) : Number.NaN;
        if (Number.isFinite(hintSeconds) && hintSeconds > 0) {
          await sleep(hintSeconds * 1000);
          continue;
        }
      } else {
        lastError = `status poll HTTP ${statusRes.status}`;
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(
      `Timed out waiting for KeeperHub execution ${executionId}${lastError ? ` (${lastError})` : ""}`,
    );
  }

  async function startWorkflow(
    workflowId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<string> {
    const res = await authorizedFetch(`/api/workflows/${encodeURIComponent(workflowId)}/execute`, {
      method: "POST",
      body: JSON.stringify({ input }),
      idempotencyKey,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`KeeperHub workflow execute failed (${res.status}): ${text.slice(0, 400)}`);
    }

    const body = (await res.json()) as ExecuteStartResponse;
    if (!body.executionId) {
      throw new Error("KeeperHub workflow execute response missing executionId");
    }
    return body.executionId;
  }

  async function startDirectContractCall(
    functionName: string,
    functionArgs: unknown[],
    idempotencyKey: string,
  ): Promise<string> {
    const res = await authorizedFetch("/api/execute/contract-call", {
      method: "POST",
      body: JSON.stringify({
        contractAddress: config.registryAddress,
        network: config.network,
        functionName,
        functionArgs: JSON.stringify(functionArgs),
        abi: JSON.stringify(REGISTRY_ABI),
      }),
      idempotencyKey,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`KeeperHub contract-call failed (${res.status}): ${text.slice(0, 400)}`);
    }

    const body = (await res.json()) as ExecuteStartResponse;
    if (!body.executionId) {
      // Some deployments return completed synchronously with a hash nested under result
      if (body.status === "completed" && typeof (body as { transactionHash?: string }).transactionHash === "string") {
        return `sync:${(body as { transactionHash: string }).transactionHash}`;
      }
      throw new Error("KeeperHub contract-call response missing executionId");
    }
    return body.executionId;
  }

  async function startDirectTransfer(
    to: string,
    amountEth: number,
    idempotencyKey: string,
  ): Promise<string> {
    const res = await authorizedFetch("/api/execute/transfer", {
      method: "POST",
      body: JSON.stringify({
        network: config.network,
        recipientAddress: to,
        amount: String(amountEth),
      }),
      idempotencyKey,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`KeeperHub transfer failed (${res.status}): ${text.slice(0, 400)}`);
    }

    const body = (await res.json()) as ExecuteStartResponse;
    if (!body.executionId) {
      throw new Error("KeeperHub transfer response missing executionId");
    }
    return body.executionId;
  }

  async function runContract(
    opts: {
      functionName: string;
      functionArgs: unknown[];
      workflowId?: string;
      workflowInput?: Record<string, unknown>;
      idempotencyKey: string;
    },
  ): Promise<KeeperHubWriteReceipt> {
    let executionId: string;

    if (opts.workflowId) {
      executionId = await startWorkflow(
        opts.workflowId,
        opts.workflowInput ?? {
          functionName: opts.functionName,
          functionArgs: opts.functionArgs,
          contractAddress: config.registryAddress,
          network: config.network,
        },
        opts.idempotencyKey,
      );
    } else {
      executionId = await startDirectContractCall(
        opts.functionName,
        opts.functionArgs,
        opts.idempotencyKey,
      );
    }

    if (executionId.startsWith("sync:")) {
      const txHash = executionId.slice("sync:".length);
      return {
        keeperHubRunId: executionId,
        txHash,
        explorerUrl: buildFallbackExplorerUrl(txHash, config.network),
      };
    }

    return pollUntilComplete(executionId);
  }

  return {
    async publishAlert(alertHash, ipfsUri) {
      const alertBytes = hashString(alertHash);
      return runContract({
        functionName: "publishAlert",
        functionArgs: [alertBytes, ipfsUri],
        workflowId: workflowIds.publishAlert,
        workflowInput: {
          alertHash: alertBytes,
          ipfsUri,
          contractAddress: config.registryAddress,
          network: config.network,
        },
        idempotencyKey: `chronicle-publishAlert-${alertHash}`,
      });
    },

    async publishDigest(digestHash, sourceEventRoot, ipfsUri) {
      const digestBytes = hashString(digestHash);
      const rootBytes = hashString(sourceEventRoot);
      return runContract({
        functionName: "publishDigest",
        functionArgs: [digestBytes, rootBytes, ipfsUri],
        workflowId: workflowIds.publishDigest,
        workflowInput: {
          digestHash: digestBytes,
          sourceEventRoot: rootBytes,
          ipfsUri,
          contractAddress: config.registryAddress,
          network: config.network,
        },
        idempotencyKey: `chronicle-publishDigest-${digestHash}`,
      });
    },

    async createSponsoredWatch(targetContract, watchSpecHash, startsAt, endsAt) {
      const specBytes = hashString(watchSpecHash);
      const receipt = await runContract({
        functionName: "createSponsoredWatch",
        functionArgs: [targetContract, specBytes, startsAt, endsAt],
        workflowId: workflowIds.createSponsoredWatch,
        workflowInput: {
          targetContract,
          watchSpecHash: specBytes,
          startsAt,
          endsAt,
          contractAddress: config.registryAddress,
          network: config.network,
        },
        idempotencyKey: `chronicle-createSponsoredWatch-${watchSpecHash}-${startsAt}-${endsAt}`,
      });

      const watchId = parseWatchId(receipt.result) ?? 0;
      return { ...receipt, watchId };
    },

    async publishSponsoredReport(watchId, reportContentHash, sourceEventRoot, reportUri) {
      const contentBytes = hashString(reportContentHash);
      const rootBytes = hashString(sourceEventRoot);
      return runContract({
        functionName: "publishSponsoredReport",
        functionArgs: [watchId, contentBytes, rootBytes, reportUri],
        workflowId: workflowIds.publishSponsoredReport,
        workflowInput: {
          watchId,
          reportContentHash: contentBytes,
          sourceEventRoot: rootBytes,
          reportUri,
          contractAddress: config.registryAddress,
          network: config.network,
        },
        idempotencyKey: `chronicle-publishSponsoredReport-${watchId}-${reportContentHash}-${sourceEventRoot}`,
      });
    },

    async recordPayout(payoutPeriodHash, recipient, amount, reasonHash) {
      const periodBytes = hashString(payoutPeriodHash);
      const reasonBytes = hashString(reasonHash);
      const amountWei = ethers.parseEther(String(amount)).toString();
      return runContract({
        functionName: "recordPayout",
        functionArgs: [periodBytes, recipient, amountWei, reasonBytes],
        workflowId: workflowIds.recordPayout,
        workflowInput: {
          payoutPeriodHash: periodBytes,
          recipient,
          amount: amountWei,
          reasonHash: reasonBytes,
          contractAddress: config.registryAddress,
          network: config.network,
        },
        idempotencyKey: `chronicle-recordPayout-${payoutPeriodHash}-${recipient}-${amount}`,
      });
    },

    async sendTransfer(to, amountEth) {
      let executionId: string;
      const idempotencyKey = `chronicle-transfer-${to}-${amountEth}-${Date.now()}`;

      if (workflowIds.transfer) {
        executionId = await startWorkflow(
          workflowIds.transfer,
          {
            recipientAddress: to,
            amount: String(amountEth),
            network: config.network,
          },
          idempotencyKey,
        );
      } else {
        executionId = await startDirectTransfer(to, amountEth, idempotencyKey);
      }

      return pollUntilComplete(executionId);
    },
  };
}

function buildFallbackExplorerUrl(txHash: string, network: string): string {
  const n = network.toLowerCase();
  if (n === "base-sepolia" || n === "84532") {
    return `https://sepolia.basescan.org/tx/${txHash}`;
  }
  if (n === "base" || n === "8453") {
    return `https://basescan.org/tx/${txHash}`;
  }
  if (n === "sepolia" || n === "11155111") {
    return `https://sepolia.etherscan.io/tx/${txHash}`;
  }
  if (n === "ethereum" || n === "mainnet" || n === "1") {
    return `https://etherscan.io/tx/${txHash}`;
  }
  return `https://sepolia.basescan.org/tx/${txHash}`;
}

export function isKeeperHubWriteConfigured(env: {
  keeperhubApiBaseUrl?: string;
  keeperhubApiKey?: string;
  chronicleRegistryAddress?: string;
}): boolean {
  return Boolean(
    env.keeperhubApiBaseUrl &&
      env.keeperhubApiKey &&
      env.chronicleRegistryAddress &&
      env.keeperhubApiKey.startsWith("kh_"),
  );
}
