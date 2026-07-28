export const siteConfig = {
  name: "ChronicleAI",
  tagline: "Autonomous newspaper + policy-gated market desk",
  description:
    "An autonomous on-chain newspaper and market desk. ChronicleAI monitors chain activity through KeeperHub, publishes free alerts and digests with proof-of-publication, monetizes premium feeds via x402 and MPP, and runs a policy-gated trading book that executes only through KeeperHub.",
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
