// Hook for public newsletter subscribe (footer / landing)

import { useCallback, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export type SubscribeStatus = "idle" | "loading" | "success" | "error";

export interface UseSubscribeResult {
  status: SubscribeStatus;
  message: string | null;
  subscribe: (email: string) => Promise<boolean>;
  reset: () => void;
}

export function useSubscribe(): UseSubscribeResult {
  const [status, setStatus] = useState<SubscribeStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setMessage(null);
  }, []);

  const subscribe = useCallback(async (email: string): Promise<boolean> => {
    const trimmed = email.trim();
    if (!trimmed) {
      setStatus("error");
      setMessage("Please enter your email address.");
      return false;
    }

    setStatus("loading");
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE}/subscribers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          source: "web",
          receivesDigests: true,
          receivesAlerts: true,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        reactivated?: boolean;
        email?: string;
      };

      if (!response.ok) {
        setStatus("error");
        setMessage(body.error ?? "Could not subscribe. Please try again.");
        return false;
      }

      setStatus("success");
      setMessage(
        body.reactivated
          ? "Welcome back — your subscription is active again."
          : "You're subscribed. Digests and alerts will arrive by email.",
      );
      return true;
    } catch {
      setStatus("error");
      setMessage("Network error. Check your connection and try again.");
      return false;
    }
  }, []);

  return { status, message, subscribe, reset };
}
