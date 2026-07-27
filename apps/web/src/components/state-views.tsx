// Accessible state view components for loading, empty, error, and retry states

import type React from "react";

// ── Loading State ─────────────────────────────────────
interface LoadingStateProps {
  message?: string;
  "data-testid"?: string;
}

export function LoadingState({
  message = "Loading...",
  "data-testid": dataTestId = "loading-state",
}: LoadingStateProps): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={dataTestId}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1rem",
        padding: "3rem",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: "24px",
          height: "24px",
          border: "2px solid var(--border-primary)",
          borderTopColor: "var(--accent-primary)",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
        aria-hidden="true"
      />
      <span className="text-secondary" style={{ fontSize: "var(--font-size-sm)" }}>
        {message}
      </span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────
interface EmptyStateProps {
  title: string;
  description?: string;
  "data-testid"?: string;
}

export function EmptyState({
  title,
  description,
  "data-testid": dataTestId = "empty-state",
}: EmptyStateProps): React.ReactElement {
  return (
    <div
      role="status"
      data-testid={dataTestId}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.5rem",
        padding: "3rem",
        textAlign: "center",
      }}
    >
      <h3 style={{ fontSize: "var(--font-size-lg)", color: "var(--fg-primary)" }}>{title}</h3>
      {description ? (
        <p className="text-secondary" style={{ fontSize: "var(--font-size-sm)", maxWidth: "400px" }}>
          {description}
        </p>
      ) : null}
    </div>
  );
}

// ── Error State ───────────────────────────────────────
interface ErrorStateProps {
  title?: string;
  message: string;
  "data-testid"?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  "data-testid": dataTestId = "error-state",
}: ErrorStateProps): React.ReactElement {
  return (
    <div
      role="alert"
      data-testid={dataTestId}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.5rem",
        padding: "2rem",
        textAlign: "center",
        background: "var(--bg-glass)",
        border: "1px solid rgba(239, 68, 68, 0.2)",
        borderRadius: "12px",
      }}
    >
      <h3 style={{ fontSize: "var(--font-size-lg)", color: "var(--accent-error)" }}>{title}</h3>
      <p className="text-secondary" style={{ fontSize: "var(--font-size-sm)" }}>{message}</p>
    </div>
  );
}

// ── Retry State ───────────────────────────────────────
interface RetryStateProps {
  title?: string;
  message: string;
  onRetry: () => void;
  "data-testid"?: string;
}

export function RetryState({
  title = "Failed to load",
  message,
  onRetry,
  "data-testid": dataTestId = "retry-state",
}: RetryStateProps): React.ReactElement {
  return (
    <div
      role="alert"
      data-testid={dataTestId}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
        background: "var(--bg-glass)",
        border: "1px solid rgba(239, 68, 68, 0.2)",
        borderRadius: "12px",
      }}
    >
      <h3 style={{ fontSize: "var(--font-size-lg)", color: "var(--accent-error)" }}>{title}</h3>
      <p className="text-secondary" style={{ fontSize: "var(--font-size-sm)" }}>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        data-testid="retry-button"
        style={{
          padding: "0.5rem 1.25rem",
          background: "var(--accent-primary)",
          color: "white",
          border: "none",
          borderRadius: "8px",
          cursor: "pointer",
          fontSize: "var(--font-size-sm)",
          fontWeight: 500,
          transition: "background 0.15s ease",
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = "var(--accent-primary-hover)";
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = "var(--accent-primary)";
        }}
      >
        Retry
      </button>
    </div>
  );
}
