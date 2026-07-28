// Shared EIP-712 x402 settlement signing for premium items and monthly newsletter.
// Challenge EIP-712 domain is authoritative for chain (Base Sepolia by default).

import { isEvmAddress, knownChainConfig } from "./chains.ts";
import type { WalletContextValue } from "./types.ts";

/**
 * Build an EIP-712 typed-data payload and sign it with the connected wallet.
 * Ensures the wallet is on the challenge chain before signing.
 * Returns a JSON settlement reference string for the API.
 */
export async function signX402Settlement(
  challengeData: Record<string, unknown>,
  wallet: WalletContextValue,
): Promise<string> {
  let from = wallet.address;
  if (!wallet.isConnected || !from) {
    from = await wallet.connect();
  }
  if (!from || !isEvmAddress(from)) {
    throw new Error("Wallet did not return a valid account.");
  }

  const domain = challengeData.domain as Record<string, unknown>;
  const types = challengeData.types as {
    TransferWithAuthorization: Array<{ name: string; type: string }>;
  };

  // Prefer chain from challenge domain so client and server stay aligned.
  const domainChainId =
    typeof domain.chainId === "number"
      ? domain.chainId
      : typeof domain.chainId === "string"
        ? Number(domain.chainId)
        : wallet.targetChain.chainId;

  if (Number.isInteger(domainChainId) && domainChainId > 0) {
    const known = knownChainConfig(domainChainId);
    await wallet.ensureChain(
      known ?? {
        ...wallet.targetChain,
        chainId: domainChainId,
        chainIdHex: `0x${domainChainId.toString(16)}`,
        name:
          domainChainId === wallet.targetChain.chainId
            ? wallet.targetChain.name
            : `Chain ${domainChainId}`,
      },
    );
  } else {
    await wallet.ensureChain();
  }

  const rawMessage = challengeData.message as Record<string, unknown>;

  // Coerce to the exact field types viem expects for EIP-712 uint256/bytes32/address.
  // Settlement JSON must echo the signed values (stringified ints) so the API recovers the same hash.
  const toRaw = rawMessage.to;
  if (typeof toRaw !== "string" || !isEvmAddress(toRaw)) {
    throw new Error("Challenge message is missing a valid treasury `to` address.");
  }
  if (typeof rawMessage.nonce !== "string" || !rawMessage.nonce.startsWith("0x")) {
    throw new Error("Challenge message is missing a valid bytes32 nonce.");
  }

  const value =
    typeof rawMessage.value === "bigint"
      ? rawMessage.value
      : BigInt(String(rawMessage.value ?? "0"));
  const validAfter =
    typeof rawMessage.validAfter === "bigint"
      ? rawMessage.validAfter
      : BigInt(String(rawMessage.validAfter ?? "0"));
  const validBefore =
    typeof rawMessage.validBefore === "bigint"
      ? rawMessage.validBefore
      : BigInt(String(rawMessage.validBefore ?? "0"));

  const message = {
    from,
    to: toRaw,
    value,
    validAfter,
    validBefore,
    nonce: rawMessage.nonce,
  };

  // viem/wagmi signTypedData — do not include EIP712Domain in types
  const signature = await wallet.signTypedData({
    domain: {
      name: String(domain.name ?? ""),
      version: String(domain.version ?? "2"),
      chainId: domainChainId,
      verifyingContract: domain.verifyingContract,
    },
    types: {
      TransferWithAuthorization: types.TransferWithAuthorization,
    },
    primaryType: "TransferWithAuthorization",
    message,
  });

  return JSON.stringify({
    signature,
    from,
    to: message.to,
    // Decimal strings — API parses with BigInt (avoid scientific notation)
    value: value.toString(10),
    validAfter: validAfter.toString(10),
    validBefore: validBefore.toString(10),
    nonce: message.nonce,
  });
}
