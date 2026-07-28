import type { ReactElement } from "react";
import { PublicationProof } from "../../components/publication-proof.tsx";
import { PageSection, Surface } from "../../components/page-chrome.tsx";

export interface DigestHighlightsProps {
  highlights: string[];
  registryTxHash: string | undefined;
  contentHash?: string | undefined;
  sourceEventRoot?: string | undefined;
  gasUsed?: string | undefined;
  gasUsedWei?: string | undefined;
  keeperHubRunId?: string | undefined;
  explorerUrl?: string | undefined;
}

export function DigestHighlights({
  highlights,
  registryTxHash,
  contentHash,
  sourceEventRoot,
  gasUsed,
  gasUsedWei,
  keeperHubRunId,
  explorerUrl,
}: DigestHighlightsProps): ReactElement {
  return (
    <PageSection title="Key highlights" data-testid="digest-highlights">
      {highlights.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="highlights-empty">
          No highlights available for this period.
        </p>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-3">
          {highlights.map((highlight, index) => (
            <Surface
              as="li"
              // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
              key={index}
              className="p-4 text-sm text-foreground leading-relaxed"
            >
              {highlight}
            </Surface>
          ))}
        </ul>
      )}

      <PublicationProof
        registryTxHash={registryTxHash}
        contentHash={contentHash}
        sourceEventRoot={sourceEventRoot}
        gasUsed={gasUsed}
        gasUsedWei={gasUsedWei}
        keeperHubRunId={keeperHubRunId}
        explorerUrl={explorerUrl}
        data-testid="registry-tx-link"
      />
    </PageSection>
  );
}
