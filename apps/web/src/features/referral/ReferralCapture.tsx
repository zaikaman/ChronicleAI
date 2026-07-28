// Captures ?ref= and attributes the connected wallet to an affiliate (first-touch).

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useWallet } from "../wallet";
import {
  attributeReferralOnConnect,
  captureReferralFromSearch,
} from "../../lib/referral.ts";

/**
 * Mount once under the app shell. Side-effect only — renders nothing.
 */
export function ReferralCapture(): null {
  const location = useLocation();
  const { address, isConnected } = useWallet();
  const lastAttributed = useRef<string | null>(null);

  useEffect(() => {
    captureReferralFromSearch(location.search);
  }, [location.search]);

  useEffect(() => {
    if (!isConnected || !address) return;
    const key = address.toLowerCase();
    if (lastAttributed.current === key) return;
    lastAttributed.current = key;
    void attributeReferralOnConnect(address);
  }, [isConnected, address]);

  return null;
}
