// Inline / small-area loading indicator.
// Use for buttons, payment steps, wallet connect, and compact panel waits.
// Prefer page skeletons for full-route or list content loading.

import type { ReactElement, ReactNode } from "react";

export type SpinnerSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASS: Record<SpinnerSize, string> = {
  xs: "spinner--xs",
  sm: "spinner--sm",
  md: "spinner--md",
  lg: "spinner--lg",
};

interface SpinnerProps {
  size?: SpinnerSize;
  /** Accessible label; defaults to "Loading". Hidden visually unless `label` is shown. */
  label?: string;
  /** When true, shows the label text next to the spinner. */
  showLabel?: boolean;
  className?: string;
  "data-testid"?: string;
}

/**
 * Accent-tipped ring spinner. Calm, product-native, reduced-motion safe via CSS.
 */
export function Spinner({
  size = "md",
  label = "Loading",
  showLabel = false,
  className = "",
  "data-testid": dataTestId = "spinner",
}: SpinnerProps): ReactElement {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid={dataTestId}
      className={`spinner-wrap ${showLabel ? "spinner-wrap--labeled" : ""} ${className}`.trim()}
    >
      <span className={`spinner ${SIZE_CLASS[size]}`} aria-hidden="true" />
      {showLabel ? <span className="spinner-label">{label}</span> : null}
      <span className="sr-only">{label}</span>
    </span>
  );
}

interface SpinnerBlockProps {
  message?: string;
  size?: SpinnerSize;
  className?: string;
  "data-testid"?: string;
}

/**
 * Centered spinner + message for small panels / modal steps (not full pages).
 */
export function SpinnerBlock({
  message = "Loading…",
  size = "md",
  className = "",
  "data-testid": dataTestId = "spinner-block",
}: SpinnerBlockProps): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid={dataTestId}
      className={`flex flex-col items-center justify-center gap-3 py-8 px-4 text-center ${className}`.trim()}
    >
      <Spinner size={size} label={message} />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  );
}

interface ButtonSpinnerProps {
  children: ReactNode;
  loading?: boolean;
  size?: SpinnerSize;
  className?: string;
}

/**
 * Inline layout for button contents: spinner + label when busy.
 */
export function ButtonSpinner({
  children,
  loading = false,
  size = "xs",
  className = "",
}: ButtonSpinnerProps): ReactElement {
  if (!loading) {
    return <>{children}</>;
  }
  return (
    <span className={`inline-flex items-center justify-center gap-2 ${className}`.trim()}>
      <Spinner size={size} label="Loading" />
      <span>{children}</span>
    </span>
  );
}
