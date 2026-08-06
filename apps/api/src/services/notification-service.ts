// Notification Service
// Public-facing notifications (low-balance, revenue routing) plus Telegram
// community channel fan-out for post-registry alert/digest broadcasts.
//
// IDEA Loop 1 step 5: after registry write, broadcast alert to Telegram
// with the KeeperHub execution transaction hash.
//
// Source-event chain (e.g. Ethereum Mainnet) may differ from the registry
// proof chain (Ethereum Sepolia) — labels must not conflate the two.

import { registryNetworkLabelFromExplorerUrl } from "@chronicleai/config";
import type { ExecutionLogRepository } from "@chronicleai/db";

export type NotificationDestinationType =
  | "log"
  | "webhook"
  | "email"
  | "telegram";

export interface NotificationDestination {
  type: NotificationDestinationType;
  /** Webhook URL (webhook) or unused for telegram (uses community config). */
  target?: string;
}

export interface CommunityChannelConfig {
  /** Telegram Bot API token from @BotFather. */
  telegramBotToken?: string | undefined;
  /** Telegram chat or channel ID that receives broadcasts. */
  telegramChatId?: string | undefined;
}

export interface AlertBroadcastParams {
  alertId: string;
  title: string;
  summary: string;
  eventType?: string | null | undefined;
  /** Monitored source chain (e.g. Ethereum Mainnet) — may differ from registry chain. */
  sourceChainLabel?: string | null | undefined;
  /** Explorer URL for the source on-chain event (not the registry proof). */
  sourceExplorerUrl?: string | null | undefined;
  registryTxHash?: string | undefined;
  /** Explorer URL for the KeeperHub registry / proof-of-publication tx. */
  explorerUrl?: string | undefined;
  contentUri?: string | undefined;
  publishedAt?: string | undefined;
}

export interface DigestBroadcastParams {
  digestId: string;
  title: string;
  summary: string;
  reportDate: string;
  registryTxHash?: string | undefined;
  /** Explorer URL for the KeeperHub registry / proof-of-publication tx. */
  explorerUrl?: string | undefined;
  contentUri?: string | undefined;
}

export interface ChannelDeliveryResult {
  delivered: boolean;
  destinations: string[];
  failures: string[];
}

export interface NotificationService {
  /**
   * Send a low-balance warning notification.
   */
  sendLowBalanceWarning(params: {
    availableBalance: number;
    safetyBuffer: number;
    deficitPercentage: number;
    status: string;
  }): Promise<ChannelDeliveryResult>;

  /**
   * Send a revenue routing notification.
   */
  sendRevenueRoutingNotification(params: {
    totalRevenue: number;
    creatorRecoveryAmount: number;
    referralRewardsAmount: number;
    payoutIds: string[];
    registryTxHash?: string;
  }): Promise<ChannelDeliveryResult>;

  /**
   * Broadcast a published alert to Telegram including the KeeperHub
   * registry transaction hash when available.
   */
  sendAlertBroadcast(params: AlertBroadcastParams): Promise<ChannelDeliveryResult>;

  /**
   * Broadcast a published digest bulletin to Telegram.
   */
  sendDigestBroadcast(params: DigestBroadcastParams): Promise<ChannelDeliveryResult>;

  /**
   * Deliver a Telegram message to a specific chat (private watch alerts).
   * Uses the send bot token; does not require community chat config.
   */
  sendTelegramToChat(params: {
    chatId: string;
    text: string;
    parseMode?: "HTML";
    entityType?: string;
    entityId?: string | null;
  }): Promise<ChannelDeliveryResult>;

  /** Whether Telegram community channel is configured and ready. */
  getConfiguredChannels(): { telegram: boolean };

  /** Whether the send bot token is configured (needed for private DMs). */
  isTelegramSendConfigured(): boolean;
}

export function buildNotificationDestinations(
  community: CommunityChannelConfig | undefined,
  extra: NotificationDestination[] = [],
): NotificationDestination[] {
  const destinations: NotificationDestination[] = [{ type: "log" }, ...extra];

  if (community?.telegramBotToken && community?.telegramChatId) {
    destinations.push({ type: "telegram", target: community.telegramChatId });
  }

  return destinations;
}

export function createNotificationService(
  execLogRepo: ExecutionLogRepository,
  options: {
    destinations?: NotificationDestination[];
    community?: CommunityChannelConfig;
    /**
     * Bot token for private DMs (Watch alerts). Must be the bot the user
     * actually messaged — i.e. the webhook-registered ingest bot. Falls back
     * to the community/send bot when unset (single-bot setups).
     */
    dmBotToken?: string | null;
    /** Optional fetch implementation for tests. */
    fetchImpl?: typeof fetch;
  } = {},
): NotificationService {
  const community = options.community ?? {};
  const dmBotToken = options.dmBotToken ?? undefined;
  const destinations =
    options.destinations ?? buildNotificationDestinations(community);
  const fetchFn = options.fetchImpl ?? fetch;

  function isTelegramConfigured(): boolean {
    return Boolean(community.telegramBotToken && community.telegramChatId);
  }

  async function deliverTelegramTo(
    chatId: string,
    text: string,
    parseMode: "HTML" | undefined = "HTML",
  ): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
    const botToken = dmBotToken ?? community.telegramBotToken;
    if (!botToken) {
      return { ok: false, error: "Telegram bot token not configured" };
    }
    if (!chatId?.trim()) {
      return { ok: false, error: "Telegram chat ID is required" };
    }

    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const body = new URLSearchParams({
      chat_id: chatId.trim(),
      text,
      disable_web_page_preview: "false",
    });
    if (parseMode) {
      body.set("parse_mode", parseMode);
    }

    try {
      const response = await fetchFn(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
        result?: { message_id?: number };
      };

      if (!response.ok || !data.ok) {
        return {
          ok: false,
          error:
            data.description ??
            `HTTP ${response.status}: Failed to send Telegram message`,
        };
      }

      return { ok: true, messageId: data.result?.message_id ?? 0 };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Telegram request failed",
      };
    }
  }

  async function deliverTelegram(
    text: string,
    parseMode: "HTML" | undefined = "HTML",
  ): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
    const chatId = community.telegramChatId;
    if (!chatId) {
      return { ok: false, error: "Telegram bot token or chat ID not configured" };
    }
    return deliverTelegramTo(chatId, text, parseMode);
  }

  async function deliverWebhook(
    target: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const response = await fetchFn(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Webhook request failed",
      };
    }
  }

  async function logNotification(params: {
    entityType: string;
    entityId: string | null;
    status: "succeeded" | "failed";
    message: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    await execLogRepo.append({
      action_type: "notification",
      entity_type: params.entityType,
      entity_id: params.entityId,
      status: params.status,
      message: params.message,
      details: params.details,
    });
  }

  return {
    getConfiguredChannels() {
      return {
        telegram: isTelegramConfigured(),
      };
    },

    isTelegramSendConfigured() {
      return Boolean(dmBotToken ?? community.telegramBotToken);
    },

    async sendTelegramToChat(params) {
      const delivered: string[] = [];
      const failures: string[] = [];
      const result = await deliverTelegramTo(
        params.chatId,
        params.text,
        params.parseMode ?? "HTML",
      );
      if (result.ok) {
        delivered.push(`telegram:${params.chatId}`);
        await logNotification({
          entityType: params.entityType ?? "telegram_dm",
          entityId: params.entityId ?? null,
          status: "succeeded",
          message: `Telegram DM delivered (message ${result.messageId})`,
          details: {
            notification_type: "telegram_dm",
            chat_id: params.chatId,
            message_id: result.messageId,
          },
        });
      } else {
        failures.push(`telegram:${result.error}`);
        await logNotification({
          entityType: params.entityType ?? "telegram_dm",
          entityId: params.entityId ?? null,
          status: "failed",
          message: `Failed to deliver Telegram DM: ${result.error}`,
          details: {
            notification_type: "telegram_dm",
            chat_id: params.chatId,
            error: result.error,
          },
        });
      }
      return { delivered: delivered.length > 0, destinations: delivered, failures };
    },

    async sendLowBalanceWarning(params) {
      const delivered: string[] = [];
      const failures: string[] = [];

      const plainText =
        `Low balance warning: ${params.status} ($${params.availableBalance} available, $${params.safetyBuffer} buffer, ${params.deficitPercentage.toFixed(1)}% deficit)`;

      for (const dest of destinations) {
        if (dest.type === "log") {
          await logNotification({
            entityType: "treasury_snapshot",
            entityId: null,
            status: "succeeded",
            message: plainText,
            details: {
              notification_type: "low_balance_warning",
              available_balance: params.availableBalance,
              safety_buffer: params.safetyBuffer,
              deficit_percentage: params.deficitPercentage,
              status: params.status,
            },
          });
          delivered.push("log");
        } else if (dest.type === "webhook" && dest.target) {
          const result = await deliverWebhook(dest.target, {
            type: "low_balance_warning",
            ...params,
          });
          if (result.ok) {
            delivered.push(`webhook:${dest.target}`);
          } else {
            failures.push(`webhook:${result.error}`);
            await logNotification({
              entityType: "treasury_snapshot",
              entityId: null,
              status: "failed",
              message: `Failed to deliver low balance warning to webhook: ${dest.target}`,
              details: { notification_type: "low_balance_warning", error: result.error },
            });
          }
        } else if (dest.type === "telegram") {
          const result = await deliverTelegram(
            `⚠️ <b>ChronicleAI Treasury</b>\n${escapeTelegramHtml(plainText)}`,
          );
          if (result.ok) {
            delivered.push("telegram");
          } else {
            failures.push(`telegram:${result.error}`);
          }
        }
      }

      return { delivered: delivered.length > 0, destinations: delivered, failures };
    },

    async sendRevenueRoutingNotification(params) {
      const delivered: string[] = [];
      const failures: string[] = [];

      const plainText =
        params.referralRewardsAmount > 0
          ? `Revenue routed: $${params.creatorRecoveryAmount} creator recovery, $${params.referralRewardsAmount} referral rewards`
          : `Revenue routed: $${params.creatorRecoveryAmount} creator recovery (affiliates withdraw separately)`;

      for (const dest of destinations) {
        if (dest.type === "log") {
          await logNotification({
            entityType: "payout_record",
            entityId: null,
            status: "succeeded",
            message: plainText,
            details: {
              notification_type: "revenue_routing",
              total_revenue: params.totalRevenue,
              creator_recovery_amount: params.creatorRecoveryAmount,
              referral_rewards_amount: params.referralRewardsAmount,
              payout_count: params.payoutIds.length,
              registry_tx_hash: params.registryTxHash,
            },
          });
          delivered.push("log");
        } else if (dest.type === "webhook" && dest.target) {
          const result = await deliverWebhook(dest.target, {
            type: "revenue_routing",
            ...params,
          });
          if (result.ok) {
            delivered.push(`webhook:${dest.target}`);
          } else {
            failures.push(`webhook:${result.error}`);
            await logNotification({
              entityType: "payout_record",
              entityId: null,
              status: "failed",
              message: `Failed to deliver revenue routing notification to webhook: ${dest.target}`,
              details: { notification_type: "revenue_routing", error: result.error },
            });
          }
        } else if (dest.type === "telegram") {
          const result = await deliverTelegram(
            `💰 <b>ChronicleAI Revenue Routing</b>\n${escapeTelegramHtml(plainText)}${
              params.registryTxHash
                ? `\nTx: <code>${escapeTelegramHtml(params.registryTxHash)}</code>`
                : ""
            }`,
          );
          if (result.ok) {
            delivered.push("telegram");
          } else {
            failures.push(`telegram:${result.error}`);
          }
        }
      }

      return { delivered: delivered.length > 0, destinations: delivered, failures };
    },

    async sendAlertBroadcast(params) {
      const delivered: string[] = [];
      const failures: string[] = [];

      const hasCommunityChannels = destinations.some((d) => d.type === "telegram");

      // Always log the broadcast attempt for the audit trail.
      for (const dest of destinations) {
        if (dest.type === "log") {
          await logNotification({
            entityType: "public_alert",
            entityId: params.alertId,
            status: "succeeded",
            message: `Alert community broadcast queued: ${params.title}`,
            details: {
              notification_type: "alert_broadcast",
              alert_id: params.alertId,
              title: params.title,
              registry_tx_hash: params.registryTxHash ?? null,
              content_uri: params.contentUri ?? null,
              explorer_url: params.explorerUrl ?? null,
              channels_configured: {
                telegram: isTelegramConfigured(),
              },
            },
          });
          delivered.push("log");
        } else if (dest.type === "webhook" && dest.target) {
          const result = await deliverWebhook(dest.target, {
            type: "alert_broadcast",
            ...params,
          });
          if (result.ok) {
            delivered.push(`webhook:${dest.target}`);
          } else {
            failures.push(`webhook:${result.error}`);
          }
        } else if (dest.type === "telegram") {
          const result = await deliverTelegram(buildTelegramAlertText(params));
          if (result.ok) {
            delivered.push("telegram");
            await logNotification({
              entityType: "public_alert",
              entityId: params.alertId,
              status: "succeeded",
              message: `Alert broadcast to Telegram (message ${result.messageId})`,
              details: {
                notification_type: "alert_broadcast",
                channel: "telegram",
                message_id: result.messageId,
                registry_tx_hash: params.registryTxHash ?? null,
              },
            });
          } else {
            failures.push(`telegram:${result.error}`);
            await logNotification({
              entityType: "public_alert",
              entityId: params.alertId,
              status: "failed",
              message: `Failed to broadcast alert to Telegram: ${result.error}`,
              details: {
                notification_type: "alert_broadcast",
                channel: "telegram",
                error: result.error,
              },
            });
          }
        }
      }

      if (!hasCommunityChannels) {
        // No Telegram configured — log-only is still a valid soft outcome.
        return { delivered: delivered.length > 0, destinations: delivered, failures };
      }

      return { delivered: delivered.length > 0, destinations: delivered, failures };
    },

    async sendDigestBroadcast(params) {
      const delivered: string[] = [];
      const failures: string[] = [];

      for (const dest of destinations) {
        if (dest.type === "log") {
          await logNotification({
            entityType: "daily_digest",
            entityId: params.digestId,
            status: "succeeded",
            message: `Digest community broadcast queued: ${params.title}`,
            details: {
              notification_type: "digest_broadcast",
              digest_id: params.digestId,
              title: params.title,
              report_date: params.reportDate,
              registry_tx_hash: params.registryTxHash ?? null,
              content_uri: params.contentUri ?? null,
            },
          });
          delivered.push("log");
        } else if (dest.type === "webhook" && dest.target) {
          const result = await deliverWebhook(dest.target, {
            type: "digest_broadcast",
            ...params,
          });
          if (result.ok) {
            delivered.push(`webhook:${dest.target}`);
          } else {
            failures.push(`webhook:${result.error}`);
          }
        } else if (dest.type === "telegram") {
          const result = await deliverTelegram(buildTelegramDigestText(params));
          if (result.ok) {
            delivered.push("telegram");
          } else {
            failures.push(`telegram:${result.error}`);
            await logNotification({
              entityType: "daily_digest",
              entityId: params.digestId,
              status: "failed",
              message: `Failed to broadcast digest to Telegram: ${result.error}`,
              details: {
                notification_type: "digest_broadcast",
                channel: "telegram",
                error: result.error,
              },
            });
          }
        }
      }

      return { delivered: delivered.length > 0, destinations: delivered, failures };
    },
  };
}

// ── Message formatters ──────────────────────────────────────────────

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Label the registry proof link so it is not mistaken for the source-event explorer. */
export function formatRegistryProofExplorerLine(explorerUrl: string): string {
  const network = registryNetworkLabelFromExplorerUrl(explorerUrl);
  const label = network
    ? `Registry proof explorer (${network})`
    : "Registry proof explorer";
  return `${label}: ${escapeTelegramHtml(explorerUrl)}`;
}

export function buildTelegramAlertText(params: AlertBroadcastParams): string {
  const lines = [
    `🚨 <b>ChronicleAI Alert</b>`,
    `<b>${escapeTelegramHtml(truncate(params.title, 200))}</b>`,
    "",
    escapeTelegramHtml(truncate(params.summary, 1500)),
  ];

  if (params.eventType) {
    lines.push("", `Event: <code>${escapeTelegramHtml(params.eventType)}</code>`);
  }
  if (params.sourceChainLabel) {
    lines.push(`Source network: ${escapeTelegramHtml(params.sourceChainLabel)}`);
  }
  if (params.sourceExplorerUrl) {
    lines.push(
      `Source event explorer: ${escapeTelegramHtml(params.sourceExplorerUrl)}`,
    );
  }
  // Prefer the explorer link alone — it already embeds the registry tx hash.
  // Fall back to the bare hash only when no explorer URL is available.
  if (params.explorerUrl) {
    lines.push(formatRegistryProofExplorerLine(params.explorerUrl));
  } else if (params.registryTxHash) {
    lines.push(
      `On-chain proof (KeeperHub registry): <code>${escapeTelegramHtml(params.registryTxHash)}</code>`,
    );
  }
  if (params.contentUri) {
    lines.push(`Read more: ${escapeTelegramHtml(params.contentUri)}`);
  }

  return lines.join("\n");
}

export function buildTelegramDigestText(params: DigestBroadcastParams): string {
  const lines = [
    `📰 <b>ChronicleAI Daily Digest</b>`,
    `<b>${escapeTelegramHtml(truncate(params.title, 200))}</b>`,
    `Date: ${escapeTelegramHtml(params.reportDate)}`,
    "",
    escapeTelegramHtml(truncate(params.summary, 1500)),
  ];

  // Prefer the explorer link alone — it already embeds the registry tx hash.
  if (params.explorerUrl) {
    lines.push("", formatRegistryProofExplorerLine(params.explorerUrl));
  } else if (params.registryTxHash) {
    lines.push(
      "",
      `On-chain proof (KeeperHub registry): <code>${escapeTelegramHtml(params.registryTxHash)}</code>`,
    );
  }
  if (params.contentUri) {
    lines.push(`Read more: ${escapeTelegramHtml(params.contentUri)}`);
  }

  return lines.join("\n");
}
