// Module-level Chronicle Pass registry.
// The pass/auth services are constructed in US2 (where the x402 adapter and
// settlement service live) and registered here so US3 premium routes can
// resolve wallet sessions and pass entitlement per request.

import type { ChroniclePassAuthService } from "./chronicle-pass-auth-service.ts";
import type { ChroniclePassService } from "./chronicle-pass-service.ts";

let passService: ChroniclePassService | null = null;
let authService: ChroniclePassAuthService | null = null;

export function registerChroniclePassService(service: ChroniclePassService): void {
  passService = service;
}

export function registerChroniclePassAuthService(service: ChroniclePassAuthService): void {
  authService = service;
}

export function getChroniclePassService(): ChroniclePassService | null {
  return passService;
}

export function getChroniclePassAuthService(): ChroniclePassAuthService | null {
  return authService;
}
