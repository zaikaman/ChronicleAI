/**
 * Chronicle private-routing metadata for execution_logs, desk tickets, and Activity.
 *
 * Derived from Chronicle policy + known workflow config (we control the JSON),
 * not from scraping Flashbots. Phase 2 stores `routingRequested` +
 * `routingApplied: "unknown"` until KeeperHub can confirm applied routing.
 *
 * Product copy: "private submission path" / "Private route" — not "MEV-proof."
 */

/** Ethereum Sepolia — sole desk / registry ops chain for private routing. */
export const PRIVATE_ROUTING_CHAIN_ID = 11_155_111 as const;

/** Flashbots Protect transaction status (Sepolia). */
export const FLASHBOTS_PROTECT_SEPOLIA_STATUS_BASE =
  "https://protect-sepolia.flashbots.net/tx" as const;

/** Flashbots Protect transaction status (mainnet — not desk scope, helper only). */
export const FLASHBOTS_PROTECT_MAINNET_STATUS_BASE =
  "https://protect.flashbots.net/tx" as const;

/**
 * Honest product one-liner for desk feed / OpenAPI / agent discovery.
 * Private submission path on Sepolia — not mainnet sandwich claims.
 */
export const PRIVATE_ROUTING_PRODUCT_DESCRIPTION =
  "Executions use KeeperHub private mempool submission (Flashbots Protect on Sepolia)." as const;

export type RoutingMode = "private_mempool" | "public";

/**
 * Whether private routing was applied on-chain.
 * Phase 2 starts with `unknown` when we only know Chronicle requested it.
 */
export type RoutingApplied =
  | "unknown"
  | "private_mempool"
  | "public_fallback"
  | "public";

export type RoutingProviderLabel = "flashbots_protect" | string;

/**
 * Control-plane routing decision (Phase 4).
 * `private_mempool` always carries `strict: true` (fail closed on private RPC).
 * `public_sponsored` covers public KH + optional gas sponsorship / Para.
 */
export type ExecutionRouting =
  | { mode: "private_mempool"; strict: true }
  | { mode: "public_sponsored" };

/** Desk strategy keys used by the control-plane resolver. */
export type ExecutionRoutingStrategy =
  | "oracle_amm"
  | "yield_rotation"
  | "risk_defend"
  | "kill";

/**
 * What the control plane is about to submit.
 * Kill is separate from desk strategies so policy cannot disable residual protection.
 */
export type ExecutionRoutingSubject =
  | { kind: "kill_switch" }
  | {
      kind: "desk";
      strategy: Exclude<ExecutionRoutingStrategy, "kill">;
      /** Optional notional for future size-based desk rules; ignored for v1 defaults. */
      notionalUsdc?: number;
    }
  | { kind: "registry" }
  | {
      kind: "treasury_transfer";
      amountUsdc: number;
    };

export interface ResolveExecutionRoutingInput {
  subject: ExecutionRoutingSubject;
  env: RoutingPolicyEnv & {
    /** TREASURY_PRIVATE_TRANSFER_THRESHOLD_USDC (default 50). */
    treasuryPrivateTransferThresholdUsdc?: number;
    /** True when KH transfer workflow is configured (required for large private path). */
    keeperHubTransferConfigured?: boolean;
  };
}

export interface PrivateRoutingPolicy {
  /** Prefer private mempool for this transaction class. */
  enabled: boolean;
  /** Workflow strict mode expectation (no public fallback on private RPC failure). */
  strict: boolean;
  /** UI / log provider label (not a network endpoint). */
  provider: RoutingProviderLabel;
  /** Chain id (default Sepolia). */
  chainId: number;
}

export type GasSponsorshipApplied =
  | "unknown"
  | "sponsored"
  | "wallet_paid"
  | "not_applicable";

/** Shape written into execution_logs.details and ticket/intent JSON. */
export interface RoutingDetails {
  routing: RoutingMode;
  routingStrict: boolean;
  routingProvider: RoutingProviderLabel;
  chainId: number;
  /** What Chronicle requested via workflow flag + policy. */
  routingRequested: RoutingMode;
  /**
   * What we believe was applied. `unknown` until KH confirms or chain capability
   * is operator-verified at high confidence.
   */
  routingApplied: RoutingApplied;
  /** Whether gas sponsorship is preferred for public submission. */
  gasSponsorshipRequested?: boolean;
  /** On-chain / RPC status of gas sponsorship (Phase 2 honesty). */
  gasSponsorshipApplied?: GasSponsorshipApplied;
}

export interface RoutingPolicyEnv {
  deskUsePrivateMempool: boolean;
  deskPrivateMempoolStrict: boolean;
  registryUsePrivateMempool: boolean;
  routingProviderLabel: string;
  /** Optional override; defaults to Sepolia. */
  chainId?: number;
}

export type RoutingTransactionClass =
  | "desk"
  | "registry"
  | "transfer"
  | "kill_switch";

/**
 * Treasury spend path after policy selection.
 * - `para` — Para MPC public broadcast (fallback only)
 * - `keeperhub` — KeeperHub transfer workflow on the public mempool
 */
export type TreasuryTransferPath =
  | "para"
  | "keeperhub";

export interface SelectTreasuryTransferPathInput {
  amountUsdc: number;
  /** Legacy compatibility input; no longer affects routing. */
  thresholdUsdc: number;
  /** True when KEEPERHUB_WORKFLOW_TRANSFER (+ USDC address) is set. */
  keeperHubTransferConfigured: boolean;
  /** True when Para MPC treasury client can send USDC. */
  paraAvailable: boolean;
}

/**
 * Path selection for treasury `sendTransfer` (revenue, affiliate, capital top-up).
 *
 * Policy: use the configured KeeperHub transfer workflow on the public mempool.
 *   Para is never a direct demo-visible execution path.
 *   else throw
 */
export function selectTreasuryTransferPath(
  input: SelectTreasuryTransferPathInput,
): TreasuryTransferPath {
  void input.amountUsdc;
  void input.thresholdUsdc;
  if (input.keeperHubTransferConfigured) {
    return "keeperhub";
  }
  if (input.paraAvailable) {
    throw new Error(
      "KeeperHub transfer workflow is required for demo-visible treasury transfers; Para cannot broadcast directly",
    );
  }
  throw new Error(
    "No treasury transfer path configured — set PARA_API_KEY and/or KEEPERHUB_WORKFLOW_TRANSFER",
  );
}

/** Whether selected path routes the spend through KeeperHub (not Para alone). */
export function isKeeperHubTransferPath(path: TreasuryTransferPath): boolean {
  return path === "keeperhub";
}

const PRIVATE_STRICT: ExecutionRouting = {
  mode: "private_mempool",
  strict: true,
};

const PUBLIC_SPONSORED: ExecutionRouting = { mode: "public_sponsored" };

/**
 * Control-plane routing enum resolver (Phase 4).
 *
 * Defaults:
 * 1. Kill switch → private strict always
 * 2. Desk write (oracle_amm / yield_rotation / risk_defend) → private strict if DESK_USE_PRIVATE_MEMPOOL
 * 3. Registry → per REGISTRY_USE_PRIVATE_MEMPOOL
 * 4. Treasury transfers → public_sponsored (KeeperHub workflow)
 */
export function resolveExecutionRouting(
  input: ResolveExecutionRoutingInput,
): ExecutionRouting {
  const { subject, env } = input;

  if (subject.kind === "kill_switch") {
    return PRIVATE_STRICT;
  }

  if (subject.kind === "desk") {
    // Strategy notional is informational today; all desk writes share the desk flag.
    void subject.strategy;
    void subject.notionalUsdc;
    return env.deskUsePrivateMempool ? PRIVATE_STRICT : PUBLIC_SPONSORED;
  }

  if (subject.kind === "registry") {
    return env.registryUsePrivateMempool ? PRIVATE_STRICT : PUBLIC_SPONSORED;
  }

  // Treasury/revenue transfers use the public KeeperHub workflow path.
  void subject.amountUsdc;
  void env.treasuryPrivateTransferThresholdUsdc;
  void env.keeperHubTransferConfigured;
  return PUBLIC_SPONSORED;
}

/** Map control-plane enum → workflow-facing private routing policy. */
export function executionRoutingToPolicy(
  routing: ExecutionRouting,
  env: Pick<RoutingPolicyEnv, "routingProviderLabel" | "chainId">,
): PrivateRoutingPolicy {
  const chainId = env.chainId ?? PRIVATE_ROUTING_CHAIN_ID;
  const provider = (env.routingProviderLabel || "flashbots_protect").trim();
  if (routing.mode === "private_mempool") {
    return {
      enabled: true,
      strict: true,
      provider,
      chainId,
    };
  }
  return {
    enabled: false,
    strict: false,
    provider,
    chainId,
  };
}

/** Map control-plane enum → log/ticket RoutingDetails. */
export function buildRoutingDetailsFromExecutionRouting(
  routing: ExecutionRouting,
  env: Pick<RoutingPolicyEnv, "routingProviderLabel" | "chainId">,
): RoutingDetails {
  return buildPrivateRoutingDetails(executionRoutingToPolicy(routing, env));
}

/**
 * Flashbots Protect status page for a tx hash (Sepolia desk rail).
 * Returns null when hash is invalid or chain is not supported by Protect status API.
 */
export function flashbotsProtectStatusUrl(
  txHash: string,
  chainId: number = PRIVATE_ROUTING_CHAIN_ID,
): string | null {
  const hash = txHash?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  if (chainId === PRIVATE_ROUTING_CHAIN_ID) {
    return `${FLASHBOTS_PROTECT_SEPOLIA_STATUS_BASE}/${hash}`;
  }
  if (chainId === 1) {
    return `${FLASHBOTS_PROTECT_MAINNET_STATUS_BASE}/${hash}`;
  }
  return null;
}

/**
 * Whether Activity / tickets should surface a Protect status link for this routing.
 * Only when private route was requested (or confirmed applied).
 */
export function shouldLinkProtectStatus(
  details: RoutingDetails | null | undefined,
): boolean {
  if (!details) return false;
  return (
    details.routing === "private_mempool" ||
    details.routingRequested === "private_mempool" ||
    details.routingApplied === "private_mempool"
  );
}

/**
 * Build structured routing fields for execution_logs.details / ticket policy.
 * When policy.enabled is false → public; otherwise private_mempool (requested).
 */
export function buildPrivateRoutingDetails(
  policy: PrivateRoutingPolicy,
): RoutingDetails {
  const chainId =
    Number.isFinite(policy.chainId) && policy.chainId > 0
      ? Math.floor(policy.chainId)
      : PRIVATE_ROUTING_CHAIN_ID;

  if (!policy.enabled) {
    return {
      routing: "public",
      routingStrict: false,
      routingProvider: policy.provider || "flashbots_protect",
      chainId,
      routingRequested: "public",
      routingApplied: "public",
      gasSponsorshipRequested: true,
      gasSponsorshipApplied: "unknown",
    };
  }

  return {
    routing: "private_mempool",
    routingStrict: policy.strict !== false,
    routingProvider: policy.provider || "flashbots_protect",
    chainId,
    routingRequested: "private_mempool",
    // Phase 2: request-only proof until KH capability verification is solid.
    routingApplied: "unknown",
    gasSponsorshipRequested: false,
    gasSponsorshipApplied: "not_applicable",
  };
}

/** Resolve policy for a transaction class from ServerEnv-shaped config. */
export function routingPolicyForClass(
  env: RoutingPolicyEnv,
  txClass: RoutingTransactionClass,
): PrivateRoutingPolicy {
  const chainId = env.chainId ?? PRIVATE_ROUTING_CHAIN_ID;
  const provider = (env.routingProviderLabel || "flashbots_protect").trim();

  // Kill-switch residual always private + strict (workflow JSON; policy cannot disable).
  if (txClass === "kill_switch") {
    return {
      enabled: true,
      strict: true,
      provider,
      chainId,
    };
  }

  if (txClass === "desk") {
    return {
      enabled: env.deskUsePrivateMempool,
      strict: env.deskPrivateMempoolStrict,
      provider,
      chainId,
    };
  }

  if (txClass === "transfer") {
    return {
      enabled: false,
      strict: false,
      provider,
      chainId,
    };
  }

  // registry
  return {
    enabled: env.registryUsePrivateMempool,
    strict: env.deskPrivateMempoolStrict,
    provider,
    chainId,
  };
}

/** Convenience: desk policy details for logs / tickets. */
export function buildDeskRoutingDetails(env: RoutingPolicyEnv): RoutingDetails {
  return buildPrivateRoutingDetails(routingPolicyForClass(env, "desk"));
}

/** Convenience: registry write details. */
export function buildRegistryRoutingDetails(
  env: RoutingPolicyEnv,
): RoutingDetails {
  return buildPrivateRoutingDetails(routingPolicyForClass(env, "registry"));
}

/** Convenience: treasury transfer (public KH path). */
export function buildTransferRoutingDetails(
  env: RoutingPolicyEnv,
): RoutingDetails {
  return buildPrivateRoutingDetails(routingPolicyForClass(env, "transfer"));
}

/** Kill-switch always private + strict. */
export function buildKillSwitchRoutingDetails(
  env: Pick<RoutingPolicyEnv, "routingProviderLabel" | "chainId">,
): RoutingDetails {
  return buildPrivateRoutingDetails(
    routingPolicyForClass(
      {
        deskUsePrivateMempool: true,
        deskPrivateMempoolStrict: true,
        registryUsePrivateMempool: true,
        routingProviderLabel: env.routingProviderLabel,
        chainId: env.chainId,
      },
      "kill_switch",
    ),
  );
}

/**
 * Parse routing fields from execution_logs.details or ticket payload.
 * Accepts both plan shape (`routing`) and nested objects.
 */
export function extractRoutingFromDetails(
  details: Record<string, unknown> | null | undefined,
): RoutingDetails | null {
  if (!details || typeof details !== "object") return null;

  const routingRaw = details.routing ?? details.routingRequested;
  if (typeof routingRaw !== "string") return null;
  if (routingRaw !== "private_mempool" && routingRaw !== "public") return null;

  const routing = routingRaw as RoutingMode;
  const routingRequested =
    details.routingRequested === "private_mempool" ||
    details.routingRequested === "public"
      ? (details.routingRequested as RoutingMode)
      : routing;

  const appliedRaw = details.routingApplied;
  const routingApplied: RoutingApplied =
    appliedRaw === "private_mempool" ||
    appliedRaw === "public_fallback" ||
    appliedRaw === "public" ||
    appliedRaw === "unknown"
      ? appliedRaw
      : routing === "private_mempool"
        ? "unknown"
        : "public";

  const chainId =
    typeof details.chainId === "number" && Number.isFinite(details.chainId)
      ? details.chainId
      : PRIVATE_ROUTING_CHAIN_ID;

  const gasSponsorshipRequested =
    typeof details.gasSponsorshipRequested === "boolean"
      ? details.gasSponsorshipRequested
      : routing === "public";

  const sponsorAppliedRaw = details.gasSponsorshipApplied;
  const gasSponsorshipApplied: GasSponsorshipApplied =
    sponsorAppliedRaw === "sponsored" ||
    sponsorAppliedRaw === "wallet_paid" ||
    sponsorAppliedRaw === "not_applicable" ||
    sponsorAppliedRaw === "unknown"
      ? sponsorAppliedRaw
      : routing === "private_mempool"
        ? "not_applicable"
        : "unknown";

  return {
    routing,
    routingStrict: details.routingStrict === true,
    routingProvider:
      typeof details.routingProvider === "string" && details.routingProvider
        ? details.routingProvider
        : "flashbots_protect",
    chainId,
    routingRequested,
    routingApplied,
    gasSponsorshipRequested,
    gasSponsorshipApplied,
  };
}

/** Human label for Activity badges (icon + text; not color-only). */
export function routingBadgeLabel(details: RoutingDetails | null | undefined): string {
  if (!details) return "Public";
  if (details.routing === "public" || details.routingRequested === "public") {
    if (details.gasSponsorshipApplied === "sponsored") {
      return "Public (Sponsored)";
    }
    if (
      details.gasSponsorshipRequested !== false &&
      (details.gasSponsorshipApplied === "unknown" || !details.gasSponsorshipApplied)
    ) {
      return "Public (Sponsorship requested)";
    }
    return "Public";
  }
  if (
    details.routingApplied === "private_mempool" ||
    details.routingApplied === "public"
  ) {
    return details.routingApplied === "private_mempool"
      ? "Private route"
      : "Public";
  }
  // Requested but not confirmed applied
  return "Private route (requested)";
}

/** Calm product copy for trade tickets / desk status. */
export function routingExecutionPathCopy(
  details: RoutingDetails | null | undefined,
): string | null {
  if (!details || details.routing === "public") {
    return null;
  }
  const provider =
    details.routingProvider === "flashbots_protect"
      ? "Flashbots Protect"
      : details.routingProvider;
  const confirmed = details.routingApplied === "private_mempool";
  if (confirmed) {
    return `Execution path: KeeperHub private mempool (${provider} · Sepolia)`;
  }
  return `Execution path: KeeperHub private mempool requested (${provider} · Sepolia)`;
}

/** Compact field for digest / LLM context. */
export function executionRoutingForDigest(
  details: RoutingDetails | null | undefined,
): "private_mempool" | "public" | undefined {
  if (!details) return undefined;
  return details.routing;
}

/** Public desk status slice for policy panel. */
export function publicPrivateRoutingStatus(env: RoutingPolicyEnv): {
  enabled: boolean;
  strict: boolean;
  provider: string;
  chainId: number;
  label: string;
} {
  const details = buildDeskRoutingDetails(env);
  return {
    enabled: details.routing === "private_mempool",
    strict: details.routingStrict,
    provider: details.routingProvider,
    chainId: details.chainId,
    label:
      details.routing === "private_mempool"
        ? "Private routing: ON"
        : "Private routing: OFF",
  };
}
