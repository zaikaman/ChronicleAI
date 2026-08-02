import { ConnectWalletButton } from "@/features/wallet";
import { prefetchRoute } from "@/lib/route-prefetch.ts";
import { ArrowDownRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const navLinks = [
  { label: "Alerts", href: "/alerts", description: "Public bulletins that feed the desk" },
  { label: "Desk", href: "/desk", description: "Signal → policy → action review" },
  { label: "Activity", href: "/activity", description: "Public execution and proof trail" },
  { label: "Digest", href: "/digests/latest", description: "Latest intelligence brief" },
  { label: "Archive", href: "/publications", description: "Past publications and proof records" },
  { label: "Premium", href: "/premium", description: "Paid intelligence and sponsorships" },
];

const ease = [0.23, 1, 0.32, 1] as const;

function HamburgerIcon({ isOpen }: { isOpen: boolean }): ReactNode {
  return (
    <div className="w-8 h-4 relative flex flex-col justify-between cursor-pointer">
      <motion.span
        className="block h-0.5 w-full bg-foreground origin-center rounded-full"
        animate={isOpen ? { rotate: 45, y: 4.5 } : { rotate: 0, y: 0 }}
        transition={{ duration: 0.25, ease }}
      />
      <motion.span
        className="block h-0.5 w-full bg-foreground origin-center rounded-full"
        animate={isOpen ? { rotate: -45, y: -9.5 } : { rotate: 0, y: 0 }}
        transition={{ duration: 0.25, ease }}
      />
    </div>
  );
}

const CornerSVG = ({ className }: { className: string }) => (
  <svg
    className={className}
    width="50"
    height="50"
    viewBox="0 0 50 50"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M5.50871e-06 0C-0.00788227 37.3001 8.99616 50.0116 50 50H5.50871e-06V0Z"
      fill="currentColor"
    />
  </svg>
);

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/digests/latest") {
    return pathname === "/digests/latest" || pathname.startsWith("/digests/");
  }
  if (href === "/desk") {
    return pathname === "/desk" || pathname.startsWith("/desk/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header(): ReactNode {
  const location = useLocation();
  const pathname = location.pathname;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobile = () => setMobileMenuOpen(false);

  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="fixed shadow-2xl/20 rounded-b-4xl top-2.5 left-1/2 -translate-x-1/2 w-full max-w-5xl max-[1200px]:max-w-2xl bg-frame z-[9990] max-[850px]:top-0 max-[850px]:left-0 max-[850px]:right-0 max-[850px]:translate-x-0 max-[850px]:w-full max-[850px]:max-w-none max-[850px]:rounded-none max-[850px]:rounded-b-4xl max-[850px]:overflow-hidden border-b border-border/10"
    >
      <div className="h-20 max-[850px]:h-18 flex items-center justify-between px-4 max-[850px]:px-6">
        <Link
          to="/"
          className="flex items-center gap-2 ml-4 max-[850px]:ml-0"
          onClick={closeMobile}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
            CAI
          </div>
          <span className="text-lg font-semibold text-foreground leading-none max-[1200px]:hidden max-[850px]:inline">
            ChronicleAI
          </span>
        </Link>

        <nav
          className="flex items-center gap-0.5 max-[1200px]:gap-0 max-[850px]:hidden"
          aria-label="Primary"
        >
          {navLinks.map((link) => {
            const active = isActivePath(pathname, link.href);
            return (
              <Link
                key={link.href}
                to={link.href}
                title={link.description}
                onMouseEnter={() => prefetchRoute(link.href)}
                onFocus={() => prefetchRoute(link.href)}
                className={`px-3 py-2 max-[1200px]:px-2.5 text-sm font-medium transition-colors rounded-full hover:bg-foreground/5 ${
                  active
                    ? "text-foreground bg-foreground/5"
                    : "text-foreground/80 hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 max-[850px]:hidden">
          <ConnectWalletButton data-testid="header-connect-wallet" />
          <Link to="/alerts" className="group relative inline-flex items-center">
            <span className="absolute right-0 inset-y-0 w-[calc(100%-1.5rem)] rounded-xl bg-accent" />
            <span className="relative z-10 px-5 py-2.5 rounded-xl bg-foreground text-background text-sm font-medium">
              View live alerts
            </span>
            <span className="relative -left-px z-10 w-9 h-9 rounded-xl flex items-center justify-center text-black">
              <ArrowDownRight className="w-4 h-4 transition-transform duration-300 group-hover:-rotate-45" />
            </span>
          </Link>
        </div>

        <button
          type="button"
          className="hidden max-[850px]:flex h-11 w-11 items-center justify-center cursor-pointer"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-navigation"
        >
          <HamburgerIcon isOpen={mobileMenuOpen} />
        </button>
      </div>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease }}
            className="hidden max-[850px]:block overflow-hidden"
            id="mobile-navigation"
          >
            <div className="px-6 pb-4">
              <nav className="space-y-0" aria-label="Mobile">
                <Link
                  to="/"
                  className="flex items-center justify-between py-4 text-base font-medium text-foreground border-b border-foreground/10"
                  onClick={closeMobile}
                >
                  Home
                </Link>
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    to={link.href}
                    className="flex flex-col py-4 text-base font-medium text-foreground border-b border-foreground/10"
                    onClick={closeMobile}
                    onMouseEnter={() => prefetchRoute(link.href)}
                    onFocus={() => prefetchRoute(link.href)}
                  >
                    <span>{link.label}</span>
                    <span className="text-xs text-muted-foreground font-normal mt-0.5">
                      {link.description}
                    </span>
                  </Link>
                ))}
              </nav>

              <div className="flex flex-col gap-4 pt-8 pb-2">
                <ConnectWalletButton data-testid="mobile-connect-wallet" />
                <div className="flex items-center justify-between">
                  <Link
                    to="/premium"
                    className="text-base font-medium text-foreground"
                    onClick={closeMobile}
                  >
                    Unlock premium
                  </Link>
                  <Link
                    to="/alerts"
                    className="group relative inline-flex items-center"
                    onClick={closeMobile}
                  >
                    <span className="absolute right-0 inset-y-0 w-[calc(100%-1.5rem)] rounded-2xl bg-accent" />
                    <span className="relative z-10 px-5 py-3 rounded-2xl bg-foreground text-background text-sm font-medium">
                      View live alerts
                    </span>
                    <span className="relative -left-px z-10 w-10 h-10 rounded-2xl flex items-center justify-center text-foreground">
                      <ArrowDownRight className="w-4 h-4 transition-transform duration-300 group-hover:-rotate-45" />
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CornerSVG className="absolute top-0 -left-12.25 rotate-180 text-frame pointer-events-none max-[850px]:hidden" />
      <CornerSVG className="absolute top-0 -right-12.25 rotate-90 text-frame pointer-events-none max-[850px]:hidden" />
    </motion.header>
  );
}
