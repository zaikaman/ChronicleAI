import { ConnectWalletButton } from "@/features/wallet";
import { prefetchRoute } from "@/lib/route-prefetch.ts";
import {
  Activity,
  Archive,
  ArrowDownRight,
  ChevronDown,
  FileText,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const ease = [0.23, 1, 0.32, 1] as const;

const intelLinks = [
  {
    label: "Digest",
    href: "/digests/latest",
    description: "Latest market intelligence brief",
    icon: FileText,
  },
  {
    label: "Archive",
    href: "/publications",
    description: "Past publications and proof records",
    icon: Archive,
  },
  {
    label: "Premium",
    href: "/premium",
    description: "Deep dives & exclusive reports",
    icon: Sparkles,
  },
  {
    label: "Activity",
    href: "/activity",
    description: "Public proof & transaction trail",
    icon: Activity,
  },
];

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
  const [intelMenuOpen, setIntelMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const closeMobile = () => setMobileMenuOpen(false);

  const isIntelActive = intelLinks.some((link) => isActivePath(pathname, link.href));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIntelMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIntelMenuOpen(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIntelMenuOpen(false);
    }, 150);
  };

  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="fixed shadow-2xl/20 rounded-b-4xl top-2.5 left-1/2 -translate-x-1/2 w-full max-w-6xl max-[1200px]:max-w-4xl bg-frame z-[9990] max-[850px]:top-0 max-[850px]:left-0 max-[850px]:right-0 max-[850px]:translate-x-0 max-[850px]:w-full max-[850px]:max-w-none max-[850px]:rounded-none max-[850px]:rounded-b-4xl max-[850px]:overflow-hidden border-b border-border/10"
    >
      <div className="h-20 max-[850px]:h-18 flex items-center justify-between px-4 max-[850px]:px-6">
        {/* Brand Logo */}
        <Link
          to="/"
          className="flex items-center gap-2.5 ml-2 max-[850px]:ml-0 group"
          onClick={closeMobile}
        >
          <img
            src="/logo.png"
            alt="ChronicleAI Logo"
            className="h-9 w-9 object-contain group-hover:scale-105 transition-transform duration-200"
          />
          <span className="text-lg font-semibold text-foreground leading-none tracking-tight">
            ChronicleAI
          </span>
        </Link>

        {/* Primary Desktop Nav */}
        <nav
          className="flex items-center gap-1.5 max-[850px]:hidden"
          aria-label="Primary"
        >
          {/* Alerts */}
          <Link
            to="/alerts"
            title="What ChronicleAI sees"
            onMouseEnter={() => prefetchRoute("/alerts")}
            onFocus={() => prefetchRoute("/alerts")}
            className={`px-3.5 py-2 text-sm font-medium transition-all rounded-full hover:bg-foreground/5 ${
              isActivePath(pathname, "/alerts")
                ? "text-foreground bg-foreground/10 font-semibold"
                : "text-foreground/80 hover:text-foreground"
            }`}
          >
            Alerts
          </Link>

          {/* Desk */}
          <Link
            to="/desk"
            title="Treasury decisions and execution"
            onMouseEnter={() => prefetchRoute("/desk")}
            onFocus={() => prefetchRoute("/desk")}
            className={`px-3.5 py-2 text-sm font-medium transition-all rounded-full hover:bg-foreground/5 ${
              isActivePath(pathname, "/desk")
                ? "text-foreground bg-foreground/10 font-semibold"
                : "text-foreground/80 hover:text-foreground"
            }`}
          >
            Desk
          </Link>

          {/* Intelligence Dropdown */}
          <div
            ref={dropdownRef}
            className="relative"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <button
              type="button"
              onClick={() => setIntelMenuOpen(!intelMenuOpen)}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-all rounded-full hover:bg-foreground/5 cursor-pointer ${
                isIntelActive || intelMenuOpen
                  ? "text-foreground bg-foreground/10 font-semibold"
                  : "text-foreground/80 hover:text-foreground"
              }`}
              aria-expanded={intelMenuOpen}
              aria-haspopup="true"
            >
              <span>Intelligence</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  intelMenuOpen ? "rotate-180 text-foreground" : "text-foreground/60"
                }`}
              />
            </button>

            <AnimatePresence>
              {intelMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.96 }}
                  transition={{ duration: 0.18, ease }}
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 p-2 bg-frame/95 backdrop-blur-2xl border border-border/20 shadow-2xl rounded-2xl z-50 overflow-hidden"
                >
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1.5">
                    Insights & Feeds
                  </div>
                  <div className="space-y-0.5">
                    {intelLinks.map((link) => {
                      const Icon = link.icon;
                      const active = isActivePath(pathname, link.href);
                      return (
                        <Link
                          key={link.href}
                          to={link.href}
                          onClick={() => setIntelMenuOpen(false)}
                          onMouseEnter={() => prefetchRoute(link.href)}
                          onFocus={() => prefetchRoute(link.href)}
                          className={`flex items-start gap-3 p-2.5 rounded-xl transition-all ${
                            active
                              ? "bg-foreground/10 text-foreground"
                              : "hover:bg-foreground/5 text-foreground/80 hover:text-foreground"
                          }`}
                        >
                          <div
                            className={`mt-0.5 p-1.5 rounded-lg flex items-center justify-center ${
                              active
                                ? "bg-accent text-black"
                                : "bg-foreground/5 text-foreground/70"
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-medium leading-none mb-1">
                              {link.label}
                            </div>
                            <div className="text-xs text-muted-foreground font-normal line-clamp-1">
                              {link.description}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Pass */}
          <Link
            to="/subscription"
            data-testid="header-pass-link"
            onMouseEnter={() => prefetchRoute("/subscription")}
            onFocus={() => prefetchRoute("/subscription")}
            className={`px-3.5 py-2 text-sm font-medium transition-all rounded-full hover:bg-foreground/5 ${
              isActivePath(pathname, "/subscription")
                ? "text-foreground bg-foreground/10 font-semibold"
                : "text-foreground/80 hover:text-foreground"
            }`}
          >
            Pass
          </Link>
        </nav>

        {/* Right CTA / Wallet */}
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

        {/* Hamburger Mobile Toggle */}
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

      {/* Mobile Navigation Drawer */}
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
            <div className="px-6 pb-6">
              <nav className="space-y-4" aria-label="Mobile">
                {/* Core */}
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Operations
                  </div>
                  <div className="space-y-1">
                    <Link
                      to="/alerts"
                      className="flex items-center justify-between py-2 text-base font-medium text-foreground border-b border-foreground/10"
                      onClick={closeMobile}
                    >
                      Alerts
                    </Link>
                    <Link
                      to="/desk"
                      className="flex items-center justify-between py-2 text-base font-medium text-foreground border-b border-foreground/10"
                      onClick={closeMobile}
                    >
                      Desk
                    </Link>
                  </div>
                </div>

                {/* Intelligence */}
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Intelligence
                  </div>
                  <div className="space-y-1">
                    {intelLinks.map((link) => (
                      <Link
                        key={link.href}
                        to={link.href}
                        className="flex flex-col py-2.5 text-base font-medium text-foreground border-b border-foreground/10"
                        onClick={closeMobile}
                      >
                        <span>{link.label}</span>
                        <span className="text-xs text-muted-foreground font-normal mt-0.5">
                          {link.description}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              </nav>

              <div className="flex flex-col gap-4 pt-6">
                <ConnectWalletButton data-testid="mobile-connect-wallet" />
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to="/subscription"
                    className="text-sm font-medium text-foreground py-2"
                    onClick={closeMobile}
                  >
                    Pass & Subscription
                  </Link>
                  <Link
                    to="/alerts"
                    className="group relative inline-flex items-center"
                    onClick={closeMobile}
                  >
                    <span className="absolute right-0 inset-y-0 w-[calc(100%-1.5rem)] rounded-2xl bg-accent" />
                    <span className="relative z-10 px-4 py-2.5 rounded-2xl bg-foreground text-background text-sm font-medium">
                      View alerts
                    </span>
                    <span className="relative -left-px z-10 w-9 h-9 rounded-2xl flex items-center justify-center text-foreground">
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
