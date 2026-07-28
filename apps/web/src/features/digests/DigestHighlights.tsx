import type { ReactElement } from "react";
import { PublicationProof } from "../../components/publication-proof.tsx";

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
    <div className="mb-8 font-sans" data-testid="digest-highlights">
      <h3 className="text-xl font-semibold text-foreground mb-4">
        Key Highlights
      </h3>

      {highlights.length === 0 ? (
        <p className="text-muted-foreground italic text-sm" data-testid="highlights-empty">
          No highlights available for this period.
        </p>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-3">
          {highlights.map((highlight, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
              key={index}
              className="p-4 bg-frame border border-border rounded-2xl text-sm text-foreground leading-relaxed hover:border-accent/40 transition-colors shadow-xs"
            >
              {highlight}
            </li>
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
    </div>
  );
}
