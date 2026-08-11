// Late-bound Watch handler so the US1 Telegram webhook can invoke the US3
// Sponsored Watch service after US3 constructs it during application boot.

import type { TelegramWatchRequestHandler } from "./telegram-watch-ingest-service.ts";

let registered: TelegramWatchRequestHandler | undefined;

export function registerTelegramWatchRequestHandler(
  handler: TelegramWatchRequestHandler,
): void {
  registered = handler;
}

export function getTelegramWatchRequestHandler(): TelegramWatchRequestHandler | undefined {
  return registered;
}

