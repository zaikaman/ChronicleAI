// Unified activity feed — merges every agent domain into one time-ordered stream.
// The activity page's promise is "see what happened and verify it"; this hook makes
// that answerable in a single scroll instead of five tabbed panels.

import {
  ArrowDownUp,
  ArrowLeftRight,
  Bell,
  CreditCard,
  Eye,
  FileText,
  Landmark,
  type LucideIcon,
  Wallet,
} from "lucide-react";
import type { ReactElement } from "react";
import { useMemo } from "react";
import { baseSepoliaTxUrl, sepoliaTxUrl, truncateHash } from "../../lib/explorer.ts";
import {
  capitalDirectionLabel,
  capitalDirectionVariant,
  formatUsdc,
  humanizeCapitalMoveReason,
  ticketHeadline,
  ticketOutcomeLabel,
  ticketOutcomeVariant,
} from "../desk/format.ts";
import type { DeskCapitalMove, DeskTicketNarrative } from "../desk/types.ts";
import { useDeskCapitalMoves, useDeskTickets } from "../desk/use-desk.ts";
import { type AgentActivityData, useAgentActivity } from "./use-agent-activity.ts";

export type FeedCategory = "publications" | "desk" | "money";

/** Tabs for the unified feed. "system" is the dense execution log. */
export type ActivityFilterId = "all" | FeedCategory | "system";

export interface FeedProof {
  label: string;
  hash: string;
  href?: string;
}

export interface FeedItem {
  id: string;
  /** Stable identity for dedupe + React keys. */
  key: string;
  category: FeedCategory;
  kind:
    | "alert"
    | "digest"
    | "desk_ticket"
    | "capital_move"
    | "payment"
    | "payout"
    | "transfer"
    | "watch";
  kindLabel: string;
  title: string;
  detail?: string;
  timestamp: string;
  status?: {
    label: string;
    variant: "default" | "success" | "warning" | "error" | "info";
  };
  href?: string;
  proofs?: FeedProof[];
}

export interface ActivityFeedState {
  items: FeedItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Headline counts for the status strip. */
  stats: {
    alerts: number;
    digests: number;
    anchoredDigests: number;
    settledPayments: number;
    payouts: number;
    deskTrades: number;
  };
  treasury: AgentActivityData["treasury"] | null;
}

// ── Per-kind status mapping ──────────────────────────────

function statusVariant(status: string): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "succeeded":
    case "published":
    case "settled":
    case "minted":
    case "transferred":
    case "completed":
    case "filled":
      return "success";
    case "failed":
    case "expired":
      return "error";
    case "partial_failure":
    case "retrying":
    case "skipped":
    case "underpaid":
    case "pending":
    case "stuck":
    case "timeout":
      return "warning";
    default:
      return "info";
  }
}

// ── Payment proof resolution (x402 / MPP) ────────────────

function paymentProof(payment: {
  explorerUrl?: string;
  registryTxHash?: string;
  settlementReference?: string;
}): FeedProof | null {
  if (payment.explorerUrl && (payment.registryTxHash || payment.settlementReference)) {
    const raw = payment.registryTxHash ?? payment.settlementReference ?? "";
    const cleanHash = raw.includes(":") ? (raw.split(":").pop() ?? raw) : raw;
    const formatted = cleanHash.startsWith("0x") ? cleanHash : `0x${cleanHash}`;
    return { label: "settlement", hash: formatted, href: payment.explorerUrl };
  }
  if (payment.registryTxHash) {
    const hash = payment.registryTxHash.startsWith("0x")
      ? payment.registryTxHash
      : `0x${payment.registryTxHash}`;
    return { label: "registry", hash, href: sepoliaTxUrl(hash) };
  }
  if (payment.settlementReference) {
    let raw = payment.settlementReference.trim();
    if (raw.includes(":")) raw = raw.split(":").pop() ?? raw;
    const hash = raw.startsWith("0x") ? raw : `0x${raw}`;
    return { label: "settlement", hash, href: baseSepoliaTxUrl(hash) || undefined };
  }
  return null;
}

function humanizePaymentStatus(status: string): {
  label: string;
  variant: "success" | "warning" | "error";
} {
  switch (status) {
    case "settled":
      return { label: "Settled", variant: "success" };
    case "failed":
      return { label: "Not completed", variant: "error" };
    case "underpaid":
      return { label: "Underpaid", variant: "warning" };
    case "expired":
      return { label: "Expired", variant: "error" };
    case "pending":
      return { label: "Pending", variant: "warning" };
    case "challenge_issued":
      return { label: "Awaiting payment", variant: "warning" };
    default:
      return { label: status.replaceAll("_", " "), variant: "warning" };
  }
}

// ── Builders: each agent domain → feed items ─────────────

function fromAlerts(data: AgentActivityData): FeedItem[] {
  return data.alerts.map((alert) => {
    const proofs: FeedProof[] = [];
    if (alert.registryTxHash) {
      proofs.push({
        label: "publication",
        hash: alert.registryTxHash,
        href: alert.explorerUrl ?? sepoliaTxUrl(alert.registryTxHash),
      });
    }
    if (alert.keeperHubRunId) {
      proofs.push({ label: "keeperhub run", hash: alert.keeperHubRunId });
    }
    return {
      id: alert.id,
      key: `alert:${alert.id}`,
      category: "publications",
      kind: "alert",
      kindLabel: "Alert",
      title: alert.title,
      detail: alert.summary,
      timestamp: alert.publishedAt,
      status: { label: alert.deliveryStatus, variant: statusVariant(alert.deliveryStatus) },
      href: `/alerts/${alert.id}`,
      proofs: proofs.length > 0 ? proofs : undefined,
    };
  });
}

function fromDigests(data: AgentActivityData): FeedItem[] {
  return data.digests.map((digest) => {
    const proofs: FeedProof[] = [];
    if (digest.registryTxHash) {
      proofs.push({
        label: "publication",
        hash: digest.registryTxHash,
        href: digest.explorerUrl ?? sepoliaTxUrl(digest.registryTxHash),
      });
    }
    if (digest.keeperHubRunId) {
      proofs.push({ label: "keeperhub run", hash: digest.keeperHubRunId });
    }
    return {
      id: digest.id,
      key: `digest:${digest.id}`,
      category: "publications",
      kind: "digest",
      kindLabel: "Digest",
      title: digest.title,
      detail: digest.summary,
      timestamp: digest.publishedAt ?? digest.reportDate,
      status: { label: digest.publicationStatus, variant: statusVariant(digest.publicationStatus) },
      href: `/digests/${digest.id}`,
      proofs: proofs.length > 0 ? proofs : undefined,
    };
  });
}

function fromTickets(tickets: DeskTicketNarrative[]): FeedItem[] {
  return tickets.map((ticket) => {
    const proofs: FeedProof[] = [];
    if (ticket.txHash) {
      proofs.push({
        label: "ticket",
        hash: ticket.txHash,
        href: ticket.explorerUrl ?? sepoliaTxUrl(ticket.txHash),
      });
    }
    if (ticket.keeperHubRunId) {
      proofs.push({ label: "keeperhub run", hash: ticket.keeperHubRunId });
    }
    return {
      id: ticket.id,
      key: `ticket:${ticket.id}`,
      category: "desk",
      kind: "desk_ticket",
      kindLabel: "Desk trade",
      title: ticketHeadline(ticket),
      detail: ticket.executionAuditSummary ?? ticket.summary ?? undefined,
      timestamp: ticket.createdAt,
      status: { label: ticketOutcomeLabel(ticket), variant: ticketOutcomeVariant(ticket) },
      href: `/desk/tickets/${ticket.id}`,
      proofs: proofs.length > 0 ? proofs : undefined,
    };
  });
}

function fromCapitalMoves(moves: DeskCapitalMove[]): FeedItem[] {
  return moves.map((move) => {
    const proofs: FeedProof[] = [];
    if (move.txHash) {
      proofs.push({
        label: "transfer",
        hash: move.txHash,
        href: move.explorerUrl ?? sepoliaTxUrl(move.txHash),
      });
    }
    if (move.registryTxHash) {
      proofs.push({
        label: "audit",
        hash: move.registryTxHash,
        href: move.registryExplorerUrl ?? sepoliaTxUrl(move.registryTxHash),
      });
    }
    return {
      id: move.id,
      key: `move:${move.id}`,
      category: "desk",
      kind: "capital_move",
      kindLabel: "Capital move",
      title: `${capitalDirectionLabel(move.direction)} · ${formatUsdc(move.amountUsdc)}`,
      detail: humanizeCapitalMoveReason(move.reason, move.direction),
      timestamp: move.createdAt,
      status: {
        label: capitalDirectionLabel(move.direction),
        variant: capitalDirectionVariant(move.direction),
      },
      proofs: proofs.length > 0 ? proofs : undefined,
    };
  });
}

function fromPayments(data: AgentActivityData): FeedItem[] {
  return data.payments.map((payment) => {
    const amount =
      typeof payment.amountSettled === "number" ? payment.amountSettled : payment.amountRequested;
    const currency = payment.currency ?? "USDC";
    const human = humanizePaymentStatus(payment.status);
    const proof = paymentProof(payment);
    const detailParts: string[] = [];
    if (payment.premiumItemId) {
      detailParts.push(`item ${payment.premiumItemId.slice(0, 12)}…`);
    }
    if (payment.referralAddress) {
      detailParts.push(`ref ${truncateHash(payment.referralAddress, 6, 4)}`);
    }
    if (payment.failureReason) {
      detailParts.push(payment.failureReason);
    }
    return {
      id: payment.id,
      key: `payment:${payment.id}`,
      category: "money",
      kind: "payment",
      kindLabel: "Payment",
      title:
        typeof amount === "number"
          ? `${payment.paymentRoute.toUpperCase()} · ${amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${currency}`
          : `${payment.paymentRoute.toUpperCase()} payment`,
      detail: detailParts.length > 0 ? detailParts.join(" · ") : undefined,
      timestamp: payment.settledAt ?? payment.requestedAt ?? "",
      status: { label: human.label, variant: human.variant },
      proofs: proof ? [proof] : undefined,
    };
  });
}

function fromPayouts(data: AgentActivityData): FeedItem[] {
  return (data.payouts ?? []).map((payout) => {
    const proofs: FeedProof[] = [];
    if (payout.payoutTxHash) {
      proofs.push({
        label: "transfer",
        hash: payout.payoutTxHash,
        href: payout.explorerUrl ?? sepoliaTxUrl(payout.payoutTxHash),
      });
    }
    if (payout.registryTxHash) {
      proofs.push({
        label: "registry",
        hash: payout.registryTxHash,
        href: payout.explorerUrl ?? sepoliaTxUrl(payout.registryTxHash),
      });
    }
    return {
      id: payout.id,
      key: `payout:${payout.id}`,
      category: "money",
      kind: "payout",
      kindLabel: "Payout",
      title: `Payout · ${payout.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`,
      detail: payout.recipient ? `to ${truncateHash(payout.recipient, 8, 6)}` : undefined,
      timestamp: payout.createdAt,
      status: { label: payout.status, variant: statusVariant(payout.status) },
      proofs: proofs.length > 0 ? proofs : undefined,
    };
  });
}

function fromTransfers(data: AgentActivityData): FeedItem[] {
  return (data.cctpRebalances ?? []).map((transfer) => {
    const proofs: FeedProof[] = [];
    if (transfer.burnTxHash) {
      proofs.push({
        label: "burn (Base)",
        hash: transfer.burnTxHash,
        href: transfer.burnExplorerUrl ?? undefined,
      });
    }
    if (transfer.mintTxHash) {
      proofs.push({
        label: "mint (Sepolia)",
        hash: transfer.mintTxHash,
        href: transfer.mintExplorerUrl ?? undefined,
      });
    }
    return {
      id: transfer.id,
      key: `transfer:${transfer.id}`,
      category: "money",
      kind: "transfer",
      kindLabel: "Revenue transfer",
      title: `${transfer.amountUsdc.toLocaleString("en-US", { maximumFractionDigits: 4 })} USDC`,
      detail: `Base Sepolia → Ethereum Sepolia · ${transfer.mode.replaceAll("_", " ")}`,
      timestamp: transfer.createdAt,
      status: {
        label: transfer.status.replaceAll("_", " "),
        variant: statusVariant(transfer.status),
      },
      proofs: proofs.length > 0 ? proofs : undefined,
    };
  });
}

function fromWatches(data: AgentActivityData): FeedItem[] {
  return (data.activeSponsoredWatches ?? []).map((watch) => {
    const proofs: FeedProof[] = [];
    const create = watch.auditTrail?.createTxHash ?? watch.createTxHash;
    if (create) {
      proofs.push({
        label: "create",
        hash: create,
        href: watch.auditTrail?.createExplorerUrl ?? watch.createExplorerUrl ?? undefined,
      });
    }
    const report = watch.auditTrail?.reportTxHash ?? watch.reportTxHash;
    if (report) {
      proofs.push({
        label: "report",
        hash: report,
        href: watch.auditTrail?.reportExplorerUrl ?? watch.reportExplorerUrl ?? undefined,
      });
    }
    return {
      id: watch.id,
      key: `watch:${watch.id}`,
      category: "money",
      kind: "watch",
      kindLabel: "Sponsored watch",
      title: watch.targetContract,
      detail: `monitoring window · ${watch.status}`,
      timestamp: watch.startsAt,
      status: { label: watch.status, variant: statusVariant(watch.status) },
      href: `/premium/watches/${watch.id}`,
      proofs: proofs.length > 0 ? proofs : undefined,
    };
  });
}

function mergeFeedItems(
  data: AgentActivityData,
  tickets: DeskTicketNarrative[],
  moves: DeskCapitalMove[],
): FeedItem[] {
  const all = [
    ...fromAlerts(data),
    ...fromDigests(data),
    ...fromTickets(tickets),
    ...fromCapitalMoves(moves),
    ...fromPayments(data),
    ...fromPayouts(data),
    ...fromTransfers(data),
    ...fromWatches(data),
  ];

  const seen = new Set<string>();
  const unique = all.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });

  return unique.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export function useActivityFeed(): ActivityFeedState {
  const aggregate = useAgentActivity();
  const tickets = useDeskTickets(12);
  const capitalMoves = useDeskCapitalMoves(12);

  const items = useMemo(() => {
    if (!aggregate.data) return [];
    return mergeFeedItems(aggregate.data, tickets.tickets, capitalMoves.capitalMoves);
  }, [aggregate.data, tickets.tickets, capitalMoves.capitalMoves]);

  const stats = useMemo(() => {
    const data = aggregate.data;
    if (!data) {
      return {
        alerts: 0,
        digests: 0,
        anchoredDigests: 0,
        settledPayments: 0,
        payouts: 0,
        deskTrades: tickets.pagination.total ?? 0,
      };
    }
    return {
      alerts: data.alerts.length,
      digests: data.digests.length,
      anchoredDigests: data.digests.filter((d) => Boolean(d.registryTxHash)).length,
      settledPayments: data.payments.filter((p) => p.status === "settled").length,
      payouts: data.payouts?.length ?? 0,
      deskTrades: tickets.pagination.total ?? 0,
    };
  }, [aggregate.data, tickets.pagination.total]);

  return {
    items,
    isLoading: aggregate.isLoading || (tickets.isLoading && tickets.tickets.length === 0),
    error: aggregate.error ?? tickets.error ?? capitalMoves.error,
    refetch: () => {
      aggregate.refetch();
      tickets.refetch();
      capitalMoves.refetch();
    },
    stats,
    treasury: aggregate.data?.treasury ?? null,
  };
}

// ── Kind icon (used by the feed rows) ────────────────────

export const FEED_KIND_ICONS: Record<FeedItem["kind"], LucideIcon> = {
  alert: Bell,
  digest: FileText,
  desk_ticket: Landmark,
  capital_move: ArrowLeftRight,
  payment: CreditCard,
  payout: Wallet,
  transfer: ArrowDownUp,
  watch: Eye,
};

export function FeedKindIcon({ kind }: { kind: FeedItem["kind"] }): ReactElement {
  const Icon = FEED_KIND_ICONS[kind];
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}
