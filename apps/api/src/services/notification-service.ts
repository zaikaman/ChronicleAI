// Notification Service
// Operator notifications (low-balance, revenue routing) plus community channel
// fan-out (Discord + Telegram) for post-registry alert/digest broadcasts.
//
// IDEA Loop 1 step 5: after registry write, broadcast alert to Discord and
// Telegram with the KeeperHub execution transaction hash.

import type { ExecutionLogRepository } from "@chronicleai/db";

export type NotificationDestinationType =
  | "log"
  | "webhook"
  | "email"
  | "discord"
  | "telegram";

export interface NotificationDestination {
  type: NotificationDestinationType;
  /** Webhook URL (webhook/discord) or unused for telegram (uses community config). */
  target?: string;
}

export interface CommunityChannelConfig {
  /** Discord Incoming Webhook URL (https://discord.com|discordapp.com/api/webhooks/...). */
  discordWebhookUrl?: string | undefined;
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
  registryTxHash?: string | undefined;
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
   * Broadcast a published alert to community channels (Discord + Telegram)
   * including the KeeperHub registry transaction hash when available.
   */
  sendAlertBroadcast(params: AlertBroadcastParams): Promise<ChannelDeliveryResult>;

  /**
   * Broadcast a published digest bulletin to community channels.
   */
  sendDigestBroadcast(params: DigestBroadcastParams): Promise<ChannelDeliveryResult>;

  /** Which community channels are configured and ready. */
  getConfiguredChannels(): { discord: boolean; telegram: boolean };
}

const DISCORD_WEBHOOK_HOSTS = new Set(["discord.com", "discordapp.com"]);

/**
 * Validates a Discord webhook URL by hostname over https (not substring).
 * Rejects off-host URLs that carry "discord.com/api/webhooks/" in the path.
 */
export function isValidDiscordWebhookUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const hostAllowed =
    DISCORD_WEBHOOK_HOSTS.has(host) ||
    host.endsWith(".discord.com") ||
    host.endsWith(".discordapp.com");
  if (!hostAllowed) {
    return false;
  }
  return parsed.pathname.startsWith("/api/webhooks/");
}

export function buildNotificationDestinations(
  community: CommunityChannelConfig | undefined,
  extra: NotificationDestination[] = [],
): NotificationDestination[] {
  const destinations: NotificationDestination[] = [{ type: "log" }, ...extra];

  if (community?.discordWebhookUrl && isValidDiscordWebhookUrl(community.discordWebhookUrl)) {
    destinations.push({ type: "discord", target: community.discordWebhookUrl });
  }

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
    /** Optional fetch implementation for tests. */
    fetchImpl?: typeof fetch;
  } = {},
): NotificationService {
  const community = options.community ?? {};
  const destinations =
    options.destinations ?? buildNotificationDestinations(community);
  const fetchFn = options.fetchImpl ?? fetch;

  function isDiscordConfigured(): boolean {
    return Boolean(
      community.discordWebhookUrl && isValidDiscordWebhookUrl(community.discordWebhookUrl),
    );
  }

  function isTelegramConfigured(): boolean {
    return Boolean(community.telegramBotToken && community.telegramChatId);
  }

  async function deliverDiscord(
    payload: Record<string, unknown>,
  ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const webhookUrl = community.discordWebhookUrl;
    if (!webhookUrl || !isValidDiscordWebhookUrl(webhookUrl)) {
      return { ok: false, error: "Discord webhook not configured or invalid" };
    }

    try {
      const response = await fetchFn(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // wait=true returns the message object (id) instead of 204
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        return {
          ok: false,
          error: body.message ?? `HTTP ${response.status}: Discord webhook failed`,
        };
      }

      const result =
        response.status === 204
          ? null
          : ((await response.json().catch(() => ({}))) as { id?: string });

      return { ok: true, id: result?.id ?? "sent" };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Discord request failed",
      };
    }
  }

  async function deliverTelegram(
    text: string,
    parseMode: "HTML" | undefined = "HTML",
  ): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
    const botToken = community.telegramBotToken;
    const chatId = community.telegramChatId;
    if (!botToken || !chatId) {
      return { ok: false, error: "Telegram bot token or chat ID not configured" };
    }

    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const body = new URLSearchParams({
      chat_id: chatId,
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
        discord: isDiscordConfigured(),
        telegram: isTelegramConfigured(),
      };
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
        } else if (dest.type === "discord") {
          const result = await deliverDiscord({
            content: `⚠️ **ChronicleAI Treasury**\n${plainText}`,
          });
          if (result.ok) {
            delivered.push("discord");
          } else {
            failures.push(`discord:${result.error}`);
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
        `Revenue routed: $${params.creatorRecoveryAmount} creator recovery, $${params.referralRewardsAmount} referral rewards`;

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
        } else if (dest.type === "discord") {
          const result = await deliverDiscord({
            content: `💰 **ChronicleAI Revenue Routing**\n${plainText}${
              params.registryTxHash ? `\nTx: \`${params.registryTxHash}\`` : ""
            }`,
          });
          if (result.ok) {
            delivered.push("discord");
          } else {
            failures.push(`discord:${result.error}`);
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

      const hasCommunityChannels = destinations.some(
        (d) => d.type === "discord" || d.type === "telegram",
      );

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
                discord: isDiscordConfigured(),
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
        } else if (dest.type === "discord") {
          const result = await deliverDiscord(buildDiscordAlertPayload(params));
          if (result.ok) {
            delivered.push("discord");
            await logNotification({
              entityType: "public_alert",
              entityId: params.alertId,
              status: "succeeded",
              message: `Alert broadcast to Discord (message ${result.id})`,
              details: {
                notification_type: "alert_broadcast",
                channel: "discord",
                message_id: result.id,
                registry_tx_hash: params.registryTxHash ?? null,
              },
            });
          } else {
            failures.push(`discord:${result.error}`);
            await logNotification({
              entityType: "public_alert",
              entityId: params.alertId,
              status: "failed",
              message: `Failed to broadcast alert to Discord: ${result.error}`,
              details: {
                notification_type: "alert_broadcast",
                channel: "discord",
                error: result.error,
              },
            });
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
        // No Discord/Telegram configured — log-only is still a valid soft outcome.
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
        } else if (dest.type === "discord") {
          const result = await deliverDiscord(buildDiscordDigestPayload(params));
          if (result.ok) {
            delivered.push("discord");
          } else {
            failures.push(`discord:${result.error}`);
            await logNotification({
              entityType: "daily_digest",
              entityId: params.digestId,
              status: "failed",
              message: `Failed to broadcast digest to Discord: ${result.error}`,
              details: {
                notification_type: "digest_broadcast",
                channel: "discord",
                error: result.error,
              },
            });
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

export function buildDiscordAlertPayload(params: AlertBroadcastParams): Record<string, unknown> {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  if (params.eventType) {
    fields.push({ name: "Event", value: params.eventType, inline: true });
  }
  if (params.registryTxHash) {
    fields.push({
      name: "Registry Tx (KeeperHub)",
      value: `\`${params.registryTxHash}\``,
      inline: false,
    });
  }
  if (params.explorerUrl) {
    fields.push({
      name: "Explorer",
      value: `[View on-chain proof](${params.explorerUrl})`,
      inline: true,
    });
  }
  if (params.contentUri) {
    fields.push({
      name: "Article",
      value: `[Read on ChronicleAI](${params.contentUri})`,
      inline: true,
    });
  }

  return {
    username: "ChronicleAI",
    embeds: [
      {
        title: truncate(`🚨 ${params.title}`, 256),
        description: truncate(params.summary, 2000),
        color: 0x6366f1,
        fields,
        footer: { text: "ChronicleAI — Autonomous On-Chain Intelligence" },
        timestamp: params.publishedAt ?? new Date().toISOString(),
        url: params.contentUri,
      },
    ],
  };
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
  if (params.registryTxHash) {
    lines.push(
      `On-chain proof (KeeperHub): <code>${escapeTelegramHtml(params.registryTxHash)}</code>`,
    );
  }
  if (params.explorerUrl) {
    lines.push(`Explorer: ${escapeTelegramHtml(params.explorerUrl)}`);
  }
  if (params.contentUri) {
    lines.push(`Read more: ${escapeTelegramHtml(params.contentUri)}`);
  }

  return lines.join("\n");
}

export function buildDiscordDigestPayload(params: DigestBroadcastParams): Record<string, unknown> {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Report Date", value: params.reportDate, inline: true },
  ];

  if (params.registryTxHash) {
    fields.push({
      name: "Registry Tx (KeeperHub)",
      value: `\`${params.registryTxHash}\``,
      inline: false,
    });
  }
  if (params.explorerUrl) {
    fields.push({
      name: "Explorer",
      value: `[View on-chain proof](${params.explorerUrl})`,
      inline: true,
    });
  }
  if (params.contentUri) {
    fields.push({
      name: "Digest",
      value: `[Read full report](${params.contentUri})`,
      inline: true,
    });
  }

  return {
    username: "ChronicleAI",
    embeds: [
      {
        title: truncate(`📰 ${params.title}`, 256),
        description: truncate(params.summary, 2000),
        color: 0x8b5cf6,
        fields,
        footer: { text: "ChronicleAI Daily Digest" },
        url: params.contentUri,
      },
    ],
  };
}

export function buildTelegramDigestText(params: DigestBroadcastParams): string {
  const lines = [
    `📰 <b>ChronicleAI Daily Digest</b>`,
    `<b>${escapeTelegramHtml(truncate(params.title, 200))}</b>`,
    `Date: ${escapeTelegramHtml(params.reportDate)}`,
    "",
    escapeTelegramHtml(truncate(params.summary, 1500)),
  ];

  if (params.registryTxHash) {
    lines.push(
      "",
      `On-chain proof (KeeperHub): <code>${escapeTelegramHtml(params.registryTxHash)}</code>`,
    );
  }
  if (params.explorerUrl) {
    lines.push(`Explorer: ${escapeTelegramHtml(params.explorerUrl)}`);
  }
  if (params.contentUri) {
    lines.push(`Read more: ${escapeTelegramHtml(params.contentUri)}`);
  }

  return lines.join("\n");
}
