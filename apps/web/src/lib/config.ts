export const siteConfig = {
  name: "ChronicleAI",
  tagline: "Autonomous On-Chain Newspaper",
  description:
    "An autonomous on-chain newspaper and paid intelligence feed that monitors blockchain events through KeeperHub, generates public and premium market intelligence, distributes alerts and digests, and funds its own operations through x402 and MPP micro-payments.",
  url: "https://chronicleai.xyz",
  twitter: "@chronicle_ai",
} as const;

export const features = {
  smoothScroll: true,
  parallaxHero: true,
  blurInHeadline: true,
} as const;

export const themeConfig = {
  defaultTheme: "dark" as "light" | "dark" | "system",
  enableSystemTheme: true,
} as const;
