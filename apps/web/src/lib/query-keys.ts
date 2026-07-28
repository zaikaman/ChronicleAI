// Central query-key factory — keeps React Query cache keys consistent across features.

export const queryKeys = {
  alerts: {
    all: ["alerts"] as const,
    list: (page: number, limit: number) => ["alerts", "list", page, limit] as const,
    detail: (alertId: string) => ["alerts", "detail", alertId] as const,
  },
  digests: {
    all: ["digests"] as const,
    latest: ["digests", "latest"] as const,
    detail: (digestId: string) => ["digests", "detail", digestId] as const,
  },
  activity: {
    all: ["activity"] as const,
    summary: ["activity", "summary"] as const,
    executionLogs: (page: number, limit: number) =>
      ["activity", "execution-logs", page, limit] as const,
    payments: (page: number, limit: number) =>
      ["activity", "payments", page, limit] as const,
    payouts: (page: number, limit: number) =>
      ["activity", "payouts", page, limit] as const,
  },
  desk: {
    all: ["desk"] as const,
    status: ["desk", "status"] as const,
    intents: (page: number, limit: number) => ["desk", "intents", page, limit] as const,
    tickets: (page: number, limit: number) => ["desk", "tickets", page, limit] as const,
    ticket: (ticketId: string) => ["desk", "ticket", ticketId] as const,
    capitalMoves: (page: number, limit: number) =>
      ["desk", "capital-moves", page, limit] as const,
    relatedTicket: (signalHash: string | null | undefined, refId: string | null) =>
      ["desk", "related-ticket", signalHash ?? null, refId] as const,
  },
  premium: {
    all: ["premium"] as const,
    teasers: ["premium", "teasers"] as const,
    watches: ["premium", "watches"] as const,
  },
  affiliates: {
    all: ["affiliates"] as const,
    me: (wallet: string) => ["affiliates", "me", wallet.toLowerCase()] as const,
  },
} as const;
