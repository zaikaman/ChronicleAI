export interface DigestContent {
  title: string;
  summary: string;
  highlights: string[];
  analysis?: string;
  sourceEventIds: string[];
  confidence: "high" | "medium" | "low";
}

export interface DigestGenerationService {
  /** Generate digest content from selected events. */
  generateDigest(params: {
    reportDate: string;
    periodStart: string;
    periodEnd: string;
    events: Array<{
      id: string;
      eventType: string;
      chainId: number;
      protocol: string | null;
      assetSymbols: string[] | null;
      magnitude: Record<string, unknown> | null;
      transactionHash: string | null;
      significanceScore: number | null;
      capturedAt: string;
    }>;
  }): Promise<DigestContent>;
}

export function createDigestGenerationService(): DigestGenerationService {
  function formatEventSummary(event: {
    eventType: string;
    protocol: string | null;
    assetSymbols: string[] | null;
    magnitude: Record<string, unknown> | null;
    significanceScore: number | null;
  }): string {
    const parts: string[] = [event.eventType.replace(/_/g, " ")];
    if (event.protocol) parts.push(`on ${event.protocol}`);
    if (event.assetSymbols?.length) parts.push(`(${event.assetSymbols.join("/")})`);
    if (event.magnitude) {
      const mag = event.magnitude as Record<string, unknown>;
      if (typeof mag.value === "number" && typeof mag.unit === "string") {
        parts.push(`${mag.value.toLocaleString()} ${mag.unit}`);
      }
    }
    return parts.join(" ");
  }

  return {
    async generateDigest(params) {
      const { events, reportDate } = params;

      const formattedDate = new Date(reportDate).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      if (events.length === 0) {
        return {
          title: `ChronicleAI Daily Digest — ${formattedDate}`,
          summary: `No significant on-chain events were detected during the reporting period ending ${formattedDate}. Normal monitoring operations continue.`,
          highlights: ["No major events detected during this reporting period."],
          analysis:
            "The absence of significant on-chain activity during this period suggests normal market conditions with no anomalous trade, liquidation, gas, or deployment events crossing configured thresholds.",
          sourceEventIds: [],
          confidence: "high",
        };
      }

      // Sort events by significance score descending for ranking
      const ranked = [...events].sort(
        (a, b) => (b.significanceScore ?? 0) - (a.significanceScore ?? 0),
      );
      const topEvent = ranked[0];

      const highlights = ranked.slice(0, 5).map((event, i) => {
        const summary = formatEventSummary(event);
        const score = event.significanceScore
          ? ` (significance: ${(event.significanceScore * 100).toFixed(0)}%)`
          : "";
        return `${i + 1}. ${summary}${score}`;
      });

      const topEventSummary = topEvent ? formatEventSummary(topEvent) : "no significant events";
      const summary = `Over the reporting period ending ${formattedDate}, ChronicleAI monitored ${events.length} qualifying on-chain events. The most significant activity involved ${topEventSummary}.`;

      const analysisParts: string[] = [];
      analysisParts.push(
        `During this reporting period (${new Date(params.periodStart).toISOString().split("T")[0]} to ${new Date(params.periodEnd).toISOString().split("T")[0]}), ChronicleAI detected and qualified ${events.length} noteworthy on-chain events across ${new Set(events.map((e) => e.chainId)).size} chain(s).`,
      );

      const types = new Set(events.map((e) => e.eventType));
      if (types.size > 0) {
        analysisParts.push(
          `Event type distribution: ${[...types].map((t) => t.replace(/_/g, " ")).join(", ")}.`,
        );
      }

      const protocols = events.filter((e) => e.protocol).map((e) => e.protocol);
      if (protocols.length > 0) {
        const uniqueProtocols = [...new Set(protocols)];
        analysisParts.push(`Protocols involved: ${uniqueProtocols.join(", ")}.`);
      }

      const highestScore = Math.max(...events.map((e) => e.significanceScore ?? 0));
      if (highestScore > 0.8) {
        analysisParts.push(
          "The highest-significance event(s) exceeded 80% confidence, indicating strong signal quality.",
        );
      } else if (highestScore > 0.5) {
        analysisParts.push(
          "Event significance scores were moderate, suggesting notable but not extreme on-chain activity.",
        );
      }

      return {
        title: `ChronicleAI Daily Digest — ${formattedDate}`,
        summary,
        highlights,
        analysis: analysisParts.join("\n\n"),
        sourceEventIds: events.map((e) => e.id),
        confidence: events.length >= 3 ? "high" : "medium",
      };
    },
  };
}
