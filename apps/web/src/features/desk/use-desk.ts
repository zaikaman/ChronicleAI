// Hooks for public desk endpoints — React Query (dedupe, cache, abort)

import type { PaginationMeta } from "@chronicleai/schemas";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { apiGetJson, isNotFoundError, toErrorMessage } from "../../lib/api.ts";
import { EMPTY_PAGINATION, normalizePaginationMeta } from "../../lib/pagination.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import type {
  DeskCapitalMove,
  DeskIntentSummary,
  DeskStatus,
  DeskTicketNarrative,
  DeskTicketProofs,
} from "./types.ts";

export interface DeskStatusState {
  data: DeskStatus | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDeskStatus(): DeskStatusState {
  const query = useQuery({
    queryKey: queryKeys.desk.status,
    queryFn: ({ signal }) => apiGetJson<DeskStatus>("/desk/status", { signal }),
    staleTime: 15_000,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading || (query.isFetching && !query.data),
    error: query.error ? toErrorMessage(query.error, "Failed to load desk status") : null,
    refetch: () => {
      void query.refetch();
    },
  };
}

export interface DeskIntentsState {
  intents: DeskIntentSummary[];
  pagination: PaginationMeta;
  page: number;
  setPage: (page: number) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDeskIntents(limit = 20): DeskIntentsState {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: queryKeys.desk.intents(page, limit),
    queryFn: async ({ signal }) => {
      const body = await apiGetJson<{
        intents: DeskIntentSummary[];
        pagination?: unknown;
      }>("/desk/intents", { signal, params: { page, limit } });
      const items = body.intents ?? [];
      return {
        intents: items,
        pagination: normalizePaginationMeta(body.pagination, {
          page,
          limit,
          itemCount: items.length,
        }),
      };
    },
    placeholderData: (previous) => previous,
  });

  const handleSetPage = useCallback((next: number) => {
    setPage(Math.max(1, next));
  }, []);

  return {
    intents: query.data?.intents ?? [],
    pagination: query.data?.pagination ?? { ...EMPTY_PAGINATION, limit },
    page,
    setPage: handleSetPage,
    isLoading: query.isLoading || (query.isFetching && !query.data),
    error: query.error ? toErrorMessage(query.error, "Failed to load desk intents") : null,
    refetch: () => {
      void query.refetch();
    },
  };
}

export interface DeskTicketsState {
  tickets: DeskTicketNarrative[];
  pagination: PaginationMeta;
  page: number;
  setPage: (page: number) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDeskTickets(
  limit = 15,
  options: { enabled?: boolean } = {},
): DeskTicketsState {
  const { enabled = true } = options;
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: queryKeys.desk.tickets(page, limit),
    queryFn: async ({ signal }) => {
      const body = await apiGetJson<{
        tickets: DeskTicketNarrative[];
        pagination?: unknown;
      }>("/desk/tickets", { signal, params: { page, limit } });
      const items = body.tickets ?? [];
      return {
        tickets: items,
        pagination: normalizePaginationMeta(body.pagination, {
          page,
          limit,
          itemCount: items.length,
        }),
      };
    },
    placeholderData: (previous) => previous,
    enabled,
  });

  const handleSetPage = useCallback((next: number) => {
    setPage(Math.max(1, next));
  }, []);

  return {
    tickets: query.data?.tickets ?? [],
    pagination: query.data?.pagination ?? { ...EMPTY_PAGINATION, limit },
    page,
    setPage: handleSetPage,
    isLoading: enabled && (query.isLoading || (query.isFetching && !query.data)),
    error: query.error ? toErrorMessage(query.error, "Failed to load desk tickets") : null,
    refetch: () => {
      void query.refetch();
    },
  };
}

export type DeskTicketDetailState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; error: string }
  | {
      status: "success";
      ticket: DeskTicketNarrative;
      proofs: DeskTicketProofs;
    };

export function useDeskTicket(ticketId: string | undefined): {
  state: DeskTicketDetailState;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: queryKeys.desk.ticket(ticketId ?? ""),
    enabled: Boolean(ticketId),
    queryFn: ({ signal }) =>
      apiGetJson<{ ticket: DeskTicketNarrative; proofs: DeskTicketProofs }>(
        `/desk/tickets/${encodeURIComponent(ticketId!)}`,
        { signal },
      ),
    retry: (failureCount, error) => {
      if (isNotFoundError(error)) return false;
      return failureCount < 1;
    },
  });

  let state: DeskTicketDetailState;
  if (!ticketId) {
    state = { status: "not-found" };
  } else if (query.isLoading || query.isPending) {
    state = { status: "loading" };
  } else if (query.error) {
    state = isNotFoundError(query.error)
      ? { status: "not-found" }
      : {
          status: "error",
          error: toErrorMessage(query.error, "Failed to load desk ticket"),
        };
  } else if (query.data) {
    state = {
      status: "success",
      ticket: query.data.ticket,
      proofs: query.data.proofs,
    };
  } else {
    state = { status: "loading" };
  }

  return {
    state,
    refetch: () => {
      void query.refetch();
    },
  };
}

export interface DeskCapitalMovesState {
  capitalMoves: DeskCapitalMove[];
  pagination: PaginationMeta;
  page: number;
  setPage: (page: number) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDeskCapitalMoves(
  limit = 15,
  options: { enabled?: boolean } = {},
): DeskCapitalMovesState {
  const { enabled = true } = options;
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: queryKeys.desk.capitalMoves(page, limit),
    queryFn: async ({ signal }) => {
      const body = await apiGetJson<{
        capitalMoves: DeskCapitalMove[];
        pagination?: unknown;
      }>("/desk/capital-moves", { signal, params: { page, limit } });
      const items = body.capitalMoves ?? [];
      return {
        capitalMoves: items,
        pagination: normalizePaginationMeta(body.pagination, {
          page,
          limit,
          itemCount: items.length,
        }),
      };
    },
    placeholderData: (previous) => previous,
    enabled,
  });

  const handleSetPage = useCallback((next: number) => {
    setPage(Math.max(1, next));
  }, []);

  return {
    capitalMoves: query.data?.capitalMoves ?? [],
    pagination: query.data?.pagination ?? { ...EMPTY_PAGINATION, limit },
    page,
    setPage: handleSetPage,
    isLoading: enabled && (query.isLoading || (query.isFetching && !query.data)),
    error: query.error ? toErrorMessage(query.error, "Failed to load capital moves") : null,
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * Resolve a related desk ticket for a public alert signal.
 * Tries signalHash match, then content-uri style source references.
 */
export function useRelatedDeskTicket(options: {
  ticketId?: string | null | undefined;
  keeperHubRunId?: string | null | undefined;
  txHash?: string | null | undefined;
  sourceEventHash?: string | null | undefined;
  sourceReferences?: string[] | undefined;
}): {
  ticket: DeskTicketNarrative | null;
  isLoading: boolean;
} {
  const { ticketId, keeperHubRunId, txHash, sourceEventHash, sourceReferences } = options;

  const fromRef = useMemo(() => {
    if (ticketId) return ticketId;
    const refs = sourceReferences ?? [];
    return (
      refs
        .map((r) => {
          try {
            const path = r.includes("://") ? new URL(r).pathname : r;
            const m = path.match(/\/desk\/tickets\/([A-Za-z0-9_-]+)/);
            return m?.[1] && m[1] !== "pending" ? m[1] : null;
          } catch {
            return null;
          }
        })
        .find((id): id is string => Boolean(id)) ?? null
    );
  }, [ticketId, sourceReferences]);

  const enabled = Boolean(ticketId || keeperHubRunId || txHash || sourceEventHash || fromRef);

  const query = useQuery({
    queryKey: queryKeys.desk.relatedTicket(
      sourceEventHash ?? null,
      fromRef || keeperHubRunId || txHash || null,
    ),
    enabled,
    queryFn: async ({ signal }) => {
      if (fromRef) {
        try {
          const body = await apiGetJson<{ ticket: DeskTicketNarrative }>(
            `/desk/tickets/${encodeURIComponent(fromRef)}`,
            { signal },
          );
          return body.ticket;
        } catch (err) {
          if (!isNotFoundError(err)) throw err;
        }
      }

      if (keeperHubRunId) {
        try {
          const body = await apiGetJson<{ tickets: DeskTicketNarrative[] }>("/desk/tickets", {
            signal,
            params: { keeperHubRunId },
          });
          if (body.tickets?.[0]) return body.tickets[0];
        } catch {
          // fall through
        }
      }

      if (txHash) {
        try {
          const body = await apiGetJson<{ tickets: DeskTicketNarrative[] }>("/desk/tickets", {
            signal,
            params: { txHash },
          });
          if (body.tickets?.[0]) return body.tickets[0];
        } catch {
          // fall through
        }
      }

      if (sourceEventHash) {
        try {
          const body = await apiGetJson<{ tickets: DeskTicketNarrative[] }>("/desk/tickets", {
            signal,
            params: { signalHash: sourceEventHash },
          });
          return body.tickets?.[0] ?? null;
        } catch {
          return null;
        }
      }

      return null;
    },
    staleTime: 60_000,
  });

  return {
    ticket: query.data ?? null,
    isLoading: enabled && (query.isLoading || query.isPending),
  };
}
