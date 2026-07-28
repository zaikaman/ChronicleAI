// Connect control shell — defers RainbowKit until the wallet stack is ready.

import { lazy, Suspense, type ReactElement, useCallback, useState } from "react";
import { ButtonSpinner } from "../../components/ui/spinner.tsx";
import { useWalletBootstrap } from "./WalletProvider.tsx";

interface ConnectWalletButtonProps {
  compact?: boolean;
  className?: string;
  "data-testid"?: string;
}

const LiveConnectWalletButton = lazy(() =>
  import("./ConnectWalletButtonLive.tsx").then((m) => ({
    default: m.ConnectWalletButtonLive,
  })),
);

function DeferredConnectButton({
  className,
  dataTestId,
}: {
  className: string;
  dataTestId: string;
}): ReactElement {
  const { ensureWalletStack, isStackLoading } = useWalletBootstrap();
  const [clicked, setClicked] = useState(false);

  const handleClick = useCallback(() => {
    setClicked(true);
    void (async () => {
      const { markPendingOpenConnectModal } = await import("./WalletStack.tsx");
      markPendingOpenConnectModal();
      await ensureWalletStack();
    })();
  }, [ensureWalletStack]);

  const busy = isStackLoading || clicked;

  return (
    <div className={className} data-testid={dataTestId}>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        data-testid={`${dataTestId}-open`}
        className={
          busy
            ? "px-3.5 py-2 rounded-xl bg-foreground/40 text-background text-sm font-medium cursor-wait opacity-70"
            : "px-3.5 py-2 rounded-xl bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
        }
      >
        <ButtonSpinner loading={busy}>
          {busy ? "Loading wallet…" : "Connect wallet"}
        </ButtonSpinner>
      </button>
    </div>
  );
}

export function ConnectWalletButton({
  compact = false,
  className = "",
  "data-testid": dataTestId = "connect-wallet",
}: ConnectWalletButtonProps): ReactElement {
  const { isStackReady, isStackLoading } = useWalletBootstrap();

  if (!isStackReady) {
    return <DeferredConnectButton className={className} dataTestId={dataTestId} />;
  }

  return (
    <Suspense
      fallback={
        <div className={className} data-testid={dataTestId}>
          <button
            type="button"
            disabled
            className="px-3.5 py-2 rounded-xl bg-foreground/40 text-background text-sm font-medium cursor-wait opacity-70"
          >
            <ButtonSpinner loading={isStackLoading}>
              {isStackLoading ? "Loading wallet…" : "Connect wallet"}
            </ButtonSpinner>
          </button>
        </div>
      }
    >
      <LiveConnectWalletButton
        compact={compact}
        className={className}
        data-testid={dataTestId}
      />
    </Suspense>
  );
}
