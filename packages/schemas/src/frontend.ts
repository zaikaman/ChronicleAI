// Frontend-specific view models and route definitions
import type { Confidence, EventType } from "./domain.ts";

// ── Navigation Route IDs ────────────────────────────────
export type RouteId = "home" | "alerts" | "digests" | "premium" | "operator";

export interface RouteDefinition {
  id: RouteId;
  path: string;
  label: string;
  requiresAuth?: boolean;
}

export const ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: "home", path: "/", label: "Home" },
  { id: "alerts", path: "/alerts", label: "Alerts" },
  { id: "digests", path: "/digests/latest", label: "Latest Digest" },
  { id: "premium", path: "/premium", label: "Premium" },
  { id: "operator", path: "/operator", label: "Operator", requiresAuth: true },
];

// ── Loading / Error / Empty State Models ────────────────
export type AsyncState<T, E = Error> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: E };

export interface LoadingViewModel {
  message?: string;
}

export interface ErrorViewModel {
  title: string;
  message: string;
  retry?: () => void;
}

export interface EmptyViewModel {
  title: string;
  description?: string;
}

// ── Badge and Metric Display Models ─────────────────────
export interface BadgeModel {
  label: string;
  variant: "default" | "success" | "warning" | "error" | "info";
}

export interface MetricModel {
  label: string;
  value: string | number;
  change?: {
    direction: "up" | "down" | "neutral";
    value: string;
  };
}

export interface SourceReferenceModel {
  label: string;
  reference: string;
  href?: string;
}

// ── Alert Card View Model ───────────────────────────────
export interface AlertCardViewModel {
  id: string;
  title: string;
  summary: string;
  eventType: EventType;
  magnitude?: string;
  confidence: Confidence;
  publishedAt: string;
  sources: SourceReferenceModel[];
}

// ── Digest View Model ───────────────────────────────────
export interface DigestViewModel {
  id: string;
  reportDate: string;
  title: string;
  summary: string;
  highlights: string[];
  analysis: string;
}
