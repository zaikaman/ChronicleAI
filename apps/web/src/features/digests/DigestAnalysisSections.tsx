import type { DigestSections } from "@chronicleai/schemas";
import type { ReactElement } from "react";
import { PageSection, Surface } from "../../components/page-chrome.tsx";

export interface DigestAnalysisSectionsProps {
  summary: string;
  analysis: string | undefined;
  /** Structured sectioned digest copy when available. */
  sections?: DigestSections | undefined;
  reportDate: string;
}

const SECTION_META: Array<{
  key: keyof DigestSections;
  title: string;
  description: string;
}> = [
  {
    key: "capitalDirection",
    title: "Capital direction",
    description: "Net risk-on vs de-risk from qualified flow.",
  },
  {
    key: "exchangeAndProtocolFlows",
    title: "Exchange & protocol flows",
    description: "CEX in/out and large protocol deposit/withdraw.",
  },
  {
    key: "stressBoard",
    title: "Stress board",
    description: "Liquidations, clusters, gas and volume regime.",
  },
  {
    key: "storyOfTheDay",
    title: "Story of the day",
    description: "Single multi-event narrative — or a quiet day.",
  },
  {
    key: "coverageNote",
    title: "Coverage note",
    description: "What was filtered and why that builds trust.",
  },
];

function ParagraphBlock({ text }: { text: string }): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {text.split("\n\n").map((paragraph, index) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: stable text split
          key={index}
          className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap"
        >
          {paragraph}
        </p>
      ))}
    </div>
  );
}

export function DigestAnalysisSections({
  summary,
  analysis,
  sections,
  reportDate,
}: DigestAnalysisSectionsProps): ReactElement {
  const hasStructured =
    sections &&
    (sections.capitalDirection ||
      sections.exchangeAndProtocolFlows ||
      sections.stressBoard ||
      sections.storyOfTheDay);

  return (
    <div className="flex flex-col" data-testid="digest-analysis-sections">
      <PageSection
        title="Observed facts"
        description="Verified on-chain data for this reporting period."
      >
        <Surface className="p-5 sm:p-6">
          <p className="text-sm text-foreground leading-relaxed">{summary}</p>
        </Surface>
      </PageSection>

      {hasStructured ? (
        SECTION_META.map(({ key, title, description }) => {
          const body = sections?.[key]?.trim();
          if (!body) return null;
          return (
            <PageSection key={key} title={title} description={description}>
              <Surface className="p-5 sm:p-6" data-testid={`digest-section-${key}`}>
                <ParagraphBlock text={body} />
              </Surface>
            </PageSection>
          );
        })
      ) : analysis ? (
        <PageSection
          title="Analysis"
          description="ChronicleAI interpretation of the observed activity."
        >
          <Surface className="p-5 sm:p-6">
            <ParagraphBlock text={analysis} />
          </Surface>
        </PageSection>
      ) : null}

      <p className="text-xs text-muted-foreground text-right">Report date: {reportDate}</p>
    </div>
  );
}
