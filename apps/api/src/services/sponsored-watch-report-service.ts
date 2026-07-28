// Sponsored watch report generator
// Builds a campaign-end intelligence report from events observed on the
// target contract during the paid monitoring window (Loop 4 step 4).

import { ethers } from "ethers";
import type { MonitoredEventRow } from "@chronicleai/db";

export interface SponsoredWatchReportContent {
  title: string;
  summary: string;
  highlights: string[];
  analysis: string;
  sourceEventIds: string[];
  /** Deterministic commitment over source event ids (empty-root when none). */
  sourceEventRoot: string;
  /** keccak256 of the canonical report body used as on-chain reportContentHash. */
  reportContentHash: string;
  confidence: "high" | "medium" | "low";
}

export interface SponsoredWatchReportInput {
  watchId: string;
  targetContract: string;
  watchSpecHash: string;
  startsAt: string;
  endsAt: string;
  events: MonitoredEventRow[];
}

export interface SponsoredWatchReportService {
  generateReport(input: SponsoredWatchReportInput): SponsoredWatchReportContent;
}

function formatEventLine(event: MonitoredEventRow): string {
  const parts: string[] = [event.event_type.replace(/_/g, " ")];
  if (event.protocol) parts.push(`on ${event.protocol}`);
  if (event.asset_symbols?.length) parts.push(`(${event.asset_symbols.join("/")})`);
  if (event.magnitude && typeof event.magnitude === "object") {
    const mag = event.magnitude as Record<string, unknown>;
    if (typeof mag.value === "number" && typeof mag.unit === "string") {
      parts.push(`${mag.value.toLocaleString()} ${mag.unit}`);
    }
  }
  if (event.transaction_hash) {
    parts.push(`tx ${event.transaction_hash.slice(0, 10)}…`);
  }
  return parts.join(" ");
}

/**
 * Build a stable source-event root commitment.
 * Sorted event ids joined, then keccak256 — same family as digest roots
 * (string commitment hashed again by the web3 client before the bytes32 write).
 */
export function buildSourceEventRoot(sourceEventIds: string[]): string {
  if (sourceEventIds.length === 0) {
    return ethers.keccak256(ethers.toUtf8Bytes("empty-sponsored-watch-root"));
  }
  const sorted = [...sourceEventIds].sort();
  return ethers.keccak256(ethers.toUtf8Bytes(sorted.join(",")));
}

function buildReportContentHash(body: {
  title: string;
  summary: string;
  highlights: string[];
  analysis: string;
  sourceEventIds: string[];
  sourceEventRoot: string;
  targetContract: string;
  startsAt: string;
  endsAt: string;
}): string {
  const canonical = JSON.stringify({
    analysis: body.analysis,
    endsAt: body.endsAt,
    highlights: body.highlights,
    sourceEventIds: [...body.sourceEventIds].sort(),
    sourceEventRoot: body.sourceEventRoot,
    startsAt: body.startsAt,
    summary: body.summary,
    targetContract: body.targetContract.toLowerCase(),
    title: body.title,
  });
  return ethers.keccak256(ethers.toUtf8Bytes(canonical));
}

export function createSponsoredWatchReportService(): SponsoredWatchReportService {
  return {
    generateReport(input) {
      const { events, targetContract, startsAt, endsAt, watchId } = input;
      const sourceEventIds = events.map((e) => e.id);
      const sourceEventRoot = buildSourceEventRoot(sourceEventIds);

      const windowLabel = `${new Date(startsAt).toISOString().slice(0, 10)} → ${new Date(endsAt).toISOString().slice(0, 10)}`;
      const shortTarget = `${targetContract.slice(0, 8)}…${targetContract.slice(-6)}`;

      if (events.length === 0) {
        const title = `Sponsored Watch Report — ${shortTarget}`;
        const summary = `No qualifying on-chain events were observed on ${targetContract} during the campaign window (${windowLabel}). The monitoring job completed with an empty source set.`;
        const highlights = [
          "Zero events matched the sponsored target contract in the campaign window.",
          "On-chain create and report receipts still form the paid campaign audit trail.",
        ];
        const analysis =
          `Campaign ${watchId} monitored ${targetContract} from ${startsAt} to ${endsAt}. ` +
          "No Event Tracker / block-dispatcher events referenced this contract address in the window. " +
          "The empty source-event root is committed on-chain for verifiable completeness.";

        return {
          title,
          summary,
          highlights,
          analysis,
          sourceEventIds,
          sourceEventRoot,
          reportContentHash: buildReportContentHash({
            title,
            summary,
            highlights,
            analysis,
            sourceEventIds,
            sourceEventRoot,
            targetContract,
            startsAt,
            endsAt,
          }),
          confidence: "high",
        };
      }

      const ranked = [...events].sort(
        (a, b) => (b.significance_score ?? 0) - (a.significance_score ?? 0),
      );
      const types = new Set(events.map((e) => e.event_type));
      const protocols = [
        ...new Set(events.map((e) => e.protocol).filter((p): p is string => Boolean(p))),
      ];

      const title = `Sponsored Watch Report — ${shortTarget}`;
      const summary =
        `ChronicleAI observed ${events.length} on-chain event(s) on ${targetContract} ` +
        `during ${windowLabel}. Event types: ${[...types].map((t) => t.replace(/_/g, " ")).join(", ")}.`;

      const highlights = ranked.slice(0, 8).map((event, i) => {
        const score =
          event.significance_score != null
            ? ` (significance: ${(event.significance_score * 100).toFixed(0)}%)`
            : "";
        return `${i + 1}. ${formatEventLine(event)}${score}`;
      });

      const analysisParts: string[] = [
        `Campaign ${watchId} monitored ${targetContract} (spec ${input.watchSpecHash.slice(0, 18)}…) from ${startsAt} to ${endsAt}.`,
        `Source set size: ${events.length} event(s) across chain id(s) ${[...new Set(events.map((e) => e.chain_id))].join(", ")}.`,
      ];
      if (protocols.length > 0) {
        analysisParts.push(`Protocols observed: ${protocols.join(", ")}.`);
      }
      const top = ranked[0];
      if (top) {
        analysisParts.push(`Highest-significance observation: ${formatEventLine(top)}.`);
      }
      analysisParts.push(
        `Source-event root ${sourceEventRoot.slice(0, 18)}… commits the ordered event id set for on-chain verification.`,
      );

      const analysis = analysisParts.join("\n\n");

      return {
        title,
        summary,
        highlights,
        analysis,
        sourceEventIds,
        sourceEventRoot,
        reportContentHash: buildReportContentHash({
          title,
          summary,
          highlights,
          analysis,
          sourceEventIds,
          sourceEventRoot,
          targetContract,
          startsAt,
          endsAt,
        }),
        confidence: events.length >= 3 ? "high" : "medium",
      };
    },
  };
}

/**
 * Extract contract addresses from a monitored event's raw payload for
 * campaign matching (Event Tracker address / contractAddress fields).
 */
export function extractEventContractAddresses(event: MonitoredEventRow): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      if (ethers.isAddress(value)) {
        found.add(ethers.getAddress(value).toLowerCase());
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of ["address", "contractAddress", "targetContract", "to", "from"]) {
        if (typeof obj[key] === "string" && ethers.isAddress(obj[key] as string)) {
          found.add(ethers.getAddress(obj[key] as string).toLowerCase());
        }
      }
      // Nested rawPayload from Event Tracker expansion
      if (obj.rawPayload && typeof obj.rawPayload === "object") {
        visit(obj.rawPayload, depth + 1);
      }
      if (obj.args && typeof obj.args === "object") {
        visit(obj.args, depth + 1);
      }
    }
  };

  visit(event.raw_payload);
  return [...found];
}

export function eventMatchesTargetContract(
  event: MonitoredEventRow,
  targetContract: string,
): boolean {
  if (!ethers.isAddress(targetContract)) return false;
  const target = ethers.getAddress(targetContract).toLowerCase();
  return extractEventContractAddresses(event).includes(target);
}
