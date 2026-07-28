// Latest published digest — React Query

import type { DigestSections } from "@chronicleai/schemas";
import { useQuery } from "@tanstack/react-query";
import { apiGetJson, isNotFoundError, toErrorMessage } from "../../lib/api.ts";
import { queryKeys } from "../../lib/query-keys.ts";

export interface LatestDigestData {
  id: string;
  reportDate: string;
  title: string;
  summary: string;
  highlights: string[];
  analysis: string | undefined;
  sections?: DigestSections | undefined;
  publicationStatus: string;
  publishedAt: string | undefined;
  registryTxHash: string | undefined;
  contentHash?: string | undefined;
  contentUri: string | undefined;
  gasUsed?: string | undefined;
  gasUsedWei?: string | undefined;
  keeperHubRunId?: string | undefined;
  explorerUrl?: string | undefined;
  sourceEventRoot?: string | undefined;
}

function parseSections(raw: unknown): DigestSections | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  if (
    typeof s.capitalDirection !== "string" &&
    typeof s.exchangeAndProtocolFlows !== "string"
  ) {
    return undefined;
  }
  return {
    capitalDirection:
      typeof s.capitalDirection === "string"
        ? s.capitalDirection
        : "No qualifying directional flow today.",
    exchangeAndProtocolFlows:
      typeof s.exchangeAndProtocolFlows === "string"
        ? s.exchangeAndProtocolFlows
        : "No qualifying CEX or protocol flow today.",
    stressBoard:
      typeof s.stressBoard === "string"
        ? s.stressBoard
        : "No material stress signals today.",
    storyOfTheDay:
      typeof s.storyOfTheDay === "string"
        ? s.storyOfTheDay
        : "Quiet day — no single multi-event narrative.",
    coverageNote: typeof s.coverageNote === "string" ? s.coverageNote : "",
  };
}

export function mapDigestResponse(raw: Record<string, unknown>): LatestDigestData {
  const sections = parseSections(raw.sections);
  return {
    id: String(raw.id),
    reportDate: String(raw.reportDate),
    title: String(raw.title),
    summary: String(raw.summary),
    highlights: Array.isArray(raw.highlights) ? (raw.highlights as string[]) : [],
    analysis: raw.analysis ? String(raw.analysis) : undefined,
    ...(sections ? { sections } : {}),
    publicationStatus: String(raw.publicationStatus),
    publishedAt: raw.publishedAt ? String(raw.publishedAt) : undefined,
    registryTxHash: raw.registryTxHash ? String(raw.registryTxHash) : undefined,
    contentHash: raw.contentHash ? String(raw.contentHash) : undefined,
    contentUri: raw.contentUri ? String(raw.contentUri) : undefined,
    gasUsed: raw.gasUsed ? String(raw.gasUsed) : undefined,
    gasUsedWei: raw.gasUsedWei ? String(raw.gasUsedWei) : undefined,
    keeperHubRunId: raw.keeperHubRunId ? String(raw.keeperHubRunId) : undefined,
    explorerUrl: raw.explorerUrl ? String(raw.explorerUrl) : undefined,
    sourceEventRoot: raw.sourceEventRoot ? String(raw.sourceEventRoot) : undefined,
  };
}

export type DigestState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; error: string }
  | { status: "success"; data: LatestDigestData };

export interface UseLatestDigestReturn {
  state: DigestState;
  refetch: () => void;
}

export function useLatestDigest(): UseLatestDigestReturn {
  const query = useQuery({
    queryKey: queryKeys.digests.latest,
    queryFn: async ({ signal }) => {
      const raw = await apiGetJson<Record<string, unknown>>("/digests/latest", { signal });
      return mapDigestResponse(raw);
    },
    retry: (failureCount, error) => {
      if (isNotFoundError(error)) return false;
      return failureCount < 1;
    },
    staleTime: 30_000,
  });

  let state: DigestState;
  if (query.isLoading || query.isPending) {
    state = { status: "loading" };
  } else if (query.error) {
    state = isNotFoundError(query.error)
      ? { status: "not-found" }
      : {
          status: "error",
          error: toErrorMessage(query.error, "Unknown error fetching digest"),
        };
  } else if (query.data) {
    state = { status: "success", data: query.data };
  } else {
    state = { status: "loading" };
  }

  return {
    state,
    refetch: () => {
      void query.refetch();
    },
  };
}
