/** Base Sepolia block explorer helpers for on-chain proof links. */

const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org";

export function baseSepoliaTxUrl(txHash: string): string {
  return `${BASE_SEPOLIA_EXPLORER}/tx/${txHash}`;
}

export function baseSepoliaAddressUrl(address: string): string {
  return `${BASE_SEPOLIA_EXPLORER}/address/${address}`;
}

/** @deprecated Use baseSepoliaTxUrl — kept for any residual imports. */
export const sepoliaTxUrl = baseSepoliaTxUrl;
/** @deprecated Use baseSepoliaAddressUrl — kept for any residual imports. */
export const sepoliaAddressUrl = baseSepoliaAddressUrl;

export function truncateHash(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
