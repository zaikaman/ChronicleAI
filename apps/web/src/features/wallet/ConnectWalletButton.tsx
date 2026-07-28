// Polished connect control — opens RainbowKit modal; never auto-connects.

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ReactElement } from "react";
import { shortenAddress } from "./chains.ts";

interface ConnectWalletButtonProps {
  compact?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function ConnectWalletButton({
  compact = false,
  className = "",
  "data-testid": dataTestId = "connect-wallet",
}: ConnectWalletButtonProps): ReactElement {
  return (
    <div className={className} data-testid={dataTestId}>
      <ConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openChainModal,
          openConnectModal,
          mounted,
        }) => {
          const ready = mounted;
          const connected = ready && account && chain;

          if (!ready) {
            return (
              <button
                type="button"
                disabled
                className="px-3.5 py-2 rounded-xl bg-foreground/40 text-background text-sm font-medium cursor-wait opacity-70"
                aria-hidden
              >
                Connect wallet
              </button>
            );
          }

          if (!connected) {
            return (
              <button
                type="button"
                onClick={openConnectModal}
                data-testid={`${dataTestId}-open`}
                className="px-3.5 py-2 rounded-xl bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
              >
                Connect wallet
              </button>
            );
          }

          if (chain.unsupported) {
            return (
              <button
                type="button"
                onClick={openChainModal}
                data-testid={`${dataTestId}-wrong-network`}
                className="px-3.5 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm font-medium cursor-pointer hover:bg-amber-500/15 transition-colors"
              >
                Wrong network
              </button>
            );
          }

          return (
            <div className="flex items-center gap-1.5">
              {!compact && (
                <button
                  type="button"
                  onClick={openChainModal}
                  data-testid={`${dataTestId}-chain`}
                  className="hidden min-[1100px]:inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-border/40 bg-foreground/5 text-xs font-medium text-foreground/80 hover:bg-foreground/10 transition-colors cursor-pointer"
                  title={chain.name}
                >
                  {chain.hasIcon && chain.iconUrl ? (
                    <img
                      alt=""
                      src={chain.iconUrl}
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ background: chain.iconBackground }}
                    />
                  ) : (
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                      aria-hidden
                    />
                  )}
                  <span className="max-w-[7rem] truncate">{chain.name}</span>
                </button>
              )}
              <button
                type="button"
                onClick={openAccountModal}
                data-testid={`${dataTestId}-account`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border/40 bg-foreground/5 text-sm font-medium text-foreground hover:bg-foreground/10 transition-colors cursor-pointer"
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                  aria-hidden
                />
                <span className="font-mono text-xs sm:text-sm">
                  {account.displayName ?? shortenAddress(account.address)}
                </span>
              </button>
            </div>
          );
        }}
      </ConnectButton.Custom>
    </div>
  );
}
