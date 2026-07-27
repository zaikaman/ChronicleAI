// Operator Notification Service
// Sends low-balance warnings using configurable notification destinations
// Can be extended with Discord, Telegram, email, or webhook targets

import type { ExecutionLogRepository } from "@chronicleai/db";

export interface NotificationDestination {
  type: "log" | "webhook" | "email";
  target?: string;
}

export interface OperatorNotificationService {
  /**
   * Send a low-balance warning notification.
   */
  sendLowBalanceWarning(params: {
    availableBalance: number;
    safetyBuffer: number;
    deficitPercentage: number;
    status: string;
  }): Promise<{ delivered: boolean; destinations: string[] }>;

  /**
   * Send a revenue routing notification.
   */
  sendRevenueRoutingNotification(params: {
    totalRevenue: number;
    creatorRecoveryAmount: number;
    referralRewardsAmount: number;
    payoutIds: string[];
    registryTxHash?: string;
  }): Promise<{ delivered: boolean; destinations: string[] }>;
}

export function createOperatorNotificationService(
  execLogRepo: ExecutionLogRepository,
  destinations: NotificationDestination[] = [{ type: "log" }],
): OperatorNotificationService {
  const defaultDestinations: NotificationDestination[] = destinations;

  return {
    async sendLowBalanceWarning(params) {
      const delivered: string[] = [];

      for (const dest of defaultDestinations) {
        if (dest.type === "log") {
          await execLogRepo.append({
            action_type: "operator_notification",
            entity_type: "treasury_snapshot",
            entity_id: null,
            status: "succeeded",
            message: `Low balance warning: ${params.status} ($${params.availableBalance} available, $${params.safetyBuffer} buffer, ${params.deficitPercentage.toFixed(1)}% deficit)`,
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
          try {
            await fetch(dest.target, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "low_balance_warning",
                ...params,
              }),
            });
            delivered.push(`webhook:${dest.target}`);
          } catch {
            // Webhook delivery failed, log but don't throw
            await execLogRepo.append({
              action_type: "operator_notification",
              entity_type: "treasury_snapshot",
              entity_id: null,
              status: "failed",
              message: `Failed to deliver low balance warning to webhook: ${dest.target}`,
              details: { notification_type: "low_balance_warning" },
            });
          }
        }
      }

      return { delivered: delivered.length > 0, destinations: delivered };
    },

    async sendRevenueRoutingNotification(params) {
      const delivered: string[] = [];

      for (const dest of defaultDestinations) {
        if (dest.type === "log") {
          await execLogRepo.append({
            action_type: "operator_notification",
            entity_type: "payout_record",
            entity_id: null,
            status: "succeeded",
            message: `Revenue routed: $${params.creatorRecoveryAmount} creator recovery, $${params.referralRewardsAmount} referral rewards`,
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
          try {
            await fetch(dest.target, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "revenue_routing",
                ...params,
              }),
            });
            delivered.push(`webhook:${dest.target}`);
          } catch {
            await execLogRepo.append({
              action_type: "operator_notification",
              entity_type: "payout_record",
              entity_id: null,
              status: "failed",
              message: `Failed to deliver revenue routing notification to webhook: ${dest.target}`,
              details: { notification_type: "revenue_routing" },
            });
          }
        }
      }

      return { delivered: delivered.length > 0, destinations: delivered };
    },
  };
}
