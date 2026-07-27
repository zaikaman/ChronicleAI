// Webflow collection publishing service

export interface WebflowPublishResult {
  success: boolean;
  contentUri?: string;
  errorMessage?: string;
}

export interface WebflowPublishingService {
  /** Publish a digest article to the Webflow collection. */
  publishDigestArticle(params: {
    title: string;
    summary: string;
    highlights: string[];
    analysis: string | undefined;
    reportDate: string;
    registryTxHash: string | undefined;
  }): Promise<WebflowPublishResult>;
}

export function createWebflowPublishingService(
  apiToken: string | undefined,
  collectionId: string | undefined,
): WebflowPublishingService {
  const WEBFLOW_API_BASE = "https://api.webflow.com/v2";

  return {
    async publishDigestArticle(params) {
      if (!apiToken || !collectionId) {
        return {
          success: false,
          errorMessage:
            "Webflow not configured (missing WEBFLOW_API_TOKEN or WEBFLOW_COLLECTION_ID)",
        };
      }

      try {
        const body = {
          fieldData: {
            name: `ChronicleAI Daily Digest — ${params.reportDate}`,
            slug: `chronicleai-digest-${params.reportDate.replace(/[^0-9]/g, "")}`,
            _archived: false,
            _draft: false,
            summary: params.summary,
            highlights: params.highlights.join("\n"),
            analysis: params.analysis ?? "",
            "registry-tx-hash": params.registryTxHash ?? "",
            "report-date": params.reportDate,
          },
        };

        const response = await fetch(`${WEBFLOW_API_BASE}/collections/${collectionId}/items`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
            "accept-version": "1.0.0",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          return {
            success: false,
            errorMessage: `Webflow API error (${response.status}): ${errorText}`,
          };
        }

        const data = (await response.json()) as { id?: string };
        const contentUri = `https://webflow.com/collection/${collectionId}/item/${data.id}`;

        return {
          success: true,
          contentUri,
        };
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown Webflow error",
        };
      }
    },
  };
}
