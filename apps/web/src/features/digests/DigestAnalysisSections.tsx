// Digest analysis sections: separates observed facts from analytical interpretation

import type { ReactElement } from "react";

export interface DigestAnalysisSectionsProps {
  summary: string;
  analysis: string | undefined;
  reportDate: string;
}

export function DigestAnalysisSections({
  summary,
  analysis,
  reportDate,
}: DigestAnalysisSectionsProps): ReactElement {
  return (
    <div className="digest-analysis-sections" data-testid="digest-analysis-sections">
      {/* Observed Facts Section */}
      <section
        style={{
          marginBottom: "1.5rem",
          padding: "1rem",
          background: "var(--bg-glass)",
          borderRadius: "8px",
          border: "1px solid var(--border-primary)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.75rem",
          }}
        >
          <span
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: 600,
              color: "var(--accent-primary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Observed Facts
          </span>
          <span
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--fg-tertiary)",
            }}
          >
            &middot; Verified On-Chain Data
          </span>
        </div>
        <p
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--fg-primary)",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {summary}
        </p>
      </section>

      {/* Analysis Section */}
      {analysis && (
        <section
          style={{
            marginBottom: "1.5rem",
            padding: "1rem",
            background: "var(--bg-glass)",
            borderRadius: "8px",
            border: "1px solid var(--border-secondary)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.75rem",
            }}
          >
            <span
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 600,
                color: "var(--fg-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Analysis
            </span>
            <span
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--fg-tertiary)",
              }}
            >
              &middot; ChronicleAI Interpretation
            </span>
          </div>
          {analysis.split("\n\n").map((paragraph, index) => (
            <p
              // biome-ignore lint/suspicious/noArrayIndexKey: stable text split
              key={index}
              style={{
                fontSize: "var(--font-size-sm)",
                color: "var(--fg-secondary)",
                lineHeight: 1.6,
                margin: "0 0 0.5rem 0",
              }}
            >
              {paragraph}
            </p>
          ))}
        </section>
      )}

      {/* Report Date Footer */}
      <p
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--fg-tertiary)",
          textAlign: "right",
        }}
      >
        Report Date: {reportDate}
      </p>
    </div>
  );
}
