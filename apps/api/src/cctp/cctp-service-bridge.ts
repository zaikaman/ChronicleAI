/**
 * Process-local CCTP service/repo handles so Activity (US4) and other modules
 * can read dual-rail balances and paginated rebalance history without circular
 * imports through routes/index.
 */

import type { CctpRebalanceRepository } from "@chronicleai/db";
import type { CctpRebalanceService } from "./rebalance-service.ts";

let registered: CctpRebalanceService | null = null;
let registeredRepo: CctpRebalanceRepository | null = null;

export function registerCctpService(service: CctpRebalanceService | null): void {
  registered = service;
}

export function getCctpService(): CctpRebalanceService | null {
  return registered;
}

export function registerCctpRebalanceRepo(
  repo: CctpRebalanceRepository | null,
): void {
  registeredRepo = repo;
}

export function getCctpRebalanceRepo(): CctpRebalanceRepository | null {
  return registeredRepo;
}
