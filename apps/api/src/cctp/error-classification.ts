/**
 * Classify CCTP / chain / Iris failures for stuck detection, retries, and logs.
 */

import { IrisHttpError } from "./iris-client.ts";
import type { CctpErrorClass } from "./types.ts";

export interface ClassifiedCctpError {
  class: CctpErrorClass;
  message: string;
  /** Whether the service may retry the same row (mint path). */
  retryable: boolean;
  /** Prefer stuck over failed for resume later. */
  preferStuck: boolean;
}

export function classifyCctpError(error: unknown): ClassifiedCctpError {
  if (error instanceof IrisHttpError) {
    if (error.status === 429) {
      return {
        class: "iris_429",
        message: error.message,
        retryable: true,
        preferStuck: true,
      };
    }
    if (error.status >= 500) {
      return {
        class: "iris_5xx",
        message: error.message,
        retryable: true,
        preferStuck: true,
      };
    }
    return {
      class: "iris_parse",
      message: error.message,
      retryable: false,
      preferStuck: false,
    };
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("insufficient funds") ||
    lower.includes("insufficient balance") ||
    lower.includes("gas required exceeds") ||
    lower.includes("out of gas") ||
    lower.includes("intrinsic gas too low") ||
    (lower.includes("gas") && lower.includes("too low"))
  ) {
    return {
      class: "gas",
      message,
      retryable: false,
      preferStuck: false,
    };
  }

  if (
    lower.includes("allowance") ||
    lower.includes("transfer amount exceeds allowance") ||
    lower.includes("erc20: insufficient allowance")
  ) {
    return {
      class: "allowance",
      message,
      retryable: false,
      preferStuck: false,
    };
  }

  if (
    lower.includes("nonce already used") ||
    lower.includes("nonce is already used") ||
    lower.includes("message already received") ||
    lower.includes("already used") ||
    lower.includes("usednonces")
  ) {
    return {
      class: "nonce_used",
      message,
      retryable: false,
      preferStuck: false,
    };
  }

  if (
    lower.includes("execution reverted") ||
    lower.includes("call exception") ||
    lower.includes("revert") ||
    lower.includes("require(false)")
  ) {
    return {
      class: "revert",
      message,
      retryable: true,
      preferStuck: false,
    };
  }

  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("deadline")
  ) {
    return {
      class: "iris_timeout",
      message,
      retryable: true,
      preferStuck: true,
    };
  }

  if (
    lower.includes("econnreset") ||
    lower.includes("enotfound") ||
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("socket")
  ) {
    return {
      class: "network",
      message,
      retryable: true,
      preferStuck: true,
    };
  }

  if (
    lower.includes("invalid") ||
    lower.includes("validation") ||
    lower.includes("must be")
  ) {
    return {
      class: "validation",
      message,
      retryable: false,
      preferStuck: false,
    };
  }

  return {
    class: "unknown",
    message,
    retryable: true,
    preferStuck: false,
  };
}

/** Truncate error text for DB error_message column. */
export function truncateErrorMessage(message: string, max = 1800): string {
  const t = message.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 3)}...`;
}
