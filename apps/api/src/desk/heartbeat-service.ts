/**
 * Desk heartbeat service: liveness for kill-switch eligibility.
 */

import type { DeskHeartbeatRepository, DeskHeartbeatRow } from "@chronicleai/db";
import { DESK_HEARTBEAT_RETAIN_COUNT } from "@chronicleai/db";
import type { DeskHeartbeatSource } from "@chronicleai/schemas";
import { deskLog } from "../lib/logger.ts";
import type { HeartbeatStatus } from "./types.ts";

export interface HeartbeatService {
  /** Record a heartbeat from api / scheduler / workflow. */
  touch(source: DeskHeartbeatSource): Promise<DeskHeartbeatRow>;
  /** Latest heartbeat row, if any. */
  getLatest(): Promise<DeskHeartbeatRow | null>;
  /**
   * Status relative to killHeartbeatMs.
   * killEligible when no heartbeat or age > threshold.
   */
  getStatus(nowMs?: number): Promise<HeartbeatStatus>;
  isStale(nowMs?: number): Promise<boolean>;
  /** P2-9: prune old heartbeats (keep latest N). */
  prune(keepCount?: number): Promise<number>;
}

export function createHeartbeatService(deps: {
  heartbeats: DeskHeartbeatRepository;
  killHeartbeatMs: number;
}): HeartbeatService {
  const { heartbeats, killHeartbeatMs } = deps;
  /** Prune at most once per process every N touches to avoid write amplification. */
  let touchesSincePrune = 0;
  const PRUNE_EVERY_TOUCHES = 50;

  return {
    async touch(source) {
      const result = await heartbeats.touch(source);
      if (!result.ok) throw result.error;

      touchesSincePrune += 1;
      if (touchesSincePrune >= PRUNE_EVERY_TOUCHES) {
        touchesSincePrune = 0;
        // Fire-and-forget retention (P2-9); never fail the heartbeat path.
        void heartbeats.pruneKeepLatest(DESK_HEARTBEAT_RETAIN_COUNT).then((pruned) => {
          if (pruned.ok && pruned.value > 0) {
            deskLog.debug("heartbeat prune", { deleted: pruned.value });
          }
        });
      }

      return result.value;
    },

    async getLatest() {
      const result = await heartbeats.findLatest();
      if (!result.ok) throw result.error;
      return result.value;
    },

    async getStatus(nowMs = Date.now()) {
      const latest = await heartbeats.findLatest();
      if (!latest.ok) throw latest.error;

      if (!latest.value) {
        return {
          lastSeenAt: null,
          ageMs: null,
          stale: true,
          killEligible: true,
          source: null,
        };
      }

      const lastSeenAt = latest.value.created_at;
      const ageMs = nowMs - new Date(lastSeenAt).getTime();
      const stale = ageMs > killHeartbeatMs;

      return {
        lastSeenAt,
        ageMs,
        stale,
        killEligible: stale,
        source: latest.value.source as DeskHeartbeatSource,
      };
    },

    async isStale(nowMs = Date.now()) {
      const result = await heartbeats.isStale(killHeartbeatMs, new Date(nowMs));
      if (!result.ok) throw result.error;
      return result.value;
    },

    async prune(keepCount = DESK_HEARTBEAT_RETAIN_COUNT) {
      const result = await heartbeats.pruneKeepLatest(keepCount);
      if (!result.ok) throw result.error;
      return result.value;
    },
  };
}
