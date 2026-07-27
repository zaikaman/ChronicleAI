// SMTP email subscription dispatch service using Nodemailer

export interface SmtpSendResult {
  success: boolean;
  errorMessage?: string;
  recipientsReached: number;
}

export interface SmtpEmailService {
  /** Send a digest bulletin to all subscribers. */
  sendDigestBulletin(params: {
    title: string;
    summary: string;
    highlights: string[];
    analysis: string | undefined;
    reportDate: string;
    registryTxHash: string | undefined;
    contentUri: string | undefined;
  }): Promise<SmtpSendResult>;

  /** Send an alert notification to all subscribers. */
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
  subscriberList: string[] | undefined;
}): SmtpEmailService {
  const { host, port, user, pass, fromAddress, subscriberList } = config;

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
    const highlightsHtml = params.highlights.map((h) => `<li>${h}</li>`).join("");

    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #6366f1;">${params.title}</h1>
        <p style="color: #52525b; font-size: 14px;">Report Date: ${params.reportDate}</p>
        <hr style="border: none; border-top: 1px solid #e4e4e7;" />
        <p>${params.summary}</p>
        <h2 style="color: #27272a;">Key Highlights</h2>
        <ul>${highlightsHtml}</ul>
        ${params.analysis ? `<h2 style="color: #27272a;">Analysis</h2><p>${params.analysis}</p>` : ""}
        ${params.registryTxHash ? `<p style="font-size: 12px; color: #a1a1aa;">On-chain proof: ${params.registryTxHash}</p>` : ""}
        ${params.contentUri ? `<p><a href="${params.contentUri}" style="color: #6366f1;">Read full digest on ChronicleAI</a></p>` : ""}
        <hr style="border: none; border-top: 1px solid #e4e4e7;" />
        <p style="font-size: 12px; color: #a1a1aa;">ChronicleAI — Autonomous On-Chain Intelligence</p>
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
        <h2 style="color: #6366f1;">🚨 Public Alert: ${params.eventType}</h2>
        <h3>${params.title}</h3>
        <p>${params.summary}</p>
        <p style="font-size: 12px; color: #a1a1aa;">Published: ${params.publishedAt}</p>
        <hr style="border: none; border-top: 1px solid #e4e4e7;" />
        <p style="font-size: 12px; color: #a1a1aa;">ChronicleAI — Autonomous On-Chain Intelligence</p>
      </body>
      </html>
    `;
  }

  return {
    async sendDigestBulletin(params) {
      if (!host || !user || !pass || !fromAddress) {
        return {
          success: false,
          errorMessage: "SMTP not configured (missing host, user, pass, or from address)",
          recipientsReached: 0,
        };
      }

      const recipients = subscriberList ?? [];
      if (recipients.length === 0) {
        return {
          success: false,
          errorMessage: "No subscribers configured",
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

        const html = buildDigestHtml(params);

        const info = await transporter.sendMail({
          from: fromAddress,
          to: recipients.join(", "),
          subject: `ChronicleAI Daily Digest — ${params.reportDate}`,
          html,
        });

        const recipientsReached = Array.isArray(info.accepted)
          ? info.accepted.length
          : recipients.length;

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
    },

    async sendAlertNotification(params) {
      if (!host || !user || !pass || !fromAddress) {
        return {
          success: false,
          errorMessage: "SMTP not configured",
          recipientsReached: 0,
        };
      }

      const recipients = subscriberList ?? [];
      if (recipients.length === 0) {
        return {
          success: false,
          errorMessage: "No subscribers configured",
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

        const html = buildAlertHtml(params);

        await transporter.sendMail({
          from: fromAddress,
          to: recipients.join(", "),
          subject: `ChronicleAI Alert: ${params.title}`,
          html,
        });

        return {
          success: true,
          recipientsReached: recipients.length,
        };
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown SMTP error",
          recipientsReached: 0,
        };
      }
    },
  };
}
