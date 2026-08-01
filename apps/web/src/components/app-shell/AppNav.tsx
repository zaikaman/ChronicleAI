import { ArrowLeft, Menu } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { ConnectWalletButton } from "@/features/wallet";
import { Badge } from "../ui/badge.tsx";

interface AppNavProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  menuButtonRef?: Ref<HTMLButtonElement>;
  sectionLabel?: string;
}

/**
 * Compact product top bar — modeled after PalletMan Studio:
 * Back · logo · section badge · wallet
 */
export function AppNav({
  sidebarOpen,
  onToggleSidebar,
  menuButtonRef,
  sectionLabel = "Desk",
}: AppNavProps): ReactNode {
  return (
    <nav
      className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border bg-frame shrink-0 z-20"
      aria-label="App"
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onToggleSidebar}
          className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-xl text-foreground hover:bg-muted transition-colors shrink-0"
          aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
          aria-haspopup="dialog"
        >
          <Menu className="h-4 w-4" />
        </button>

        <Link
          to="/"
          className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </Link>

        <div className="hidden sm:block h-4 w-px bg-border shrink-0" aria-hidden="true" />

        <Link to="/" className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background shrink-0">
            CAI
          </div>
          <span className="text-base font-semibold text-foreground truncate">ChronicleAI</span>
        </Link>

        <Badge variant="accent" className="shrink-0">
          {sectionLabel}
        </Badge>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <ConnectWalletButton data-testid="app-nav-connect-wallet" />
      </div>
    </nav>
  );
}
