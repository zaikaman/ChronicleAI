/** Shared receipt for every material on-chain write. */

export interface OnChainWriteReceipt {
  txHash: string;
  /** KeeperHub execution / run id when written via KeeperHub. */
  keeperHubRunId?: string;
  /** Block explorer URL for the transaction. */
  explorerUrl?: string;
}

export interface SponsoredWatchWriteReceipt extends OnChainWriteReceipt {
  watchId: number;
}
