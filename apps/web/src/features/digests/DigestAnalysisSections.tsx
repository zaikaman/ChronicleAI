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
    <div className="flex flex-col gap-6" data-testid="digest-analysis-sections">
      {/* Observed Facts Section */}
      <section className="p-6 bg-frame border border-border rounded-2xl shadow-xs">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-semibold text-accent uppercase tracking-wider">
            Observed Facts
          </span>
          <span className="text-xs text-muted-foreground">
            &middot; Verified On-Chain Data
          </span>
        </div>
        <p className="text-sm text-foreground leading-relaxed">
          {summary}
        </p>
      </section>

      {/* Analysis Section */}
      {analysis && (
        <section className="p-6 bg-frame border border-border rounded-2xl shadow-xs">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Analysis
            </span>
            <span className="text-xs text-muted-foreground">
              &middot; ChronicleAI Interpretation
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {analysis.split("\n\n").map((paragraph, index) => (
              <p
                // biome-ignore lint/suspicious/noArrayIndexKey: stable text split
                key={index}
                className="text-sm text-muted-foreground leading-relaxed"
              >
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* Report Date Footer */}
      <p className="text-xs text-muted-foreground text-right mt-2">
        Report Date: {reportDate}
      </p>
    </div>
  );
}
