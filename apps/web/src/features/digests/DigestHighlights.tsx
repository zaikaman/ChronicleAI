// Digest highlights component with registry transaction links

import type { ReactElement } from "react";

export interface DigestHighlightsProps {
  highlights: string[];
  registryTxHash: string | undefined;
}

export function DigestHighlights({
  highlights,
  registryTxHash,
}: DigestHighlightsProps): ReactElement {
  return (
    <div className="digest-highlights" data-testid="digest-highlights">
      <h3
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: 600,
          marginBottom: "1rem",
          color: "var(--fg-primary)",
        }}
      >
        Key Highlights
      </h3>

      {highlights.length === 0 ? (
        <p
          style={{ color: "var(--fg-tertiary)", fontStyle: "italic" }}
          data-testid="highlights-empty"
        >
          No highlights available for this period.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          {highlights.map((highlight, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
              key={index}
              style={{
                padding: "0.75rem 1rem",
                background: "var(--bg-glass)",
                borderRadius: "8px",
                border: "1px solid var(--border-primary)",
                fontSize: "var(--font-size-sm)",
                color: "var(--fg-primary)",
                lineHeight: 1.5,
              }}
            >
              {highlight}
            </li>
          ))}
        </ul>
      )}

      {registryTxHash && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            background: "var(--bg-glass)",
            borderRadius: "8px",
            border: "1px solid var(--accent-primary)",
            fontSize: "var(--font-size-xs)",
          }}
          data-testid="registry-tx-link"
        >
          <span style={{ color: "var(--fg-tertiary)" }}>On-chain proof: </span>
          <a
            href={`https://sepolia.basescan.org/tx/${registryTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--accent-primary)",
              textDecoration: "none",
              fontWeight: 600,
              fontFamily: "monospace",
            }}
            title={`View transaction ${registryTxHash} on BaseScan`}
          >
            {registryTxHash.slice(0, 10)}...
            {registryTxHash.slice(-6)}
          </a>
        </div>
      )}
    </div>
  );
}
