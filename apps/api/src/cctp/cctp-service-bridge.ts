/**
 * Process-local CCTP service handle so Activity (US4) and other modules can
 * read dual-rail balances without circular imports through routes/index.
 */

import type { CctpRebalanceService } from "./rebalance-service.ts";

let registered: CctpRebalanceService | null = null;

export function registerCctpService(service: CctpRebalanceService | null): void {
  registered = service;
}

export function getCctpService(): CctpRebalanceService | null {
  return registered;
}
