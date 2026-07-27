import type { ReactElement } from "react";
import { baseSepoliaTxUrl } from "../../lib/explorer.ts";

export interface DigestHighlightsProps {
  highlights: string[];
  registryTxHash: string | undefined;
}

export function DigestHighlights({
  highlights,
  registryTxHash,
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

      {registryTxHash && (
        <div
          className="mt-4 p-4 bg-muted/20 border border-accent/20 rounded-2xl text-xs flex items-center flex-wrap gap-2"
          data-testid="registry-tx-link"
        >
          <span className="text-muted-foreground">On-chain proof: </span>
          <a
            href={baseSepoliaTxUrl(registryTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent font-semibold font-mono hover:underline break-all"
            title={`View transaction ${registryTxHash} on BaseScan`}
          >
            {registryTxHash}
          </a>
        </div>
      )}
    </div>
  );
}
