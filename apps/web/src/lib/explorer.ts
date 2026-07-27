/** Sepolia block explorer helpers for on-chain proof links. */

const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";

export function sepoliaTxUrl(txHash: string): string {
  return `${SEPOLIA_EXPLORER}/tx/${txHash}`;
}

export function sepoliaAddressUrl(address: string): string {
  return `${SEPOLIA_EXPLORER}/address/${address}`;
}

export function truncateHash(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
