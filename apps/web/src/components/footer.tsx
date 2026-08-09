import { ArrowRight, Mail } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_NEWSLETTER_PRICE_USDC, useSubscribe } from "../features/subscribers/use-subscribe";
import { shortenAddress, useWallet } from "../features/wallet";

const footerLinks = {
  menu: [
    { label: "Daily Digest", href: "/digests/latest" },
    { label: "Market Alerts", href: "/alerts" },
    { label: "Publications Archive", href: "/publications" },
    { label: "Chronicle Desk", href: "/desk" },
    { label: "Chronicle Pass", href: "/subscription" },
    { label: "Premium Intelligence", href: "/premium" },
    { label: "Affiliates", href: "/affiliates" },
    { label: "Agent Activity", href: "/activity" },
  ],
  company: [
    { label: "KeeperHub", href: "https://keeperhub.com" },
    { label: "Sepolia Explorer", href: "https://sepolia.etherscan.io" },
    {
      label: "Chronicle Registry",
      href: "https://sepolia.etherscan.io/address/0xD8Deb4475a7E23E194Bc93f8739858Fb20744111",
    },
  ],
  social: [
    { label: "Telegram Alerts", href: "https://t.me/chronicleaialerts" },
    { label: "GitHub", href: "https://github.com/zaikaman/ChronicleAI" },
  ],
};

function ctaButtonLabel(params: {
  isBusy: boolean;
  step: string;
  priceAmount: number;
  priceCurrency: string;
  isConnected: boolean;
}): string {
  const { isBusy, step, priceAmount, priceCurrency, isConnected } = params;
  // Keep labels short — long copy overflows the pill (whitespace-nowrap + overflow-hidden parent).
  if (step === "connecting") return "Connecting…";
  if (step === "challenging") return "Preparing…";
  if (step === "signing") return "Sign in wallet…";
  if (step === "settling") return "Settling…";
  if (isBusy) return "Working…";
  if (!isConnected) {
    return `Pay ${priceAmount} ${priceCurrency}`;
  }
  return `Subscribe · ${priceAmount} ${priceCurrency}`;
}

export function Footer(): ReactNode {
  const [email, setEmail] = useState("");
  const { step, message, priceAmount, priceCurrency, isBusy, subscribe } = useSubscribe();
  const wallet = useWallet();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const ok = await subscribe(email);
    if (ok) {
      setEmail("");
    }
  }

  const isSuccess = step === "success";
  const isError = step === "error";
  const displayPrice =
    Number.isFinite(priceAmount) && priceAmount > 0 ? priceAmount : DEFAULT_NEWSLETTER_PRICE_USDC;
  const displayCurrency = priceCurrency || "USDC";

  return (
    <footer className="mt-28 mx-2.5 max-[850px]:mx-0">
      <div className="bg-accent rounded-tr-[3rem] rounded-tl-[3rem] pt-0 pb-16">
        <div className="max-w-5xl mx-auto px-6">
          <div className="-mt-20 mb-16 relative z-10 w-full rounded-3xl overflow-hidden shadow-2xl/15">
            <div
              className="absolute inset-0 bg-center bg-no-repeat brightness-150 blur scale-125"
              style={{
                backgroundImage:
                  "image-set(url(/BG.avif) type('image/avif'), url(/BG.webp) type('image/webp'), url(/BG.jpg) type('image/jpeg'))",
                backgroundSize: "150%",
              }}
              aria-hidden="true"
            />

            <div className="relative z-10 flex flex-col items-center text-center px-12 py-16 max-[850px]:px-6 max-[850px]:py-10">
              <h2 className="text-5xl max-[850px]:text-3xl text-black font-medium tracking-tight max-w-2xl mb-4 max-[850px]:mb-3 leading-tight">
                Funded by intelligence, driven by code.
              </h2>
              <p className="text-sm text-black/70 max-w-md mb-10 max-[850px]:mb-6 leading-relaxed">
                Chronicle Pass —{" "}
                <span className="font-semibold text-black">
                  {displayPrice} {displayCurrency}/month
                </span>{" "}
                unlocks every deep dive and the full archive. Connect your wallet, authorize USDC on{" "}
                {wallet.targetChain.name}, and renew on your terms.{" "}
                <Link
                  to="/subscription"
                  className="font-semibold text-black underline underline-offset-2"
                >
                  Manage subscription
                </Link>
              </p>

              <form
                onSubmit={handleSubmit}
                className="flex flex-col w-full max-w-sm gap-3"
                data-testid="newsletter-subscribe-form"
                aria-busy={isBusy}
              >
                {/* Stacked controls: long paid-CTA labels no longer overflow a side-by-side pill. */}
                <div className="flex flex-col gap-2 w-full min-w-0 bg-background rounded-xl p-2 shadow-lg">
                  <div className="flex items-center w-full min-w-0 rounded-lg border border-border/60 bg-background">
                    <Mail
                      className="w-5 h-5 text-muted-foreground ml-3 flex-none"
                      aria-hidden="true"
                    />
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      required
                      disabled={isBusy}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@protocol.xyz"
                      aria-label="Email for paid monthly digests"
                      className="min-w-0 flex-1 px-3 py-2.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isBusy}
                    data-testid="newsletter-subscribe-submit"
                    className="flex w-full min-w-0 items-center justify-center gap-2 px-4 py-2.5 bg-foreground hover:bg-foreground/90 text-background rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <span className="truncate">
                      {ctaButtonLabel({
                        isBusy,
                        step,
                        priceAmount: displayPrice,
                        priceCurrency: displayCurrency,
                        isConnected: wallet.isConnected,
                      })}
                    </span>
                    {!isBusy ? (
                      <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                    ) : null}
                  </button>
                </div>

                <div
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-black/5 text-left text-xs text-black/70"
                  data-testid="newsletter-wallet-strip"
                >
                  <span className="min-w-0 truncate">
                    {wallet.isConnected && wallet.address ? (
                      <>
                        Paying as{" "}
                        <span className="font-mono font-medium text-black">
                          {shortenAddress(wallet.address)}
                        </span>
                        {!wallet.isCorrectChain ? (
                          <span className="text-red-800">
                            {" "}
                            · switch to {wallet.targetChain.name}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>Wallet required · USDC on {wallet.targetChain.name}</>
                    )}
                  </span>
                  {!wallet.isConnected ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        void wallet.connect().catch(() => {
                          // User dismissed modal — form submit will retry
                        });
                      }}
                      className="shrink-0 font-medium text-black underline-offset-2 hover:underline cursor-pointer disabled:opacity-50"
                    >
                      Connect
                    </button>
                  ) : !wallet.isCorrectChain ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        void wallet.ensureChain().catch(() => {
                          // ensureChain surfaces rejection; next submit retries
                        });
                      }}
                      className="shrink-0 font-medium text-black underline-offset-2 hover:underline cursor-pointer disabled:opacity-50"
                    >
                      Switch network
                    </button>
                  ) : (
                    <span className="shrink-0 font-medium text-black/50">Ready</span>
                  )}
                </div>
              </form>

              {message ? (
                <output
                  data-testid="newsletter-subscribe-status"
                  className={`block mt-4 text-sm max-w-md ${
                    isSuccess
                      ? "text-neutral-900/80"
                      : isError
                        ? "text-red-800"
                        : "text-neutral-900/70"
                  }`}
                >
                  {message}
                </output>
              ) : null}
            </div>
          </div>

          <div className="flex items-start justify-between gap-12 max-[850px]:flex-col max-[850px]:gap-10">
            <Link to="/" className="flex items-center gap-2" aria-label="ChronicleAI home">
              <img
                src="/logo.png"
                alt="ChronicleAI Logo"
                className="h-8 w-8 object-contain"
              />
              <span className="text-xl font-semibold text-neutral-900 leading-none">
                ChronicleAI
              </span>
            </Link>

            <nav
              className="flex gap-16 max-[850px]:gap-10 max-[850px]:flex-wrap"
              aria-label="Footer navigation"
            >
              <div>
                <h3 className="text-xs font-medium text-neutral-900/50 uppercase tracking-wider mb-4">
                  Menu
                </h3>
                <ul className="space-y-2">
                  {footerLinks.menu.map((link) => (
                    <li key={link.label}>
                      <Link
                        to={link.href}
                        className="text-sm text-neutral-900 hover:text-neutral-900/70 transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-xs font-medium text-neutral-900/50 uppercase tracking-wider mb-4">
                  On-Chain
                </h3>
                <ul className="space-y-2">
                  {footerLinks.company.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-neutral-900 hover:text-neutral-900/70 transition-colors"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-xs font-medium text-neutral-900/50 uppercase tracking-wider mb-4">
                  Social
                </h3>
                <ul className="space-y-2">
                  {footerLinks.social.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-neutral-900 hover:text-neutral-900/70 transition-colors"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>
          </div>

          <div className="mt-16 pt-6">
            <p className="text-sm text-neutral-900/50 text-center">
              © {new Date().getFullYear()} ChronicleAI. Autonomous newspaper + market desk powered
              by KeeperHub.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
