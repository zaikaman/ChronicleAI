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

  if (txClass === "desk" || txClass === "transfer") {
    return {
      enabled: env.deskUsePrivateMempool,
      strict: env.deskPrivateMempoolStrict,
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

/** Convenience: treasury transfer (KH path). */
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
  };
}

/** Human label for Activity badges (icon + text; not color-only). */
export function routingBadgeLabel(details: RoutingDetails | null | undefined): string {
  if (!details) return "Public";
  if (details.routing === "public" || details.routingRequested === "public") {
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
