import { describe, expect, it } from "vitest";
import type { ServerEnv } from "./server-env.ts";
import { assertProductionReadiness } from "./server-env.ts";

const address = `0x${"11".repeat(20)}`;

const productionEnv = {
  nodeEnv: "production",
  keeperhubApiKey: "kh_live_test",
  keeperhubApiBaseUrl: "https://app.keeperhub.com",
  chronicleRegistryAddress: address,
  creatorRecoveryWallet: address,
  mppSecret: "mpp_test_secret",
  x402FacilitatorUrl: undefined,
  rpcUrl: undefined,
  revenueFxMode: "auto",
  revenueEthPerCurrencyUnit: undefined,
  creatorRecoveryShare: 0.8,
  referralRewardShare: 0.2,
  allowDirectEthersWrites: false,
  treasuryWalletPrivateKey: undefined,
  paraWalletPrivateKey: undefined,
  frontendOrigin: "https://chronicle.example",
  deskWalletAddress: undefined,
  deskMinAumUsdc: 1,
  deskTargetAumUsdc: 2,
  deskMaxAumUsdc: 3,
  deskHfCritical: 1.2,
  deskHfWarn: 1.5,
} as ServerEnv;

describe("assertProductionReadiness", () => {
  it("allows production boot when workflow IDs are not configured yet", () => {
    expect(() => assertProductionReadiness(productionEnv)).not.toThrow();
  });

  it("still requires the core KeeperHub configuration", () => {
    expect(() =>
      assertProductionReadiness({
        ...productionEnv,
        keeperhubApiKey: undefined,
      } as ServerEnv),
    ).toThrow(/KeeperHub core configuration.*KEEPERHUB_API_KEY/);
  });
});
