// Machine-readable payment rail discovery for autonomous agents.
// Served at GET /payments and GET /.well-known/agent-payments.

import type { AgentPaymentsDiscovery } from "@chronicleai/schemas";
import { PAYMENT_ROUTES } from "@chronicleai/schemas";
import { PRIVATE_ROUTING_PRODUCT_DESCRIPTION } from "./routing-metadata.ts";

/** Stable desk feed catalog slug (must match desk-feed-product.ts). */
const DESK_FEED_PRODUCT_SLUG = "chronicle-desk-feed";

/**
 * Build the agent payments discovery document.
 * Pure / static — no secrets, no request context required.
 */
export function buildAgentPaymentsDiscovery(): AgentPaymentsDiscovery {
  return {
    version: "1",
    name: "ChronicleAI Premium Payments",
    description:
      "Dual-rail micropayments for premium intelligence, sponsored contract watches, and the desk feed. " +
      "Humans pay with x402 (wallet USDC authorization). Machines pay with MPP (HMAC micro-billing on Tempo). " +
      PRIVATE_ROUTING_PRODUCT_DESCRIPTION,
    routes: [
      {
        id: "x402",
        label: "x402 (wallet)",
        audience: "human",
        verificationType: "eip712_transfer_with_authorization",
        currency: "USDC",
        network: "Base Sepolia (legacy ChronicleAI payment route)",
        description:
          "Browser wallet path. Client creates a challenge with paymentRoute=x402, signs EIP-712 TransferWithAuthorization, then settles. Default rail on the /premium web UI.",
      },
      {
        id: "mpp",
        label: "MPP (agent)",
        audience: "machine",
        verificationType: "hmac_sha256",
        currency: "USDC",
        network: "Tempo (machine-to-machine micro-billing)",
        description:
          "Agent path. Client creates a challenge with paymentRoute=mpp, computes HMAC-SHA256 over challengeData.hmacPayloadTemplate with the shared MPP secret, then settles with expiresAt:hmac as settlementReference.",
      },
      {
        id: "keeperhub-marketplace-watch",
        label: "KeeperHub Marketplace Watch",
        audience: "dual",
        verificationType: "keeperhub_x402_or_mpp",
        currency: "USDC",
        network: "Base Mainnet (KeeperHub Marketplace)",
        description:
          "Canonical Watch purchase. Call the listed workflow by slug; KeeperHub handles x402/MPP payment, the workflow writes the createSponsoredWatch receipt on Ethereum Sepolia, and ChronicleAI monitors and publishes the report asynchronously.",
      },
      {
        id: "auto",
        label: "Auto Dual-Route (auto)",
        audience: "dual",
        verificationType: "auto_selected_x402_or_mpp",
        currency: "USDC",
        network: "Auto-negotiated (Base/Sepolia for x402, Tempo for MPP)",
        description:
          "Auto-selects payment rail based on request context. Pass X-Chronicle-Client: agent header or clientType: machine to resolve MPP; defaults to x402 for browser wallets.",
      },
    ],
    endpoints: {
      discovery: "GET /payments",
      wellKnown: "GET /.well-known/agent-payments",
      listPremiumItems: "GET /premium/items",
      accessPremiumItem: "GET /premium/items/:id",
      createChallenge: "POST /payments/challenges",
      settlePayment: "POST /payments/settlements",
      createSponsoredWatchChallenge: "POST /payments/sponsored-watch/challenges",
      keeperhubMarketplaceWatch: "POST /keeperhub/marketplace/watch/call",
      listSponsoredWatches: "GET /premium/watches",
      deskIntents: "GET /premium/desk/intents",
      deskTicket: "GET /premium/desk/tickets/:id",
      deskStream: "GET /premium/desk/stream",
    },
    deskFeed: {
      productSlug: DESK_FEED_PRODUCT_SLUG,
      priceNote:
        "Buy the chronicle-desk-feed premium item via x402, then call desk endpoints with the access receipt.",
      executionRouting: PRIVATE_ROUTING_PRODUCT_DESCRIPTION,
      endpoints: {
        intents: "GET /premium/desk/intents",
        ticket: "GET /premium/desk/tickets/:id",
        stream: "GET /premium/desk/stream",
      },
    },
    mpp: {
      summary:
        "List teasers → POST challenge with paymentRoute=mpp → HMAC settle → access with receipt.",
      steps: [
        "GET /premium/items — each teaser includes paymentRoutes (expect x402 and mpp).",
        "POST /payments/challenges with { premiumItemId, paymentRoute: \"mpp\", payerReference?: \"0x…\" }.",
        "Read challengeData.hmacPayloadTemplate and challengeData.expiresAt from the 201 response.",
        "Compute settlementReference = `${expiresAt}:${hmac_sha256_hex(secret, hmacPayloadTemplate)}`.",
        "POST /payments/settlements with challengeReference, settlementReference, paymentRoute: \"mpp\", amountSettled, currency.",
        "Store accessReceipt from the settle response; GET /premium/items/:id with Authorization: Bearer <accessReceipt>.",
      ],
      challengeRequest: {
        method: "POST",
        path: "/payments/challenges",
        body: {
          premiumItemId: "<item-id-from-GET-/premium/items>",
          paymentRoute: "mpp",
          payerReference: "0xYourEvmAddressForAttribution",
          referralAddress: "0xOptionalAffiliateWallet",
        },
      },
      settleRequest: {
        method: "POST",
        path: "/payments/settlements",
        body: {
          challengeReference: "<from challenge response>",
          settlementReference: "<expiresAt>:<hmac_hex>",
          paymentRoute: "mpp",
          amountSettled: 0,
          currency: "USDC",
        },
        settlementReferenceFormat:
          "expiresAt:hmac where hmac = hex(HMAC-SHA256(MPP_SECRET, hmacPayloadTemplate)) and expiresAt matches challengeData.expiresAt exactly",
      },
      accessRequest: {
        method: "GET",
        path: "/premium/items/:id",
        headers: {
          Authorization: "Bearer <accessReceipt>",
          "X-Premium-Access-Receipt": "<accessReceipt>",
        },
      },
      notes: [
        "MPP requires a shared secret configured as MPP_SECRET on the server; agents hold the matching client secret out of band.",
        "Challenge hmacPayloadTemplate is already fully rendered — hash that string, do not rebuild fields yourself unless you match the template exactly.",
        "Prefer an EVM payerReference (0x…) so revenue routing can attribute on-chain; synthetic mpp-client-* ids skip on-chain referral transfers.",
        "Sponsored watches accept the same dual rails via POST /payments/sponsored-watch/challenges.",
        `Supported paymentRoute values: ${PAYMENT_ROUTES.join(", ")}.`,
        `Desk feed: settle x402 for slug ${DESK_FEED_PRODUCT_SLUG}, then GET /premium/desk/stream. ${PRIVATE_ROUTING_PRODUCT_DESCRIPTION}`,
      ],
    },
    humanUi: {
      path: "/premium",
      paymentRoute: "x402",
      note: "Watch checkout is canonical through KeeperHub Marketplace; the ChronicleAI page is a browser gateway that forwards the KeeperHub x402 challenge without exposing the organization API key. Legacy premium item checkout remains available for compatibility.",
    },
    keeperhubMarketplaceWatch: {
      slug: "chronicleai-paid-onchain-watch-v2",
      callUrl: "https://app.keeperhub.com/api/mcp/workflows/chronicleai-paid-onchain-watch-v2/call",
      mcpUrl: "https://app.keeperhub.com/mcp/w/chronicleai-paid-onchain-watch-v2",
      paymentNetwork: "Base Mainnet",
      registryNetwork: "Ethereum Sepolia",
      telegramInstruction:
        "Before calling, open @chronicleai_bot, send /start, and paste the one-time binding code returned by the bot. The code expires after 30 minutes and is required for Telegram alerts.",
      inputs: [
        "targetContract",
        "targetKind",
        "focusKey",
        "durationHours",
        "visibility",
        "telegramBindingCode",
        "requestId",
      ],
    },
  };
}
