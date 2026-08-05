import type { ReactElement } from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { sepoliaAddressUrl, truncateHash } from "../../lib/explorer.ts";
import {
  capitalDirectionLabel,
  capitalDirectionVariant,
  formatUsdc,
  humanizeCapitalMoveReason,
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
    <div className="flex flex-col gap-3" data-testid={dataTestId}>
      {moves.map((move) => {
        const isSweepOrEmergency =
          move.direction === "sweep" || move.direction === "emergency_return";
        const fromRole = isSweepOrEmergency ? "Desk" : "Treasury";
        const toRole = isSweepOrEmergency ? "Treasury" : "Desk";
        const reasonText = humanizeCapitalMoveReason(move.reason, move.direction);

        return (
          <Surface
            key={move.id}
            className="p-4 sm:p-5 flex flex-col gap-3 transition-all hover:border-border/80"
          >
            {/* Header row: Badge, Amount, and Balance/Timestamp */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge
                  label={capitalDirectionLabel(move.direction)}
                  variant={capitalDirectionVariant(move.direction)}
                />
                <span className="text-base font-bold tabular-nums text-foreground">
                  {formatUsdc(move.amountUsdc)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {move.deskEquityAfter != null ? (
                  <span className="bg-muted/50 px-2 py-0.5 rounded text-[11px] font-medium text-foreground/80 tabular-nums">
                    Desk balance after: {formatUsdc(move.deskEquityAfter)}
                  </span>
                ) : null}
                <TimestampDisplay timestamp={move.createdAt} />
              </div>
            </div>

            {/* Human-readable Reason Description */}
            <div className="text-xs font-medium text-muted-foreground leading-relaxed">
              {reasonText}
            </div>

            {/* Bottom Details Row: Route & On-chain Proofs */}
            <div className="pt-2.5 border-t border-border/40 flex flex-wrap items-center justify-between gap-y-2 gap-x-4 text-xs">
              {/* Routing Path */}
              <div className="flex items-center gap-1.5 text-muted-foreground text-[11px] sm:text-xs">
                <span className="font-semibold text-foreground/90">{fromRole}</span>
                <a
                  href={sepoliaAddressUrl(move.fromAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-muted-foreground hover:text-foreground transition-colors"
                  title={`${fromRole} address: ${move.fromAddress}`}
                >
                  ({truncateHash(move.fromAddress, 6, 4)})
                </a>
                <span className="text-muted-foreground/70 px-0.5" aria-hidden>
                  ➔
                </span>
                <span className="font-semibold text-foreground/90">{toRole}</span>
                <a
                  href={sepoliaAddressUrl(move.toAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-muted-foreground hover:text-foreground transition-colors"
                  title={`${toRole} address: ${move.toAddress}`}
                >
                  ({truncateHash(move.toAddress, 6, 4)})
                </a>
              </div>

              {/* Explorer Proof Links */}
              <div className="flex items-center gap-3 shrink-0">
                {move.txHash ? (
                  <span
                    className="inline-flex items-center gap-1.5 bg-muted/40 px-2 py-0.5 rounded border border-border/30 text-[11px]"
                    title="Transfer transaction proof"
                  >
                    <span className="text-muted-foreground font-medium">Tx</span>
                    <ProofMonoLink value={move.txHash} href={move.explorerUrl} asTx />
                  </span>
                ) : null}
                {move.registryTxHash ? (
                  <span
                    className="inline-flex items-center gap-1.5 bg-muted/40 px-2 py-0.5 rounded border border-border/30 text-[11px]"
                    title="On-chain registry audit record"
                  >
                    <span className="text-muted-foreground font-medium">Audit</span>
                    <ProofMonoLink
                      value={move.registryTxHash}
                      href={move.registryExplorerUrl ?? undefined}
                      asTx
                    />
                  </span>
                ) : null}
              </div>
            </div>
          </Surface>
        );
      })}
    </div>
  );
}
