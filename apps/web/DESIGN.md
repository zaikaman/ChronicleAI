---
name: ChronicleAI
description: Autonomous on-chain newspaper, paid intelligence feed, and policy-gated market desk — verified, editorial, calm.
colors:
  chartreuse: "#a8d946"
  chartreuse-mist: "#e8f5c8"
  ink: "#0a0a0a"
  ink-soft: "#171717"
  paper: "#f5f5f5"
  frame: "#ffffff"
  muted-surface: "#eaeaea"
  muted-ink: "#737373"
  border: "#e5e5e5"
  focus-ring: "#0066ff"
  success: "#22c55e"
  warning: "#f59e0b"
  error: "#ef4444"
  info: "#3b82f6"
  dark-paper: "#0f0f10"
  dark-ink: "#fafafa"
  dark-frame: "#050505"
  dark-muted: "#1a1a1c"
  dark-muted-ink: "#a3a3a3"
  dark-border: "#262626"
  dark-chartreuse-mist: "#212c12"
  dark-focus: "#3b82f6"
  selection-ink: "#000000"
typography:
  display:
    fontFamily: "Outfit, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Space Grotesk, Outfit, Inter, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Outfit, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "Outfit, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "normal"
  label:
    fontFamily: "Outfit, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
  mono:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  "2xl": "16px"
  pill: "999px"
  feature: "24px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  "2xl": "48px"
  card: "24px"
  section-y: "48px"
components:
  button-primary:
    backgroundColor: "{colors.chartreuse}"
    textColor: "{colors.selection-ink}"
    rounded: "{rounded.lg}"
    padding: "12px 24px"
  button-primary-hover:
    backgroundColor: "#8fc23a"
    textColor: "{colors.selection-ink}"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.frame}"
    rounded: "{rounded.lg}"
    padding: "8px 14px"
  button-ink-hover:
    backgroundColor: "#1a1a1a"
    textColor: "{colors.frame}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.lg}"
    padding: "6px 14px"
  card-publication:
    backgroundColor: "{colors.frame}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "{spacing.card}"
  card-feature-primary:
    backgroundColor: "{colors.chartreuse}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.feature}"
    padding: "{spacing.xl}"
  card-feature-secondary:
    backgroundColor: "{colors.chartreuse-mist}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.feature}"
    padding: "{spacing.xl}"
  chip-meta:
    backgroundColor: "{colors.muted-surface}"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.lg}"
    padding: "2px 8px"
  badge-status:
    backgroundColor: "rgba(113, 113, 122, 0.15)"
    textColor: "#a1a1aa"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  input-default:
    backgroundColor: "{colors.frame}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
  nav-header:
    backgroundColor: "{colors.frame}"
    textColor: "{colors.ink}"
    rounded: "{rounded.feature}"
    padding: "12px 24px"
---

# Design System: ChronicleAI

## 1. Overview

**Creative North Star: "The Verified Desk"**

ChronicleAI reads like a calm market newsroom, not a crypto trading terminal. Surfaces are cool, near-neutral paper with a white frame canvas; the only saturated brand voice is a chartreuse accent that marks confirmation, selection, and primary action. Hierarchy is editorial: headline → summary → source → proof. Density is calm—high signal, low noise—so a reader can scan alerts under time pressure without hype chrome.

The system serves product UI first (alerts, digests, premium, activity) while the marketing home borrows the same tokens with more motion and feature-scale surfaces. Depth comes from tonal layers and thin borders, not stacked glass or purple gradients. Dark mode inverts paper/frame into near-black canvas while keeping chartreuse as the constant signal color.

This system explicitly rejects generic SaaS crypto dashboards (navy/purple gradients, glassmorphism, hero-metric templates, identical icon+heading card grids), casino/meme degen aesthetics (neon overload, confetti, pump-style urgency), and pure blockchain explorers (raw tables with no editorial hierarchy or human-readable narrative).

**Key Characteristics:**
- Restrained palette: cool paper neutrals + one chartreuse accent (≤10% of most product screens)
- Editorial content structure over dashboard metric walls
- Proof-of-publication (hashes, explorer links, status) as first-class UI
- Soft radii (12–16px product cards; larger only on marketing feature tiles)
- Motion as state feedback and restrained reveal—always reduced-motion safe
- Light and dark themes share the same accent and component vocabulary

## 2. Colors

Cool, near-neutral paper with a single chartreuse brand note and a standard semantic traffic set for status.

### Primary
- **Signal Chartreuse** (`#a8d946`): Brand accent. Primary CTAs that need emphasis, text selection, hover border accents (`border-accent/40`), live tags, confirmation chips, and feature-primary marketing tiles (`card-primary`). On accent fills, ink is black (`#000` / `#171717`), never white. Rarity is the point—do not flood screens with lime.

### Secondary
- **Chartreuse Mist** (`#e8f5c8` light / `#212c12` dark): Soft companion surface for feature-secondary tiles and low-chroma accent panels. Carries brand without competing with primary actions.

### Neutral
- **Cool Paper** (`#f5f5f5` / dark `#0f0f10`): Page background (`--background`).
- **Frame White** (`#ffffff` / dark `#050505`): Elevated content surfaces—cards, header, panels (`--frame`).
- **Near Black Ink** (`#0a0a0a` / dark `#fafafa`): Primary text and ink buttons (`--foreground`).
- **Soft Ink** (`#171717`): Text on chartreuse feature cards in light mode.
- **Muted Surface** (`#eaeaea` / dark `#1a1a1c`): Chip backgrounds, secondary panels (`--muted`).
- **Muted Ink** (`#737373` / dark `#a3a3a3`): Secondary body and metadata (`--muted-foreground`). Must stay ≥4.5:1 on paper; do not lighten further for “elegance.”
- **Hairline Border** (`#e5e5e5` / dark `#262626`): 1px structural borders (`--border`).
- **Focus Blue** (`#0066ff` light / `#3b82f6` dark): Keyboard focus rings only—not brand decoration.

### Semantic
- **Success** (`#22c55e`): Published, high confidence, healthy status.
- **Warning** (`#f59e0b`): Partial failure, medium confidence, wrong-chain caution.
- **Error** (`#ef4444`): Failed delivery, low confidence, destructive actions.
- **Info** (`#3b82f6`): Queued, payment-route labels, neutral informational badges.

### Named Rules
**The One Signal Rule.** Chartreuse is the only brand-saturated color on product screens and appears on ≤10% of the surface. Status uses the semantic set; chrome stays neutral.

**The Proof Is Not Decorative Rule.** Transaction hashes, explorer links, and delivery status use mono + muted surfaces—never neon or gradient treatment. Trust comes from legibility.

**The Black-on-Lime Rule.** Text and icons on chartreuse fills are black (or soft ink), never white. Selection is chartreuse background + black text.

## 3. Typography

**Display Font:** Outfit (fallback Inter, system-ui)
**Headline Font:** Space Grotesk (page titles such as Archive) with Outfit for UI headings
**Body Font:** Outfit / Inter
**Mono Font:** SFMono-Regular / Consolas / Liberation Mono

**Character:** A single modern grotesque family carries nearly everything—product-appropriate familiarity with enough weight contrast for editorial hierarchy. Space Grotesk marks major publication section titles. Mono is reserved for hashes, addresses, providers, and on-chain identifiers.

### Hierarchy
- **Display** (600, `clamp(2.25rem, 5vw, 3.75rem)`, ~1.1 lh, tracking ≥ −0.02em): Marketing hero headlines only. Cap max at ~3.75rem; letter-spacing floor −0.04em.
- **Headline** (700, ~2.25rem / `text-4xl`, tight tracking): Product page titles (Archive, Alerts, etc.), often Space Grotesk.
- **Title** (600, 1.25rem / `text-xl`, snug): Alert and publication card titles; primary scan target.
- **Body** (400, 0.875rem / `text-sm`, relaxed 1.625): Summaries and report prose. Prefer max ~65–75ch for long reading.
- **Label** (500, ~11px / `text-[11px]`–`text-xs`): Meta chips (event type, chain, protocol). Not all-caps sitewide; uppercase only for deliberate kicker moments (e.g. hero live badge), never on every section.
- **Mono** (500–600, 0.75rem): Hashes, wallet addresses, generation provider, chain tags in technical contexts.

### Named Rules
**The Editorial Stack Rule.** Every publication unit is title → summary → meta chips → proof/footer. Do not invert to metrics-first layout on content cards.

**The Mono Means On-Chain Rule.** Monospace signals machine-verifiable data (tx, address, provider). Do not use mono for marketing slogans.

## 4. Elevation

ChronicleAI is **tonal + thin border**. Depth comes from paper vs frame contrast and 1px borders. Soft shadows appear only as interaction feedback on hoverable cards—not as resting decoration. No glassmorphism, no multi-layer soft ambient stacks on idle surfaces.

### Shadow Vocabulary
- **Rest (cards):** `shadow-xs` or none—border does the work.
- **Hover (interactive cards):** `shadow-md` with `border-accent/40` and ~300ms transition.
- **Header float:** Soft elevated shadow on the fixed header (`shadow-2xl/20`)—structural chrome only.
- **Dropdown / menu:** `shadow-xl` on wallet menus and floating panels to separate from content.
- **Theme control:** `shadow-lg` → `shadow-xl` on the fixed theme toggle.

### Named Rules
**The Flat-By-Default Rule.** Surfaces rest flat. Shadow is a response to interactivity or floating chrome, never a default card skin paired with heavy borders (no ghost-card: fat shadow + 1px border as dual decoration).

**The Frame Rule.** Desktop uses a 10px frame and corner marks (hidden ≤850px). Content lives inside the frame; do not add competing full-bleed colored sidebars.

## 5. Components

Refined and restrained: soft 12–16px product radii, accent sparingly, ink-on-paper cards, pill badges for status only.

### Buttons
- **Shape:** Gently rounded (`rounded-xl` / 12px) for product actions; full pill only for small status chips.
- **Primary (chartreuse):** Background chartreuse, text black, medium–bold weight. Used for high-emphasis actions (e.g. premium subscribe). Hover: darken slightly / reduce opacity of accent, keep black text.
- **Ink (default CTA):** Background foreground, text background (`bg-foreground text-background`). Used for connect wallet, access, primary product actions that should not scream brand color.
- **Ghost / text:** Transparent, muted foreground, hover to full foreground. Nav and secondary links.
- **Focus:** 2px solid focus ring (`--ring`), 2px offset. Never remove focus styles.
- **Disabled:** ~60% opacity, `not-allowed` cursor.

### Chips / Meta tags
- **Style:** Muted surface + hairline border, 11px medium label, `rounded-lg` (~8–12px). Used for event type, chain, protocol.
- **Not:** Full-width colorful tags or rainbow category systems.

### Status badges
- **Shape:** Pill (`999px`), tiny padding, 1px tinted border, translucent semantic background.
- **Variants:** default / success / warning / error / info (see Colors). Always pair with text labels—never color alone.

### Cards / Containers
- **Publication card:** Frame background, 1px border, `rounded-2xl` (16px), `p-6`, hover `border-accent/40` + soft shadow. Footer meta separated by light top border.
- **Feature marketing tiles:** `rounded-4xl` (~24px), chartreuse or mist fills—marketing home only; do not use 24px+ radii on product list cards.
- **Error / retry panel:** Frame/glass surface, 12px radius, light error-tinted border (`rgba(239,68,68,0.2)`).

### Inputs / Fields
- **Style:** Frame surface, 1px border, 12px radius, comfortable padding (~10–14px).
- **Focus:** Focus ring color (blue), not chartreuse, to distinguish keyboard focus from brand accent.
- **Error:** Error border/text; keep helper text ≥4.5:1.

### Navigation
- **Header:** Fixed, centered, max-width ~5xl, frame background, large bottom radius on desktop (`rounded-b-4xl`), flush top on mobile ≤850px. Links: medium weight, muted → foreground on hover/active.
- **Section nav (Archive):** Soft muted tray, rounded-2xl, accent-tinted active pill.
- **Mobile:** Full-width header, hamburger with motion morph; menu items inherit same type scale.

### Data primitives
- **Source reference:** Inline link/chip to tx or event source—always present when data exists.
- **Timestamp:** Relative or absolute, muted xs type.
- **Mono hash:** Truncated with mono chip styling; full value available via explorer link.

### State views
- **Loading:** Centered spinner using border + accent top stroke; polite live region.
- **Empty:** Title + short description; teach next action in copy, not illustration clutter.
- **Retry:** Error panel + chartreuse/ink Retry button.

### Signature: Site frame
- Fixed 10px frame edges + corner SVG fills matching `--frame`. Hidden below 850px. Decorative only (`aria-hidden`); never blocks interaction.

## 6. Do's and Don'ts

### Do:
- **Do** structure content as headline → summary → source → proof (PRODUCT: “Proof before polish”, “Editorial over dashboard”).
- **Do** keep chartreuse rare and intentional: CTAs, confirmation, hover accents, selection.
- **Do** use black (or soft ink) text on chartreuse fills and selection.
- **Do** show registry tx hashes, explorer links, and delivery status when publication claimed.
- **Do** use Outfit for UI; Space Grotesk for major page titles; mono only for on-chain/machine data.
- **Do** rest cards on frame + 1px border; lift shadow only on hover for interactive cards.
- **Do** honor `prefers-reduced-motion` (opacity-only or instant alternatives).
- **Do** meet WCAG 2.2 AA: body contrast ≥4.5:1, visible focus, skip link, semantic status not color-only.
- **Do** keep product card radii at 12–16px; reserve larger radii for marketing feature tiles and header chrome.

### Don't:
- **Don't** ship **generic SaaS crypto dashboards**: navy/purple gradients, glassmorphism, hero-metric templates, identical icon+heading feature card grids, or “AI made that” landing scaffolds.
- **Don't** use **casino / meme degen** aesthetics: neon overload, confetti, pump-style urgency, gambling UI.
- **Don't** design **pure blockchain explorers**: raw transaction tables with no editorial hierarchy, no human-readable narrative, no publication craft.
- **Don't** use side-stripe borders (`border-left`/`border-right` >1px) as accent on cards or alerts.
- **Don't** use gradient text (`background-clip: text`).
- **Don't** pair 1px borders with soft wide drop shadows (blur ≥16px) as resting decoration on the same element.
- **Don't** use 32px+ radius on product list cards or inputs (pills for tags only).
- **Don't** put tiny uppercase tracked eyebrows above every section—one deliberate kicker is voice; every section is AI grammar.
- **Don't** use numbered section markers (01 / 02 / 03) as default page scaffolding unless the content is a true ordered sequence.
- **Don't** put white text on chartreuse or lighten muted body text below readable contrast.
- **Don't** invent a second brand hue (purple, cyan glow, gold) for “crypto feel.”
