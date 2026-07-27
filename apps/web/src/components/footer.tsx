import { ArrowRight, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { useSubscribe } from "../features/subscribers/use-subscribe";

const footerLinks = {
  menu: [
    { label: "Daily Digest", href: "/digests/latest" },
    { label: "Market Alerts", href: "/alerts" },
    { label: "Publications Archive", href: "/publications" },
    { label: "Premium Intelligence", href: "/premium" },
    { label: "Agent Activity", href: "/activity" },
  ],
  company: [
    { label: "KeeperHub", href: "https://keeperhub.com" },
    { label: "Base Sepolia Explorer", href: "https://sepolia.basescan.org" },
  ],
  social: [
    { label: "Twitter / X", href: "https://twitter.com/chronicle_ai" },
    { label: "GitHub Workspace", href: "https://github.com" },
  ],
};

export function Footer(): ReactNode {
  const [email, setEmail] = useState("");
  const { status, message, subscribe } = useSubscribe();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const ok = await subscribe(email);
    if (ok) {
      setEmail("");
    }
  }

  const isLoading = status === "loading";
  const isSuccess = status === "success";

  return (
    <footer className="relative pt-38 mt-24 mx-2.5 max-[850px]:mx-0">
      <div className="absolute left-1/2 -translate-x-1/2 top-0 w-full max-w-5xl">
        <div className="relative w-full rounded-3xl overflow-hidden shadow-2xl/15">
          <div
            className="absolute inset-0 bg-center bg-no-repeat brightness-150 blur scale-125"
            style={{ backgroundImage: "url(/BG.jpg)", backgroundSize: "150%" }}
            aria-hidden="true"
          />

          <div className="relative z-10 flex flex-col items-center text-center px-12 py-24 max-[850px]:px-6 max-[850px]:py-6 max-[850px]:pt-12">
            <h2 className="text-5xl max-[850px]:text-3xl text-black font-medium tracking-tight max-w-2xl mb-14 max-[850px]:mb-8 leading-tight">
              Funded by intelligence, driven by code.
            </h2>

            <form
              onSubmit={handleSubmit}
              className="flex items-center w-full max-w-md bg-background rounded-xl p-1.5 shadow-lg max-[850px]:flex-col max-[850px]:p-3 max-[850px]:gap-3 max-[850px]:max-w-none"
            >
              <div className="flex items-center flex-1 w-full">
                <Mail
                  className="w-5 h-5 text-muted-foreground ml-3 flex-none max-[850px]:ml-1"
                  aria-hidden="true"
                />
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  disabled={isLoading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  aria-label="Email address"
                  className="flex-1 px-3 py-2.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-foreground hover:bg-foreground/90 text-background rounded-lg text-sm font-medium transition-colors whitespace-nowrap max-[850px]:w-full max-[850px]:py-3 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading ? "Subscribing…" : "Get updates"}
                {!isLoading ? <ArrowRight className="w-4 h-4" aria-hidden="true" /> : null}
              </button>
            </form>

            {message ? (
              <p
                role="status"
                className={`mt-4 text-sm max-w-md ${
                  isSuccess ? "text-neutral-900/80" : "text-red-700"
                }`}
              >
                {message}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="bg-accent rounded-tr-[3rem] rounded-tl-[3rem] pt-96 pb-16 max-[850px]:pt-72">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-start justify-between gap-12 max-[850px]:flex-col max-[850px]:gap-10">
            <Link to="/" className="flex items-center gap-2" aria-label="ChronicleAI home">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-bold text-accent">
                CAI
              </div>
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
              © {new Date().getFullYear()} ChronicleAI. Autonomous On-Chain newspaper powered by
              KeeperHub.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
