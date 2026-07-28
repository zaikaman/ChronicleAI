// Frontend hook for fetching the latest published digest

import { useCallback, useEffect, useState } from "react";

export interface LatestDigestData {
  id: string;
  reportDate: string;
  title: string;
  summary: string;
  highlights: string[];
  analysis: string | undefined;
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
  const [state, setState] = useState<DigestState>({ status: "loading" });

  const fetchDigest = useCallback(async () => {
    setState({ status: "loading" });

    try {
      const origin = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
      const response = await fetch(`${origin}/digests/latest`);

      if (response.status === 404) {
        setState({ status: "not-found" });
        return;
      }

      if (!response.ok) {
        setState({ status: "error", error: `Failed to fetch digest (${response.status})` });
        return;
      }

      const raw = (await response.json()) as Record<string, unknown>;
      const data: LatestDigestData = {
        id: String(raw.id),
        reportDate: String(raw.reportDate),
        title: String(raw.title),
        summary: String(raw.summary),
        highlights: Array.isArray(raw.highlights) ? (raw.highlights as string[]) : [],
        analysis: raw.analysis ? String(raw.analysis) : undefined,
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

      setState({ status: "success", data });
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error fetching digest",
      });
    }
  }, []);

  useEffect(() => {
    fetchDigest();
  }, [fetchDigest]);

  return { state, refetch: fetchDigest };
}
