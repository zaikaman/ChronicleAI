// Cross-boundary connect waiters: stub wallet can await connection that
// completes inside the dynamically loaded RainbowKit stack.

const CONNECT_TIMEOUT_MS = 120_000;

type Waiter = {
  resolve: (address: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let waiter: Waiter | null = null;

/** Called by stub connect / flows that need an address after stack load. */
export function waitForWalletConnection(): Promise<string> {
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("Connection superseded by a new request."));
    waiter = null;
  }

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (waiter) {
        waiter = null;
        reject(new Error("Wallet connection timed out. Open Connect wallet and try again."));
      }
    }, CONNECT_TIMEOUT_MS);

    waiter = {
      resolve: (address) => {
        clearTimeout(timer);
        resolve(address);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
      timer,
    };
  });
}

/** Called from live wallet when a connected address is available. */
export function notifyWalletConnected(address: string): void {
  if (!waiter) return;
  const current = waiter;
  waiter = null;
  current.resolve(address);
}

export function rejectWalletConnection(message: string): void {
  if (!waiter) return;
  const current = waiter;
  waiter = null;
  current.reject(new Error(message));
}
