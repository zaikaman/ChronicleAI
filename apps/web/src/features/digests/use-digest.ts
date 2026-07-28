// Fetch a single public digest by id (HTTPS content URI page)

import { useCallback, useEffect, useState } from "react";
import type { DigestState, LatestDigestData } from "./use-latest-digest.ts";

export function useDigest(digestId: string | undefined): {
  state: DigestState;
  refetch: () => void;
} {
  const [state, setState] = useState<DigestState>({ status: "loading" });

  const fetchDigest = useCallback(async () => {
    if (!digestId) {
      setState({ status: "not-found" });
      return;
    }

    setState({ status: "loading" });

    try {
      const origin = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
      const path =
        digestId === "latest"
          ? `${origin}/digests/latest`
          : `${origin}/digests/${encodeURIComponent(digestId)}`;
      const response = await fetch(path);

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
        contentUri: raw.contentUri ? String(raw.contentUri) : undefined,
      };

      setState({ status: "success", data });
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error fetching digest",
      });
    }
  }, [digestId]);

  useEffect(() => {
    void fetchDigest();
  }, [fetchDigest]);

  return { state, refetch: fetchDigest };
}
