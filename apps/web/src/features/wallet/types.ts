// Wallet session types (RainbowKit / wagmi backed)

export type WalletStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "unavailable"
  | "error";

export interface WalletChainConfig {
  /** Numeric chain id (e.g. 84532 for Base Sepolia). */
  chainId: number;
  /** 0x-prefixed hex chain id for wallet_switchEthereumChain. */
  chainIdHex: string;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

export interface WalletContextValue {
  status: WalletStatus;
  address: string | null;
  chainId: number | null;
  error: string | null;
  /** True when an injected/connector wallet path is available in the browser. */
  isAvailable: boolean;
  /** True when a wallet is actively connected. */
  isConnected: boolean;
  /** True when connected chain matches the app payment/target chain. */
  isCorrectChain: boolean;
  targetChain: WalletChainConfig;
  /**
   * Open the RainbowKit connect modal. Resolves with the address once the user
   * connects, or rejects if they dismiss / time out.
   */
  connect: () => Promise<string>;
  /** Open the connect modal without waiting (e.g. header button already uses ConnectButton). */
  openConnectModal: () => void;
  /** Open account modal when connected. */
  openAccountModal: () => void;
  disconnect: () => void;
  /**
   * Ensure the wallet is on the target (or provided) chain.
   * Throws if the user rejects.
   */
  ensureChain: (chain?: WalletChainConfig) => Promise<void>;
  /**
   * Sign EIP-712 typed data with the connected account (viem/wagmi).
   * Pass domain / types / primaryType / message (EIP712Domain is added by viem).
   */
  signTypedData: (typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<string>;
  clearError: () => void;
}
