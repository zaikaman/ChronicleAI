import type { ReactElement } from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { sepoliaAddressUrl, truncateHash } from "../../lib/explorer.ts";
import {
  capitalDirectionLabel,
  capitalDirectionVariant,
  formatUsdc,
} from "./format.ts";
import { ProofMonoLink } from "./ProofMonoLink.tsx";
import type { DeskCapitalMove } from "./types.ts";

interface CapitalMovesPanelProps {
  moves: DeskCapitalMove[];
  "data-testid"?: string;
}

export function CapitalMovesPanel({
  moves,
  "data-testid": dataTestId = "capital-moves-panel",
}: CapitalMovesPanelProps): ReactElement {
  if (moves.length === 0) {
    return (
      <Surface className="p-6 text-sm text-muted-foreground" data-testid={dataTestId}>
        No capital moves yet. Top-ups (treasury → desk), sweeps (desk → treasury), and emergency
        returns will appear here with explorer proofs.
      </Surface>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid={dataTestId}>
      {moves.map((move) => (
        <Surface
          key={move.id}
          className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
        >
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <StatusBadge
              label={capitalDirectionLabel(move.direction)}
              variant={capitalDirectionVariant(move.direction)}
            />
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {formatUsdc(move.amountUsdc)}
            </span>
            {move.reason ? (
              <span className="text-xs text-muted-foreground truncate max-w-xs">
                {move.reason}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <a
              href={sepoliaAddressUrl(move.fromAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-muted-foreground hover:text-foreground transition-colors"
              title={move.fromAddress}
            >
              {truncateHash(move.fromAddress, 6, 4)}
            </a>
            <span className="text-muted-foreground" aria-hidden>
              →
            </span>
            <a
              href={sepoliaAddressUrl(move.toAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-muted-foreground hover:text-foreground transition-colors"
              title={move.toAddress}
            >
              {truncateHash(move.toAddress, 6, 4)}
            </a>
            {move.deskEquityAfter != null ? (
              <span className="text-muted-foreground tabular-nums">
                desk {formatUsdc(move.deskEquityAfter)}
              </span>
            ) : null}
            <TimestampDisplay timestamp={move.createdAt} />
            {move.txHash ? (
              <span className="inline-flex items-center gap-1" title="Transfer tx">
                <span className="text-muted-foreground">xfer</span>
                <ProofMonoLink value={move.txHash} href={move.explorerUrl} asTx />
              </span>
            ) : null}
            {move.registryTxHash ? (
              <span className="inline-flex items-center gap-1" title="Registry audit (recordCapitalMove)">
                <span className="text-muted-foreground">audit</span>
                <ProofMonoLink
                  value={move.registryTxHash}
                  href={move.registryExplorerUrl ?? undefined}
                  asTx
                />
              </span>
            ) : null}
          </div>
        </Surface>
      ))}
    </div>
  );
}
