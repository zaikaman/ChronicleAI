// Late-bound digest run handler so US1 Telegram webhook can invoke digests
// after US2 routes construct DigestRunHandler on boot.

import type { DigestRunHandler } from "../keeperhub/digest-run-handler.ts";

let registered: DigestRunHandler | undefined;

export function registerDigestRunHandler(handler: DigestRunHandler): void {
  registered = handler;
}

export function getDigestRunHandler(): DigestRunHandler | undefined {
  return registered;
}
