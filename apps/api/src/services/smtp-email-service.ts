// SMTP email subscription dispatch service using Nodemailer
// Digest recipients are resolved from active paid x402 newsletter subscriptions
// (premium entitlement). Alert recipients come from free email_subscribers.

export interface SmtpSendResult {
  success: boolean;
  errorMessage?: string;
  recipientsReached: number;
}

/** Channel used when resolving active subscriber emails from the database. */
export type SmtpRecipientChannel = "digest" | "alert";

export type ResolveSmtpRecipients = (channel: SmtpRecipientChannel) => Promise<string[]>;

export interface SmtpEmailService {
  /** Send a digest bulletin to all active digest subscribers. */
  sendDigestBulletin(params: {
    title: string;
    summary: string;
    highlights: string[];
    analysis: string | undefined;
    reportDate: string;
    registryTxHash: string | undefined;
    contentUri: string | undefined;
  }): Promise<SmtpSendResult>;

  /** Send an alert notification to all active alert subscribers. */
  sendAlertNotification(params: {
    title: string;
    summary: string;
    eventType: string;
    publishedAt: string;
  }): Promise<SmtpSendResult>;
}

export function createSmtpEmailService(config: {
  host: string | undefined;
  port: number | undefined;
  user: string | undefined;
  pass: string | undefined;
  fromAddress: string | undefined;
  /** Resolves active subscriber emails from the database (or test double). */
  resolveRecipients: ResolveSmtpRecipients;
  /** Public API origin used for List-Unsubscribe links when available. */
  publicApiOrigin?: string | undefined;
}): SmtpEmailService {
  const { host, port, user, pass, fromAddress, resolveRecipients, publicApiOrigin } = config;

  function isSmtpConfigured(): boolean {
    return Boolean(host && user && pass && fromAddress);
  }

  // Build an HTML email from the digest data
  function buildDigestHtml(params: {
    title: string;
    summary: string;
    highlights: string[];
    analysis: string | undefined;
    reportDate: string;
    registryTxHash: string | undefined;
    contentUri: string | undefined;
  }): string {
    const highlightsHtml = params.highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join("");

    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #6366f1;">${escapeHtml(params.title)}</h1>
        <p style="color: #52525b; font-size: 14px;">Report Date: ${escapeHtml(params.reportDate)}</p>
        <hr style="border: none; border-top: 1px solid #e4e4e7;" />
        <p>${escapeHtml(params.summary)}</p>
        <h2 style="color: #27272a;">Key Highlights</h2>
        <ul>${highlightsHtml}</ul>
        ${params.analysis ? `<h2 style="color: #27272a;">Analysis</h2><p>${escapeHtml(params.analysis)}</p>` : ""}
        ${params.registryTxHash ? `<p style="font-size: 12px; color: #a1a1aa;">On-chain proof: ${escapeHtml(params.registryTxHash)}</p>` : ""}
        ${params.contentUri ? `<p><a href="${escapeHtml(params.contentUri)}" style="color: #6366f1;">Read full digest on ChronicleAI</a></p>` : ""}
        <hr style="border: none; border-top: 1px solid #e4e4e7;" />
        <p style="font-size: 12px; color: #a1a1aa;">ChronicleAI — Autonomous On-Chain Intelligence</p>
        <p style="font-size: 11px; color: #a1a1aa;">You received this premium digest because your monthly x402 newsletter subscription is active. Manage or cancel at ChronicleAI → Newsletter subscription.</p>
      </body>
      </html>
    `;
  }

  function buildAlertHtml(params: {
    title: string;
    summary: string;
    eventType: string;
    publishedAt: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #6366f1;">🚨 Public Alert: ${escapeHtml(params.eventType)}</h2>
        <h3>${escapeHtml(params.title)}</h3>
        <p>${escapeHtml(params.summary)}</p>
        <p style="font-size: 12px; color: #a1a1aa;">Published: ${escapeHtml(params.publishedAt)}</p>
        <hr style="border: none; border-top: 1px solid #e4e4e7;" />
        <p style="font-size: 12px; color: #a1a1aa;">ChronicleAI — Autonomous On-Chain Intelligence</p>
      </body>
      </html>
    `;
  }

  function buildListUnsubscribeHeaders(): Record<string, string> | undefined {
    if (!publicApiOrigin) return undefined;
    const origin = publicApiOrigin.replace(/\/+$/, "");
    // One-click requires a per-user token URL; generic endpoint documents the API.
    return {
      "List-Unsubscribe": `<${origin}/subscribers/unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  async function sendToSubscribers(params: {
    channel: SmtpRecipientChannel;
    subject: string;
    html: string;
  }): Promise<SmtpSendResult> {
    if (!isSmtpConfigured()) {
      return {
        success: false,
        errorMessage: "SMTP not configured (missing host, user, pass, or from address)",
        recipientsReached: 0,
      };
    }

    let recipients: string[];
    try {
      recipients = await resolveRecipients(params.channel);
    } catch (error) {
      return {
        success: false,
        errorMessage:
          error instanceof Error
            ? `Failed to resolve subscribers: ${error.message}`
            : "Failed to resolve subscribers",
        recipientsReached: 0,
      };
    }

    const uniqueRecipients = dedupeEmails(recipients);
    if (uniqueRecipients.length === 0) {
      // No opted-in users yet — not a delivery failure; on-chain/UI publication still succeeds.
      return {
        success: true,
        recipientsReached: 0,
      };
    }

    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.default.createTransport({
        host,
        port: port ?? 587,
        secure: port === 465,
        auth: { user, pass },
      });

      const headers = buildListUnsubscribeHeaders();

      // Use BCC so subscriber emails are not exposed to each other.
      const info = await transporter.sendMail({
        from: fromAddress,
        to: fromAddress,
        bcc: uniqueRecipients,
        subject: params.subject,
        html: params.html,
        ...(headers ? { headers } : {}),
      });

      const recipientsReached = Array.isArray(info.accepted)
        ? info.accepted.length
        : uniqueRecipients.length;

      return {
        success: true,
        recipientsReached,
      };
    } catch (error) {
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : "Unknown SMTP error",
        recipientsReached: 0,
      };
    }
  }

  return {
    async sendDigestBulletin(params) {
      return sendToSubscribers({
        channel: "digest",
        subject: `ChronicleAI Daily Digest — ${params.reportDate}`,
        html: buildDigestHtml(params),
      });
    },

    async sendAlertNotification(params) {
      return sendToSubscribers({
        channel: "alert",
        subject: `ChronicleAI Alert: ${params.title}`,
        html: buildAlertHtml(params),
      });
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of emails) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
