/**
 * Base / Sepolia explorer URL builders for CCTP burn and mint txs.
 */

import { txExplorerUrl } from "@chronicleai/config";
import {
  CCTP_DEST_CHAIN_ID,
  CCTP_SOURCE_CHAIN_ID,
} from "./constants.ts";

export function baseBurnExplorerUrl(txHash: string): string | null {
  return txExplorerUrl(CCTP_SOURCE_CHAIN_ID, txHash);
}

export function sepoliaMintExplorerUrl(txHash: string): string | null {
  return txExplorerUrl(CCTP_DEST_CHAIN_ID, txHash);
}

export function cctpExplorerUrls(args: {
  burnTxHash?: string | null | undefined;
  mintTxHash?: string | null | undefined;
}): { burnExplorerUrl: string | null; mintExplorerUrl: string | null } {
  return {
    burnExplorerUrl: args.burnTxHash
      ? baseBurnExplorerUrl(args.burnTxHash)
      : null,
    mintExplorerUrl: args.mintTxHash
      ? sepoliaMintExplorerUrl(args.mintTxHash)
      : null,
  };
}
